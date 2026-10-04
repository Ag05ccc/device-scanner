import test from "node:test";
import assert from "node:assert/strict";
import {
  devices,
  deviceKind,
  kindLabel,
  filterDevices,
  sortDevices,
  floorSummaries,
  summary,
} from "../../device_scanner/static/js/entities.js";
import { observations } from "../../device_scanner/static/js/observations.js";
import { record } from "./fixtures.js";

const stamp = "2026-10-04T10:30:00Z";
function entry(fields = {}, metadata = {}) {
  return {
    record: Object.freeze(record(fields)),
    first_seen_at: "2026-10-04T10:00:00Z",
    last_seen_at: stamp,
    age_seconds: 5,
    missing_scans: 0,
    is_new: false,
    present: true,
    ...metadata,
  };
}

function scan(entries = [], changes = {}) {
  return {
    freshness: "fresh",
    enabled: true,
    last_success_at: stamp,
    success_age_seconds: 5,
    expected_cycle_seconds: 10,
    recent_observations: entries,
    observations: entries
      .filter((item) => item.present)
      .map((item) => item.record),
    ...changes,
  };
}

function node(id, floor, wifi = [], bluetooth = [], changes = {}) {
  return {
    node_id: id,
    scanner: "dummy",
    floor,
    online: true,
    radios: { wifi: scan(wifi), bluetooth: scan(bluetooth) },
    ...changes,
  };
}

test("three Pis observing one address produce one entity with all original readings", () => {
  const readings = [-80, -35, -52].map((RSSI) => entry({ SSID: "Ofis", RSSI }));
  const nodes = readings.map((item, index) =>
    node(`pi-0${index + 1}`, index + 1, [item]),
  );
  const [entity] = devices(nodes);
  assert.equal(devices(nodes).length, 1);
  assert.equal(entity.sources.length, 3);
  assert.equal(entity.signal, -35);
  assert.deepEqual(entity.floors, [1, 2, 3]);
  assert.equal(entity.state, "current");
  assert.equal(entity.firstSeenAt, readings[0].first_seen_at);
  for (const source of entity.sources) {
    const item = readings[Number(source.nodeId.at(-1)) - 1];
    assert.equal(source.record, item.record);
    assert.equal(source.id, observations(nodes, "wifi", source.nodeId)[0].id);
  }
  assert.equal(summary(nodes, devices(nodes)).counts.wifi, 1);
});

test("identity merges BT/BLE addresses, never SSIDs or radio families", () => {
  const nodes = [
    node("pi-01", 1, [entry({ SSID: "Aynı ağ" })], [entry({ Type: "BT" })]),
    node(
      "pi-02",
      2,
      [entry({ SSID: "Aynı ağ", MAC: "02:00:00:00:00:02" })],
      [entry({ Type: "BLE" })],
    ),
    node("pi-03", 3, [
      entry({ MAC: "AA:BB:CC:DD:EE:FF" }),
      entry({ MAC: "aa:bb:cc:dd:ee:ff" }),
    ]),
  ];
  const entities = devices(nodes);
  assert.equal(entities.length, 4);
  assert.equal(entities.filter((item) => item.radio === "wifi").length, 3);
  const bluetooth = entities.find((item) => item.radio === "bluetooth");
  assert.equal(bluetooth.sources.length, 2);
  assert.deepEqual(bluetooth.floors, [1, 2]);
  assert.equal(
    entities.find((item) => item.address === "AA:BB:CC:DD:EE:FF").sources
      .length,
    1,
  );
});

test("floor labels are observations, with no RSSI location inference or stale floor leakage", () => {
  const nodes = [
    node("pi-01", 1, [entry({ RSSI: -75 })]),
    node("pi-02", 2, [entry({ RSSI: -10 })], [], { online: false }),
    node("pi-03", null, [entry({ RSSI: "" })]),
  ];
  const [entity] = devices(nodes);
  assert.deepEqual(entity.floors, [1, null]);
  assert.equal(entity.signal, -75);
  assert.equal(entity.state, "current");
  assert.equal(
    entity.sources.find((source) => source.nodeId === "pi-02").signal,
    -10,
  );
  assert.equal(
    entity.sources.find((source) => source.nodeId === "pi-02").state,
    "unknown",
  );
  const disconnected = devices(nodes, false)[0];
  assert.equal(disconnected.state, "unknown");
  assert.equal(disconnected.signal, null);
  assert.deepEqual(disconnected.floors, [1, 2, null]);
});

