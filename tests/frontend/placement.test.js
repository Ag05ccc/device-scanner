import test from "node:test";
import assert from "node:assert/strict";
import {
  FLOORS,
  floorFor,
  floorLabel,
} from "../../device_scanner/static/js/placement.js";

test("fallback placement recognizes the first three Pis and leaves other devices unplaced", () => {
  const placements = new Map();
  assert.deepEqual(FLOORS, [3, 2, 1]);
  for (const id of ["pi-1", "pi-01", "Pi-001"])
    assert.equal(floorFor(id, placements), 1);
  assert.equal(floorFor("pi-02", placements), 2);
  assert.equal(floorFor("pi-3", placements), 3);
  for (const id of ["pi-4", "pi-10", "pi-0", "pi-21", "roof-pi", "pi-1-other"])
    assert.equal(floorFor(id, placements), null);
  assert.equal(floorLabel(1), "1. kat");
  assert.equal(floorLabel(null), "Kat seçilmedi");
});

test("server assignments allow several Pis per floor and explicit unplacement overrides defaults", () => {
  const placements = new Map([
    ["pi-01", 3],
    ["pi-02", 3],
    ["pi-03", null],
    ["pi-04", 1],
  ]);
  assert.equal(floorFor("pi-01", placements), 3);
  assert.equal(floorFor("pi-02", placements), 3);
  assert.equal(floorFor("pi-03", placements), null);
  assert.equal(floorFor("pi-04", placements), 1);
});
