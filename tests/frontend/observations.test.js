import test from "node:test";
import assert from "node:assert/strict";
import {
  observations,
  filterRows,
  sortRows,
  channelCounts,
  recordHistory,
  bandOf,
  signalText,
} from "../../device_scanner/static/js/observations.js";
import {
  exportDocument,
  toCsv,
  WIGLE_COLUMNS,
} from "../../device_scanner/static/js/export.js";

import { record } from "./fixtures.js";
import { execFileSync } from "node:child_process";

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
        observations: [record(props)],
      },
      bluetooth: {
        status: "success",
        observations: [
          record({
            SSID: "Beacon",
            RSSI: -68,
            Type: "BLE",
            Channel: 0,
            Frequency: 7936,
          }),
        ],
      },
    },
  };
}

test("radio and Pi scopes preserve independent observations and unknown values", () => {
  const nodes = [
    node("pi-01", { SSID: "", MAC: "02:00:00:00:00:01", RSSI: 0 }),
    node("pi-02", {}),
  ];
  const rows = observations(nodes, "wifi");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Gizli ağ");
  assert.equal(rows[0].signal, 0);
  assert.equal(rows[1].signal, null);
  assert.equal(rows[1].name, "Gizli ağ");
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(observations(nodes, "wifi", "pi-02").length, 1);
  assert.equal(observations(nodes, "bluetooth")[0].signal, -68);
});

