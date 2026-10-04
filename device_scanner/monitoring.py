"""Bounded, server-session observation history; WiGLE records stay unchanged."""

from collections import OrderedDict
import copy


RETENTION_SECONDS = 15 * 60
NEW_SECONDS = 10 * 60
MAX_HISTORY = 10_000
MAX_SCAN_TICKS = 11


def scan_rate(ticks, *, now, available):
    """Measured success receipt frequency over at most ten complete intervals.

    No polling/heartbeat/configured rate is substituted for a measurement.
    A missed expected arrival suppresses the old average instead of leaving a
    frozen positive value, and errors preserve the window for later recovery.
    """
    samples = max(0, len(ticks) - 1)
    span = ticks[-1] - ticks[0] if samples else None
    rate = None
    if span is not None and span > 0:
        mean_interval = span / samples
        if available and now - ticks[-1] <= max(2 * mean_interval, 2):
            rate = samples / span
    return {"scan_rate_hz": rate, "scan_rate_samples": samples,
            "scan_rate_window_seconds": span}


class ObservationHistory:
    def __init__(self, *, limit=MAX_HISTORY):
        self.limit = limit
        self.entries = OrderedDict()
        self.identities = OrderedDict()
        self.sources = {}
        self.initialized = set()

    def _remove(self, key):
        self.entries.pop(key)
        source, identity = key
        self.sources[source].pop(identity, None)
        if not self.sources[source]:
            del self.sources[source]

    def prune(self, now):
        # Entries are in last-successful-sighting order, not scan order.
        while self.entries:
            key, entry = next(iter(self.entries.items()))
            if len(self.entries) <= self.limit and now - entry["tick"] < RETENTION_SECONDS:
                break
            self._remove(key)

    def reset_node(self, node_id):
        """Discard samples and source baselines when the producer changes mode."""
        for source in tuple(self.initialized):
            if source[0] == node_id:
                for identity in tuple(self.sources.get(source, {})):
                    self._remove((source, identity))
                self.initialized.discard(source)

    def accept(self, node_id, radio, records, now, timestamp, *, scanner="dummy"):
        self.prune(now)
        source = (node_id, radio)
        baseline = source not in self.initialized
        self.initialized.add(source)
        for entry in self.sources.get(source, {}).values():
            entry["missing_scans"] += 1
            entry["present"] = False
        for record in records:
            # BT and BLE are transport descriptions, not separate physical identities.
            identity = (radio, record["MAC"].upper())
            # A synthetic sighting must never establish a real device's first
            # discovery. This ledger stays shared between same-mode Pis, with
            # one combined capacity limit for both modes.
            discovery_identity = (scanner, *identity)
            first = self.identities.get(discovery_identity)
            if first is None:
                first = {"first_seen_at": timestamp, "first_tick": now,
                         "novel": not baseline}
                self.identities[discovery_identity] = first
            self.identities.move_to_end(discovery_identity)
            key = (source, identity)
            entry = {**first, "record": copy.deepcopy(record), "last_seen_at": timestamp,
                     "tick": now, "missing_scans": 0, "present": True}
            self.entries[key] = entry
            self.entries.move_to_end(key)
            self.sources.setdefault(source, {})[identity] = entry
        # Keep a bounded session identity ledger even after source samples expire.
        # This avoids calling ordinary reappearances "new" after the 15-minute window.
        while len(self.identities) > self.limit:
            self.identities.popitem(last=False)
        self.prune(now)

    def snapshot(self, node_id, radio, now):
        result = []
        for entry in self.sources.get((node_id, radio), {}).values():
            result.append({
                "record": copy.deepcopy(entry["record"]),
                "first_seen_at": entry["first_seen_at"],
                "last_seen_at": entry["last_seen_at"],
                "age_seconds": round(max(0, now - entry["tick"]), 3),
                "missing_scans": entry["missing_scans"],
                "present": entry["present"],
                "is_new": entry["novel"] and now - entry["first_tick"] < NEW_SECONDS,
            })
        return result
