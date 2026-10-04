// Building-level views count radio addresses, while retaining every Pi reading.
// Freshness and discovery ages come from the server, never the browser clock.
import { RADIOS, isNumber } from "./observations.js";

const compare = new Intl.Collator("tr", {
  numeric: true,
  sensitivity: "base",
}).compare;
// Names can mix English SSIDs and Turkish device labels. Treat both forms of
// dotted/dotless I alike for search, while preserving original displayed names.
const searchText = (value) =>
  value.normalize("NFC").toLocaleLowerCase("tr").replaceAll("ı", "i");
const ACTIVE = new Set(["current", "recent"]);
const rank = { current: 0, recent: 1, unknown: 2, missing: 3 };
const knownKinds = {
  phone: ["phone", "Telefon"],
  computer: ["computer", "Bilgisayar"],
  "audio-headset": ["headset", "Kulaklık"],
  "audio-headphones": ["headphones", "Kulaklık"],
  "audio-card": ["audio", "Ses cihazı"],
  "audio-speakers": ["audio", "Ses cihazı"],
  watch: ["watch", "Saat"],
  "input-keyboard": ["keyboard", "Klavye"],
  "input-mouse": ["mouse", "Fare"],
  "input-gaming": ["gamepad", "Oyun kumandası"],
  "camera-photo": ["camera", "Kamera"],
  "camera-video": ["camera", "Kamera"],
  printer: ["printer", "Yazıcı"],
};
const floorOf = (node) => ([1, 2, 3].includes(node.floor) ? node.floor : null);
const normalizedAddress = (record) => record.MAC.toUpperCase();
const timestamp = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const ageOf = (value) => (isNumber(value) && value >= 0 ? value : null);
const fresh = (node, scan, connected) =>
  connected &&
  node.online === true &&
  scan?.enabled !== false &&
  scan?.freshness === "fresh";

