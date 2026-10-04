// Pure data transformations shared by the table, metrics, charts, and exports.
export const RADIOS = ["wifi", "bluetooth"];
export const isNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);
const text = (value) =>
  typeof value === "string" && value.length ? value : null;
const compare = new Intl.Collator("tr", {
  numeric: true,
  sensitivity: "base",
}).compare;

export function bandOf(frequency) {
  if (!isNumber(frequency)) return "unknown";
  if (frequency >= 2400 && frequency < 2500) return "2.4";
  if (frequency >= 4900 && frequency < 5925) return "5";
  if (frequency >= 5925 && frequency <= 7125) return "6";
  return "unknown";
}

export function signalText(value) {
  return isNumber(value) ? `${value} dBm` : "Bilinmiyor";
}

export function signalPercent(value) {
  if (!isNumber(value)) return 0;
  return Math.max(
    0,
    // Only the visual meter is scaled. The measurement stays in dBm.
    Math.min(100, ((value + 100) / 70) * 100),
  );
}

export function observations(nodes, radio, nodeId = "all") {
  const rows = [];
  for (const node of nodes) {
    if (nodeId !== "all" && node.node_id !== nodeId) continue;
    const scan = node.radios[radio];
    // A later error report does not make retained successful readings newer.
    const hasSuccessTime = Object.hasOwn(scan, "last_success_at");
    const receivedAt = hasSuccessTime ? scan.last_success_at : scan.received_at;
    const state = !node.online
      ? "offline"
      : scan.status === "error"
        ? "error"
        : scan.freshness === "fresh"
          ? "latest"
          : scan.freshness ||
            (scan.status === "success" ? "latest" : "waiting");
    for (const record of scan.observations) {
      const wifi = radio === "wifi";
      rows.push({
        id: JSON.stringify([
          node.node_id,
          record.Type,
          record.MAC.toUpperCase(),
        ]),
        nodeId: node.node_id,
        scanner: node.scanner,
        radio,
        record,
        name: wifi
          ? record.SSID === ""
            ? "Gizli ağ"
            : record.SSID
          : text(record.SSID) || "Adsız cihaz",
        address: record.MAC,
        signal: isNumber(record.RSSI) ? record.RSSI : null,
        channel: isNumber(record.Channel) ? record.Channel : null,
        band: wifi ? bandOf(record.Frequency) : "unknown",
        security: text(record.AuthMode) || "Bilinmiyor",
        receivedAt,
        lastReportAt: scan.received_at,
        observedAt:
          hasSuccessTime && scan.status !== "success" ? null : scan.observed_at,
        state,
        error: scan.error,
      });
    }
  }
  return rows;
}

export function filterRows(rows, { query = "", band = "all" } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (row.radio !== "wifi" || band === "all" || row.band === band) &&
      (!needle ||
        [row.name, row.address, row.nodeId].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        )),
  );
}

export function sortRows(rows, sort = "signal") {
  return [...rows].sort((a, b) => {
    if (sort === "signal") {
      if (a.signal === null && b.signal !== null) return 1;
      if (b.signal === null && a.signal !== null) return -1;
      if (a.signal !== b.signal) return b.signal - a.signal;
    }
    const field =
      { name: "name", node: "nodeId", address: "address" }[sort] || "name";
    return compare(a[field], b[field]) || compare(a.id, b.id);
  });
}

export function channelCounts(rows) {
  // One AP can be heard by several Pis; count its BSSID only once per channel.
  const channels = new Map();
  for (const row of rows) {
    if (row.radio !== "wifi" || row.state !== "latest" || row.channel === null)
      continue;
    const key = `${row.band}:${row.channel}`;
    if (!channels.has(key))
      channels.set(key, {
        channel: row.channel,
        band: row.band,
        addresses: new Set(),
      });
    channels.get(key).addresses.add(row.address.toUpperCase());
  }
  return [...channels.values()]
    .sort((a, b) => compare(a.band, b.band) || a.channel - b.channel)
    .map(({ channel, band, addresses }) => ({
      channel,
      band,
      count: addresses.size,
    }));
}

export function recordHistory(history, rows, now = Date.now()) {
  const present = new Set();
  for (const row of rows) {
    present.add(row.id);
    const entry = history.get(row.id) || {
      stamp: null,
      samples: [],
      lastSeen: now,
    };
    entry.lastSeen = now;
    if (row.state === "latest" && row.receivedAt !== entry.stamp) {
      entry.stamp = row.receivedAt;
      entry.samples.push({ time: now, value: row.signal });
    } else if (row.state !== "latest" && entry.samples.at(-1)?.value != null) {
      entry.samples.push({ time: now, value: null });
    }
    entry.samples = entry.samples.slice(-60);
    history.set(row.id, entry);
  }
  for (const [key, entry] of history) {
    if (!present.has(key) && entry.samples.at(-1)?.value != null)
      entry.samples.push({ time: now, value: null });
    entry.samples = entry.samples.slice(-60);
    if (now - entry.lastSeen > 10 * 60 * 1000) history.delete(key);
  }
  // Keep browser memory bounded even with large or frequently rotating scans.
  while (history.size > 2000) history.delete(history.keys().next().value);
}
