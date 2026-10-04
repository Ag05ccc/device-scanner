import test from "node:test";
import assert from "node:assert/strict";
import {
  floorFor,
  floorLabel,
  loadPlacements,
  savePlacements,
  PLACEMENT_KEY,
} from "../../device_scanner/static/js/placement.js";

test("initial placement recognizes the first three Pis and leaves additional devices unplaced", () => {
  const placements = new Map();
  for (const id of ["pi-1", "pi-01", "Pi-001"])
    assert.equal(floorFor(id, placements), 1);
  assert.equal(floorFor("pi-02", placements), 2);
  assert.equal(floorFor("pi-3", placements), 3);
  for (const id of ["pi-4", "pi-10", "pi-0", "pi-21", "roof-pi", "pi-1-other"])
    assert.equal(floorFor(id, placements), null);
  assert.equal(floorLabel(1), "1. kat");
  assert.equal(floorLabel(null), "Kat seçilmedi");
});

test("multiple Pis can share a floor and explicit unplacement overrides defaults across reloads", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const placements = new Map([
    ["pi-01", 3],
    ["pi-02", 3],
    ["pi-03", null],
    ["pi-04", 1],
  ]);
  assert.equal(savePlacements(placements, storage), true);
  const restored = loadPlacements(storage);
  assert.deepEqual(restored, placements);
  assert.equal(floorFor("pi-01", restored), 3);
  assert.equal(floorFor("pi-02", restored), 3);
  assert.equal(floorFor("pi-03", restored), null);
  assert.ok(values.has(PLACEMENT_KEY));
});

test("corrupt or unsupported saved placements cannot break monitoring or create nonexistent floors", () => {
  for (const raw of [
    null,
    "{",
    "null",
    "[]",
    "{}",
    '{"version":2,"floors":{"pi-01":2}}',
    '{"version":1,"floors":[]}',
  ])
    assert.deepEqual(loadPlacements({ getItem: () => raw }), new Map());
  const saved = JSON.stringify({
    version: 1,
    floors: {
      "pi-01": 4,
      "pi-02": "1",
      "pi-03": false,
      "pi-04": null,
      "pi-05": 2,
    },
  });
  assert.deepEqual(
    loadPlacements({ getItem: () => saved }),
    new Map([
      ["pi-04", null],
      ["pi-05", 2],
    ]),
  );
});

test("blocked storage still allows placement in the current session", () => {
  const storage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadPlacements(storage), new Map());
  const placements = new Map([["pi-01", 2]]);
  assert.equal(savePlacements(placements, storage), false);
  assert.equal(floorFor("pi-01", placements), 2);
});