export function deviceKind(record, radio) {
  if (radio === "wifi" || record.Type === "WIFI") return "access-point";
  const prefix = String(record.AuthMode || "").split(/\s|\[/, 1)[0];
  return knownKinds[prefix]?.[0] || "bluetooth";
}

export function kindLabel(kind) {
  if (kind === "access-point") return "Wi-Fi erişim noktası";
  return (
    Object.values(knownKinds).find(([key]) => key === kind)?.[1] || "Bluetooth"
  );
}

function sourceState(node, scan, entry, connected) {
  if (!fresh(node, scan, connected)) return "unknown";
  if (entry.present === true) return "current";
  const age = ageOf(entry.age_seconds);
  if (age !== null && age <= 60) return "recent";
  const cycle = ageOf(scan.expected_cycle_seconds);
  if (
    age !== null &&
    cycle !== null &&
    entry.missing_scans >= 2 &&
    age >= Math.max(60, 3 * cycle)
  )
    return "missing";
  return "unknown";
}

function retained(scan) {
  const entries = new Map();
  for (const entry of scan.recent_observations || []) {
    if (typeof entry.record?.MAC !== "string") continue;
    const key = normalizedAddress(entry.record);
    const previous = entries.get(key);
    if (
      !previous ||
      (entry.present && !previous.present) ||
      (entry.present === previous.present &&
        (timestamp(entry.last_seen_at) ?? -Infinity) >
          (timestamp(previous.last_seen_at) ?? -Infinity))
    )
      entries.set(key, entry);
  }
  // An explicit empty history means the server expired those observations.
  // Latest-success records can remain in the technical report for longer.
  if (Array.isArray(scan.recent_observations)) return [...entries.values()];
  // Tolerate older snapshots only when server history is entirely absent.
  for (const record of scan.observations || []) {
    if (typeof record.MAC !== "string") continue;
    const key = normalizedAddress(record);
    if (!entries.has(key))
      entries.set(key, {
        record,
        first_seen_at: null,
        last_seen_at: scan.last_success_at || scan.observed_at || null,
        age_seconds: scan.success_age_seconds,
        missing_scans: 0,
        is_new: false,
        present: true,
      });
  }
  return [...entries.values()];
}

function sourcePriority(a, b) {
  return (
    rank[a.state] - rank[b.state] ||
    (a.ageSeconds ?? Infinity) - (b.ageSeconds ?? Infinity) ||
    compare(a.nodeId, b.nodeId)
  );
}

export function devices(nodes, connected = true) {
  const grouped = new Map();
  for (const node of nodes) {
    for (const radio of RADIOS) {
      const scan = node.radios?.[radio];
      if (!scan) continue;
      for (const entry of retained(scan)) {
        const record = entry.record;
        const address = normalizedAddress(record);
        // Classic Bluetooth and BLE can describe the same address. Wi-Fi is a
        // separate address namespace; identical names never imply identity.
        const id = JSON.stringify([radio, address]);
        const source = {
          id: JSON.stringify([node.node_id, record.Type, address]),
          nodeId: node.node_id,
          floor: floorOf(node),
          scanner: node.scanner,
          radio,
          record,
          state: sourceState(node, scan, entry, connected),
          lastSeenAt: entry.last_seen_at || null,
          firstSeenAt: entry.first_seen_at || null,
          ageSeconds: ageOf(entry.age_seconds),
          signal: isNumber(record.RSSI) ? record.RSSI : null,
          error: scan.error || null,
          isNew: entry.is_new === true,
          freshness: scan.freshness || "waiting",
          enabled: scan.enabled ?? null,
          observable: fresh(node, scan, connected),
        };
        if (!grouped.has(id))
          grouped.set(id, { id, radio, address, sources: [] });
        grouped.get(id).sources.push(source);
      }
    }
  }
  return [...grouped.values()].map((entity) => {
    const sources = [...entity.sources].sort(sourcePriority);
    const active = sources.filter((source) => ACTIVE.has(source.state));
    const state = sources.some((source) => source.state === "current")
      ? "current"
      : sources.some((source) => source.state === "recent")
        ? "recent"
        : sources.every((source) => source.state === "missing")
          ? "missing"
          : "unknown";
    const record = sources[0].record;
    const signalValues = active.map((source) => source.signal).filter(isNumber);
    const ages = sources.map((source) => source.ageSeconds).filter(isNumber);
    const lastSeen = sources
      .filter((source) => timestamp(source.lastSeenAt) !== null)
      .sort((a, b) => timestamp(b.lastSeenAt) - timestamp(a.lastSeenAt));
    const firstSeen = sources
      .filter((source) => timestamp(source.firstSeenAt) !== null)
      .sort((a, b) => timestamp(a.firstSeenAt) - timestamp(b.firstSeenAt));
    const floors = [
      ...new Set((active.length ? active : sources).map((s) => s.floor)),
    ].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
    return {
      ...entity,
      sources,
      record,
      name:
        record.SSID || (entity.radio === "wifi" ? "Gizli ağ" : "Adsız cihaz"),
      kind: deviceKind(record, entity.radio),
      typeLabel:
        entity.radio === "wifi"
          ? "Wi-Fi"
          : record.Type === "BLE"
            ? "BLE"
            : "Bluetooth",
      floors,
      state,
      lastSeenAt: lastSeen[0]?.lastSeenAt || null,
      firstSeenAt: firstSeen[0]?.firstSeenAt || null,
      ageSeconds: ages.length ? Math.min(...ages) : null,
      isNew: ACTIVE.has(state) && (firstSeen[0]?.isNew ?? false),
      signal: signalValues.length ? Math.max(...signalValues) : null,
    };
  });
}

export function filterDevices(
  entities,
  { query = "", radio = "all", floor = "all", status = "all" } = {},
) {
  const needle = searchText(query.trim());
  const wantedFloor = floor === "unassigned" ? null : Number(floor);
  return entities.filter((entity) => {
    const words = [
      entity.name,
      entity.address,
      entity.typeLabel,
      kindLabel(entity.kind),
    ];
    return (
      (radio === "all" || entity.radio === radio) &&
      (floor === "all" || entity.floors.includes(wantedFloor)) &&
      (status === "all" ||
        (status === "new" ? entity.isNew : entity.state === status)) &&
      (!needle || words.some((word) => searchText(word).includes(needle)))
    );
  });
}

export function sortDevices(entities, sort = "name") {
  return [...entities].sort((a, b) => {
    if (sort === "signal" && a.signal !== b.signal)
      return (b.signal ?? -Infinity) - (a.signal ?? -Infinity);
    if (sort === "lastSeen" && a.ageSeconds !== b.ageSeconds)
      return (a.ageSeconds ?? Infinity) - (b.ageSeconds ?? Infinity);
    if (sort === "floor") {
      const difference = (a.floors[0] ?? Infinity) - (b.floors[0] ?? Infinity);
      if (difference) return difference;
    }
    if (sort === "state" && a.state !== b.state)
      return rank[a.state] - rank[b.state];
    if (sort === "address")
      return compare(a.address, b.address) || compare(a.id, b.id);
    return compare(a.name, b.name) || compare(a.id, b.id);
  });
}

function radioSummary(nodes, entities, radio, connected) {
  const expected = nodes.filter(
    (node) => node.radios?.[radio]?.enabled !== false,
  );
  const available = expected.filter((node) =>
    fresh(node, node.radios?.[radio], connected),
  ).length;
  const availability =
    available === 0
      ? "none"
      : available === expected.length
        ? "full"
        : "partial";
  const ids = new Set(nodes.map((node) => node.node_id));
  return {
    availability,
    available,
    total: expected.length,
    disabled: nodes.length - expected.length,
    count:
      available === 0
        ? null
        : entities.filter(
            (entity) =>
              entity.radio === radio &&
              entity.sources.some(
                (source) => ids.has(source.nodeId) && ACTIVE.has(source.state),
              ),
          ).length,
  };
}

function combinedAvailability(radios) {
  const values = RADIOS.filter((radio) => radios[radio].total > 0).map(
    (radio) => radios[radio].availability,
  );
  if (!values.length || values.every((value) => value === "none"))
    return "none";
  return values.every((value) => value === "full") ? "full" : "partial";
}

export function floorSummaries(nodes, entities, connected = true) {
  return [1, 2, 3, null].map((floor) => {
    const floorNodes = nodes.filter((node) => floorOf(node) === floor);
    const radios = Object.fromEntries(
      RADIOS.map((radio) => [
        radio,
        radioSummary(floorNodes, entities, radio, connected),
      ]),
    );
    return {
      floor,
      label: floor === null ? "Atanmamış" : `${floor}. kat`,
      nodeIds: floorNodes.map((node) => node.node_id),
      radios,
      counts: { wifi: radios.wifi.count, bluetooth: radios.bluetooth.count },
      availability: combinedAvailability(radios),
    };
  });
}

function observationIssues(nodes, connected) {
  if (!connected)
    return [
      {
        kind: "connection",
        nodeId: null,
        radio: null,
        floor: null,
        message:
          "Sunucuya ulaşılamıyor. Son veriler gösteriliyor; yeniden deneniyor.",
      },
    ];
  const issues = [];
  for (const node of nodes) {
    const floor = floorOf(node);
    const scope =
      floor === null ? "Katı atanmamış sensörün" : `${floor}. katın`;
    for (const radio of RADIOS) {
      const scan = node.radios?.[radio];
      if (scan?.enabled === false || fresh(node, scan, connected)) continue;
      const kind = !node.online ? "offline" : scan?.freshness || "waiting";
      const radioLabel = radio === "wifi" ? "Wi-Fi" : "Bluetooth";
      const reason =
        kind === "waiting"
          ? "ilk taraması bekleniyor"
          : kind === "error"
            ? "taraması başarısız"
            : "gözlemi güncel değil";
      issues.push({
        kind,
        nodeId: node.node_id,
        radio,
        floor,
        error: scan?.error || null,
        message: `${scope} ${radioLabel} ${reason}. Sayılar eksik olabilir.`,
      });
    }
  }
  const priority = { offline: 0, error: 1, stale: 2, waiting: 3 };
  return issues.sort(
    (a, b) =>
      (priority[a.kind] ?? 4) - (priority[b.kind] ?? 4) ||
      compare(a.nodeId, b.nodeId),
  );
}

export function summary(nodes, entities, connected = true) {
  const radios = Object.fromEntries(
    RADIOS.map((radio) => [
      radio,
      radioSummary(nodes, entities, radio, connected),
    ]),
  );
  const hasObservations = RADIOS.some((radio) => radios[radio].available > 0);
  const demoCount = nodes.filter((node) => node.scanner === "dummy").length;
  const times = entities
    .map((entity) => entity.lastSeenAt)
    .filter((value) => timestamp(value) !== null)
    .sort((a, b) => timestamp(b) - timestamp(a));
  return {
    counts: {
      wifi: radios.wifi.count,
      bluetooth: radios.bluetooth.count,
      new: hasObservations
        ? entities.filter((entity) => entity.isNew).length
        : null,
      recent: hasObservations
        ? entities.filter((entity) => entity.state === "recent").length
        : null,
      missing: hasObservations
        ? entities.filter((entity) => entity.state === "missing").length
        : null,
      unknown: entities.filter((entity) => entity.state === "unknown").length,
    },
    radios,
    sensorWorking: nodes.filter((node) => {
      const enabled = RADIOS.filter(
        (radio) => node.radios?.[radio]?.enabled !== false,
      );
      return (
        enabled.length > 0 &&
        enabled.every((radio) => fresh(node, node.radios?.[radio], connected))
      );
    }).length,
    sensorTotal: nodes.length,
    demo: demoCount > 0,
    mixed: demoCount > 0 && demoCount < nodes.length,
    issues: observationIssues(nodes, connected),
    latestSeenAt: times[0] || null,
  };
}