test("fresh scan TTL is independent of the 60-second absent-device grace period", () => {
  const item = entry({ RSSI: -64 }, { age_seconds: 120 });
  const slow = node("slow-pi", 1, [item]);
  slow.radios.wifi.expected_cycle_seconds = 180;
  assert.equal(devices([slow])[0].state, "current");
  for (const freshness of ["stale", "error", "waiting", "disabled"]) {
    slow.radios.wifi.freshness = freshness;
    assert.equal(devices([slow])[0].state, "unknown");
    assert.equal(devices([slow])[0].signal, null);
  }
  slow.radios.wifi.freshness = "fresh";
  slow.radios.wifi.enabled = false;
  assert.equal(devices([slow])[0].state, "unknown");
});

test("short absences remain counted; missing requires two scans and the full cycle threshold", () => {
  const absent = (age, missing = 2) =>
    node("pi-01", 1, [
      entry(
        { RSSI: -67 },
        {
          present: false,
          age_seconds: age,
          missing_scans: missing,
        },
      ),
    ]);
  for (const age of [0, 30, 60]) {
    const nodes = [absent(age)];
    assert.equal(devices(nodes)[0].state, "recent");
    assert.equal(summary(nodes, devices(nodes)).counts.wifi, 1);
  }
  assert.equal(devices([absent(61)])[0].state, "missing");
  assert.equal(devices([absent(100, 1)])[0].state, "unknown");
  const slow = absent(70);
  slow.radios.wifi.expected_cycle_seconds = 25;
  assert.equal(devices([slow])[0].state, "unknown");
  slow.radios.wifi.recent_observations[0].age_seconds = 75;
  assert.equal(devices([slow])[0].state, "missing");
  const [missing] = devices([slow]);
  assert.equal(missing.signal, null);
  assert.equal(summary([slow], [missing]).counts.wifi, 0);
});

test("a failed former source prevents claims that a device disappeared", () => {
  const absent = entry(
    {},
    { present: false, missing_scans: 5, age_seconds: 120 },
  );
  const nodes = [node("pi-01", 1, [absent]), node("pi-02", 2, [absent])];
  assert.equal(devices(nodes)[0].state, "missing");
  nodes[1].radios.wifi.freshness = "error";
  assert.equal(devices(nodes)[0].state, "unknown");
  nodes[0].radios.wifi.recent_observations = [
    entry({}, { present: false, age_seconds: 30 }),
  ];
  assert.equal(devices(nodes)[0].state, "recent");
  assert.deepEqual(devices(nodes)[0].floors, [1]);
  nodes[0].radios.wifi.recent_observations = [entry()];
  assert.equal(devices(nodes)[0].state, "current");
});

test("newness follows earliest server discovery, not node process FirstSeen", () => {
  const old = entry({ FirstSeen: "2026-10-04 10:29:00" });
  const newlyHeard = entry(
    {},
    { first_seen_at: "2026-10-04T10:29:00Z", is_new: true },
  );
  const nodes = [node("pi-01", 1, [old]), node("pi-02", 2, [newlyHeard])];
  assert.equal(devices(nodes)[0].isNew, false);
  assert.equal(devices([nodes[1]])[0].isNew, true);
  assert.equal(devices([nodes[1]], false)[0].isNew, false);
});

test("an empty server history expires old records instead of resurrecting last successful scan", () => {
  const pi = node("pi-01", 1, [entry()]);
  pi.radios.wifi.recent_observations = [];
  assert.equal(pi.radios.wifi.observations.length, 1);
  assert.equal(devices([pi]).length, 0);
  delete pi.radios.wifi.recent_observations;
  assert.equal(devices([pi]).length, 1);
  assert.equal(devices([pi])[0].isNew, false);
});

