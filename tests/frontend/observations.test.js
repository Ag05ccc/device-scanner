import test from "node:test";
import assert from "node:assert/strict";
import {
  observations,
  filterRows,
  sortRows,
  channelCounts,
  recordHistory,
  bandOf,
} from "../../device_scanner/static/js/observations.js";
import {
  exportDocument,
  toCsv,
} from "../../device_scanner/static/js/export.js";

function node(
  id,
  props,
  { online = true, status = "success", stamp = "2026-10-04T10:00:00Z" } = {},
) {
  return {
    node_id: id,
    scanner: "dummy",
    online,
    radios: {
      wifi: {
        status,
        received_at: stamp,
        observed_at: stamp,
        error: status === "error" ? "Unavailable" : null,
        observations: [{ path: "/ap/1", properties: props }],
      },
      bluetooth: {
        status: "success",
        observations: [
          { path: "/bt/1", properties: { Name: "Beacon", RSSI: -68 } },
        ],
      },
    },
  };
}

test("radio and Pi scopes preserve independent observations and unknown values", () => {
  const nodes = [
    node("pi-01", { SSID: "", BSSID: "02:00:00:00:00:01", Strength: 0 }),
    node("pi-02", {}),
  ];
  const rows = observations(nodes, "wifi");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Hidden network");
  assert.equal(rows[0].signal, 0);
  assert.equal(rows[1].signal, null);
  assert.equal(rows[1].name, "Unnamed network");
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(observations(nodes, "wifi", "pi-02").length, 1);
  assert.equal(observations(nodes, "bluetooth")[0].signal, -68);
});

test("band and trimmed name/address/node search compose; unknown signals sort last", () => {
  const rows = observations(
    [
      node("pi-01", { SSID: "Office", Strength: 70, Frequency: 5180 }),
      node("pi-02", { SSID: "Office", Strength: 20, Frequency: 2437 }),
      node("pi-03", { SSID: "Guest", BSSID: "AA:BB:CC:DD:EE:FF" }),
    ],
    "wifi",
  );
  assert.equal(filterRows(rows, { query: " OFFICE ", band: "5" }).length, 1);
  assert.equal(filterRows(rows, { query: "aa:bb" })[0].nodeId, "pi-03");
  assert.equal(filterRows(rows, { query: "PI-02" })[0].nodeId, "pi-02");
  assert.deepEqual(
    sortRows(rows).map((row) => row.signal),
    [70, 20, null],
  );
  assert.deepEqual([2437, 5180, 5955, undefined].map(bandOf), [
    "2.4",
    "5",
    "6",
    "unknown",
  ]);
  assert.equal(
    filterRows(observations([node("pi-01", {})], "bluetooth"), { band: "5" })
      .length,
    1,
  );
});

test("channel counts deduplicate APs across Pis but separate bands and omit retained results", () => {
  const props = {
    SSID: "Office",
    BSSID: "AA:BB:CC:DD:EE:FF",
    Channel: 1,
    Frequency: 2412,
  };
  const rows = observations(
    [
      node("pi-01", props),
      node("pi-02", { ...props, BSSID: props.BSSID.toLowerCase() }),
      node("pi-03", { ...props, Frequency: 5955 }),
      node("pi-04", { ...props, BSSID: "other" }, { online: false }),
      node("pi-05", { ...props, BSSID: "failed" }, { status: "error" }),
    ],
    "wifi",
  );
  assert.deepEqual(channelCounts(rows), [
    { channel: 1, band: "2.4", count: 1 },
    { channel: 1, band: "6", count: 1 },
  ]);
  assert.equal(rows[3].state, "offline");
  assert.equal(rows[4].state, "error");
});

test("history adds one point per new report, keeps gaps, bounds memory", () => {
  const history = new Map();
  let rows = observations([node("pi-01", { Strength: 50 })], "wifi");
  const key = rows[0].id;
  recordHistory(history, rows, 1000);
  recordHistory(history, rows, 2000);
  assert.equal(history.get(key).samples.length, 1);
  recordHistory(history, [{ ...rows[0], state: "error" }], 3000);
  assert.equal(history.get(key).samples.at(-1).value, null);
  for (let index = 0; index < 80; index++)
    recordHistory(
      history,
      [{ ...rows[0], receivedAt: String(index) }],
      4000 + index,
    );
  assert.equal(history.get(key).samples.length, 60);
  recordHistory(history, [], 5000);
  assert.equal(history.get(key).samples.at(-1).value, null);
  recordHistory(history, [], 1000000);
  assert.equal(history.size, 0);
});

test("exports preserve displayed order, original properties, errors and filter context", () => {
  const rows = observations(
    [node("pi-01", { SSID: "Office", Strength: 70 }, { status: "error" })],
    "wifi",
  );
  const view = {
    radio: "wifi",
    nodeId: "pi-01",
    query: "office",
    band: "all",
    sort: "name",
  };
  const doc = exportDocument(rows, view, false, "2026-10-04T10:00:00Z");
  assert.equal(doc.outdated, true);
  assert.equal(doc.filters.query, "office");
  assert.equal(doc.observations[0].state, "error");
  assert.equal(doc.observations[0].properties.Strength, 70);
  assert.match(toCsv(doc), /Unavailable/);
  assert.equal(exportDocument([], view, true, null).count, 0);
  rows[0].record.node_id = "misleading-extra-field";
  rows[0].record.state = "latest";
  const safe = exportDocument(rows, view, false, null);
  assert.equal(safe.observations[0].node_id, "pi-01");
  assert.equal(safe.observations[0].state, "error");
});

test("CSV quotes commas and newlines and neutralizes formulas in reported text", () => {
  const doc = {
    outdated: false,
    filters: {},
    observations: [
      {
        node_id: "pi-1",
        error: '  =SUM(1,2)\n"quoted"',
        path: "@danger",
        properties: { SSID: "=not executable inside JSON" },
      },
    ],
  };
  const csv = toCsv(doc);
  assert.ok(csv.includes('"\'  =SUM(1,2)\n""quoted"""'));
  assert.ok(csv.includes('"\'@danger"'));
});