test("band and trimmed name/address/node search compose; unknown signals sort last", () => {
  const rows = observations(
    [
      node("pi-01", { SSID: "Office", RSSI: -40, Frequency: 5180 }),
      node("pi-02", { SSID: "Office", RSSI: -80, Frequency: 2437 }),
      node("pi-03", { SSID: "Guest", MAC: "AA:BB:CC:DD:EE:FF" }),
    ],
    "wifi",
  );
  assert.equal(filterRows(rows, { query: " OFFICE ", band: "5" }).length, 1);
  assert.equal(filterRows(rows, { query: "aa:bb" })[0].nodeId, "pi-03");
  assert.equal(filterRows(rows, { query: "PI-02" })[0].nodeId, "pi-02");
  assert.deepEqual(
    sortRows(rows).map((row) => row.signal),
    [-40, -80, null],
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
    MAC: "AA:BB:CC:DD:EE:FF",
    Channel: 1,
    Frequency: 2412,
  };
  const rows = observations(
    [
      node("pi-01", props),
      node("pi-02", { ...props, MAC: props.MAC.toLowerCase() }),
      node("pi-03", { ...props, Frequency: 5955 }),
      node("pi-04", { ...props, MAC: "other" }, { online: false }),
      node("pi-05", { ...props, MAC: "failed" }, { status: "error" }),
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
  let rows = observations([node("pi-01", { RSSI: -50 })], "wifi");
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

test("radio freshness excludes stale readings even while the Pi remains online", () => {
  const nodes = ["fresh", "stale", "waiting", "disabled"].map(
    (freshness, index) => {
      const source = node(`pi-${index}`, {
        Channel: 6,
        Frequency: 2437,
        RSSI: -50,
      });
      source.radios.wifi.freshness = freshness;
      source.radios.wifi.last_success_at = "2026-10-04T09:59:00Z";
      return source;
    },
  );
  const rows = observations(nodes, "wifi");
  assert.deepEqual(
    rows.map((row) => row.state),
    ["latest", "stale", "waiting", "disabled"],
  );
  assert.deepEqual(channelCounts(rows), [
    { channel: 6, band: "2.4", count: 1 },
  ]);
  nodes[0].online = false;
  nodes[1].radios.wifi.status = "error";
  assert.deepEqual(
    observations(nodes, "wifi").map((row) => row.state),
    ["offline", "error", "waiting", "disabled"],
  );
  const history = new Map();
  recordHistory(history, [rows[0]], 1000);
  recordHistory(history, [{ ...rows[0], state: "stale" }], 2000);
  recordHistory(history, [{ ...rows[0], state: "stale" }], 3000);
  assert.deepEqual(
    history.get(rows[0].id).samples.map((sample) => sample.value),
    [-50, null],
  );
});

test("failed radio reports do not redate their retained successful observations", () => {
  const source = node("pi-01", { RSSI: -55 }, { status: "error" });
  source.radios.wifi.last_success_at = "2026-10-04T09:58:00Z";
  source.radios.wifi.freshness = "error";
  const row = observations([source], "wifi")[0];
  assert.equal(row.receivedAt, "2026-10-04T09:58:00Z");
  assert.equal(row.lastReportAt, "2026-10-04T10:00:00Z");
  assert.equal(row.observedAt, null);
  assert.equal(row.state, "error");
  assert.equal(row.signal, -55);
  // Explicitly missing success metadata must not fall back to the failed report.
  source.radios.wifi.last_success_at = null;
  assert.equal(observations([source], "wifi")[0].receivedAt, null);
  // Older server fixtures remain usable without pretending an error is current.
  delete source.radios.wifi.last_success_at;
  const legacy = observations([source], "wifi")[0];
  assert.equal(legacy.receivedAt, source.radios.wifi.received_at);
  assert.equal(legacy.state, "error");
});

test("exports preserve displayed order, original WiGLE records, errors and filter context", () => {
  const rows = observations(
    [node("pi-01", { SSID: "Office", RSSI: -40 }, { status: "error" })],
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
  assert.equal(doc.observations[0].record.RSSI, -40);
  assert.match(toCsv(doc), /WigleWifi-1.6/);
  assert.doesNotMatch(toCsv(doc), /Unavailable/);
  assert.equal(exportDocument([], view, true, null).count, 0);
  rows[0].record.node_id = "misleading-extra-field";
  rows[0].record.state = "latest";
  const safe = exportDocument(rows, view, false, null);
  assert.equal(safe.observations[0].node_id, "pi-01");
  assert.equal(safe.observations[0].state, "error");
});

test("CSV follows WiGLE v1.6 and preserves numeric RSSI, UTF-8, quotes and blanks", () => {
  const columns = JSON.parse(
    execFileSync(
      process.env.PYTHON || "python3",
      [
        "-c",
        "import json; from device_scanner.wigle import COLUMNS; print(json.dumps(COLUMNS))",
      ],
      { cwd: new URL("../../", import.meta.url), encoding: "utf8" },
    ),
  );
  assert.deepEqual(WIGLE_COLUMNS, columns);
  const wifi = record({
    SSID: '=Örnek,"quoted"\nname',
    RSSI: -43.5,
    Channel: 6,
    Frequency: 2437,
  });
  const bt = record({
    SSID: "Beacon",
    Type: "BLE",
    Channel: 0,
    Frequency: 7936,
    RSSI: -67,
    MfgrId: 72,
  });
  const doc = {
    observations: [
      { node_id: "pi-01", record: wifi },
      { node_id: "pi-01", record: bt },
    ],
  };
  const csv = toCsv(doc);
  assert.ok(csv.startsWith("WigleWifi-1.6,"));
  assert.ok(csv.includes("device=pi-01"));
  assert.ok(
    csv.includes("star=Sol,body=3,subBody=0\r\n" + columns.join(",") + "\r\n"),
  );
  // Parse with an independent RFC4180 CSV reader, including embedded newlines.
  const parsed = JSON.parse(
    execFileSync(
      process.env.PYTHON || "python3",
      [
        "-c",
        "import csv,io,json,sys; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read())))))",
      ],
      { input: csv, encoding: "utf8" },
    ),
  );
  assert.equal(parsed.length, 4);
  assert.deepEqual(
    parsed[2],
    columns.map((key) => String(wifi[key])),
  );
  assert.deepEqual(
    parsed[3],
    columns.map((key) => String(bt[key])),
  );
  assert.equal(toCsv({ observations: [] }).trim().split("\r\n").length, 2);
});

test("Bluetooth type codes never become Wi-Fi bands; blank RSSI stays unknown", () => {
  const rows = observations([node("pi-01", {})], "bluetooth");
  assert.equal(rows[0].name, "Beacon");
  assert.equal(rows[0].band, "unknown");
  assert.equal(rows[0].record.Frequency, 7936);
  const wifi = observations([node("pi-01", { RSSI: "" })], "wifi")[0];
  assert.equal(wifi.signal, null);
  assert.equal(wifi.channel, null);
  assert.equal(signalText(wifi.signal), "Bilinmiyor");
  assert.equal(signalText(0), "0 dBm");
  const same = observations(
    [node("pi-01", { MAC: "aa:bb:cc:dd:ee:ff" })],
    "wifi",
  )[0];
  const changed = observations(
    [node("pi-01", { MAC: "AA:BB:CC:DD:EE:FF", SSID: "Renamed", RSSI: -45 })],
    "wifi",
  )[0];
  assert.equal(same.id, changed.id);
});