test("floor counts deduplicate same-floor observations but preserve overlap across floors", () => {
  const nodes = [
    node("pi-01", 1, [entry()]),
    node("pi-02", 1, [entry()]),
    node("pi-03", 2, [entry()]),
  ];
  const entities = devices(nodes);
  const floors = floorSummaries(nodes, entities);
  assert.deepEqual(
    floors.map((floor) => floor.floor),
    [1, 2, 3, null],
  );
  assert.equal(floors[0].counts.wifi, 1);
  assert.equal(floors[1].counts.wifi, 1);
  assert.equal(summary(nodes, entities).counts.wifi, 1);
  assert.equal(floors[2].counts.wifi, null);
  assert.equal(floors[3].counts.bluetooth, null);
  assert.equal(floors[0].counts.bluetooth, 0);
});

test("unknown, disabled, successful zero and partial observation remain distinct", () => {
  const nodes = [node("pi-01", 1), node("pi-02", 1, [entry()])];
  nodes[1].radios.wifi.freshness = "stale";
  nodes[0].radios.bluetooth.enabled = false;
  nodes[1].radios.bluetooth.enabled = false;
  let floor = floorSummaries(nodes, devices(nodes))[0];
  assert.equal(floor.radios.wifi.availability, "partial");
  assert.equal(floor.counts.wifi, 0);
  assert.equal(floor.radios.wifi.available, 1);
  assert.equal(floor.radios.wifi.total, 2);
  assert.equal(floor.radios.bluetooth.availability, "none");
  assert.equal(floor.radios.bluetooth.disabled, 2);
  assert.equal(floor.radios.bluetooth.total, 0);
  assert.equal(floor.counts.bluetooth, null);
  nodes[0].online = false;
  floor = floorSummaries(nodes, devices(nodes))[0];
  assert.equal(floor.counts.wifi, null);
  assert.equal(floor.availability, "none");
});

test("summary reports scope, independent radios, demo mixing and lost server connection", () => {
  const nodes = [
    node("pi-01", 1, [entry()]),
    node("pi-02", 2, [], [], { scanner: "hardware" }),
  ];
  nodes[1].radios.bluetooth.freshness = "error";
  nodes[1].radios.bluetooth.error = "Adapter unavailable";
  const overview = summary(nodes, devices(nodes));
  assert.equal(overview.sensorWorking, 1);
  assert.equal(overview.sensorTotal, 2);
  assert.equal(overview.demo, true);
  assert.equal(overview.mixed, true);
  assert.equal(overview.radios.wifi.availability, "full");
  assert.equal(overview.radios.bluetooth.availability, "partial");
  assert.deepEqual(overview.issues[0], {
    kind: "error",
    nodeId: "pi-02",
    radio: "bluetooth",
    floor: 2,
    error: "Adapter unavailable",
    message: "2. katın Bluetooth taraması başarısız. Sayılar eksik olabilir.",
  });
  const offline = summary(nodes, devices(nodes, false), false);
  assert.equal(offline.counts.wifi, null);
  assert.equal(offline.counts.new, null);
  assert.equal(offline.sensorWorking, 0);
  assert.equal(offline.issues[0].kind, "connection");
  assert.equal(summary([], []).counts.wifi, null);
});

test("intentional single-radio operation is healthy without claiming disabled-radio coverage", () => {
  const pi = node("bluetooth-only", 2, [], [entry({ Type: "BLE" })]);
  pi.radios.wifi.enabled = false;
  pi.radios.wifi.freshness = "disabled";
  const entities = devices([pi]);
  const floor = floorSummaries([pi], entities)[1];
  assert.equal(floor.availability, "full");
  assert.equal(floor.radios.wifi.availability, "none");
  assert.equal(floor.counts.wifi, null);
  assert.equal(floor.counts.bluetooth, 1);
  assert.equal(summary([pi], entities).sensorWorking, 1);
  assert.deepEqual(summary([pi], entities).issues, []);
});

test("filtering composes radio, observation floor, state and text without changing global counts", () => {
  const nodes = [
    node("pi-01", 1, [entry({ SSID: "Ofis Ağı" }, { is_new: true })]),
    node(
      "pi-02",
      null,
      [],
      [
        entry({
          Type: "BLE",
          SSID: "Kulaklık",
          AuthMode: "audio-headset [BLE]",
          MAC: "AB:CD:EF:00:00:01",
        }),
      ],
    ),
  ];
  const entities = devices(nodes);
  assert.equal(
    filterDevices(entities, {
      floor: "1",
      radio: "wifi",
      query: " ofis ",
      status: "new",
    }).length,
    1,
  );
  assert.equal(
    filterDevices(entities, { floor: "unassigned" })[0].name,
    "Kulaklık",
  );
  assert.equal(filterDevices(entities, { query: "ab:cd" }).length, 1);
  assert.equal(filterDevices(entities, { status: "missing" }).length, 0);
  assert.equal(
    filterDevices(entities, { radio: "bluetooth", floor: "1" }).length,
    0,
  );
  assert.equal(summary(nodes, entities).counts.wifi, 1);
  assert.equal(summary(nodes, entities).counts.bluetooth, 1);
});

test("default name sorting is stable under RSSI changes; blank signals sort last when requested", () => {
  const nodes = [
    node("pi-01", 1, [
      entry({ SSID: "B", RSSI: -30 }),
      entry({ SSID: "A", MAC: "02:00:00:00:00:02", RSSI: "" }),
    ]),
  ];
  const entities = devices(nodes);
  assert.deepEqual(
    sortDevices(entities).map((entity) => entity.name),
    ["A", "B"],
  );
  assert.deepEqual(
    sortDevices(entities, "signal").map((entity) => entity.name),
    ["B", "A"],
  );
  entities[0].signal = -95;
  assert.deepEqual(
    sortDevices(entities).map((entity) => entity.name),
    ["A", "B"],
  );
  assert.deepEqual(
    entities.map((entity) => entity.name),
    ["B", "A"],
  );
});

test("search accepts English and Turkish uppercase names with dotted or dotless I", () => {
  const entities = devices([
    node("pi-01", 1, [
      entry({ SSID: "Office Wi-Fi" }),
      entry({ SSID: "Işık sensörü", MAC: "02:00:00:00:00:02" }),
      entry({ SSID: "İletişim ağı", MAC: "02:00:00:00:00:03" }),
    ]),
  ]);
  for (const query of ["OFFICE", "office", "OFFİCE", "offıce"])
    assert.deepEqual(
      filterDevices(entities, { query }).map((item) => item.name),
      ["Office Wi-Fi"],
    );
  for (const query of ["IŞIK", "İŞİK", "ışık", "işik"])
    assert.deepEqual(
      filterDevices(entities, { query }).map((item) => item.name),
      ["Işık sensörü"],
    );
  for (const query of [
    "İLETİŞİM AĞI",
    "iletişim ağı",
    "I\u0307LETI\u0307ŞI\u0307M AĞI",
  ])
    assert.deepEqual(
      filterDevices(entities, { query }).map((item) => item.name),
      ["İletişim ağı"],
    );
  assert.equal(entities[0].record.SSID, "Office Wi-Fi");
  assert.equal(entities[1].record.SSID, "Işık sensörü");
});

test("device categories use explicit capabilities, with no vendor or product-name guesses", () => {
  assert.equal(deviceKind(record()), "access-point");
  assert.equal(
    deviceKind(record({ Type: "BLE", AuthMode: "phone [BLE]" })),
    "phone",
  );
  assert.equal(
    deviceKind(record({ Type: "BLE", AuthMode: "watch [BLE]" })),
    "watch",
  );
  assert.equal(
    deviceKind(record({ Type: "BT", AuthMode: "audio-speakers [BT]" })),
    "audio",
  );
  assert.equal(
    deviceKind(record({ Type: "BLE", SSID: "Apple iPhone", MfgrId: 76 })),
    "bluetooth",
  );
  assert.equal(kindLabel("watch"), "Saat");
  assert.equal(kindLabel("anything"), "Bluetooth");
});
