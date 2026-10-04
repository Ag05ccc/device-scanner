// Building placement is workspace metadata, separate from WiGLE observations.
export const FLOORS = [3, 2, 1];
export const PLACEMENT_KEY = "device-scanner-placement-v1";

export function floorFor(nodeId, placements) {
  if (placements.has(nodeId)) return placements.get(nodeId);
  const match = /^pi-0*([123])$/i.exec(nodeId);
  return match ? Number(match[1]) : null;
}

export function floorLabel(floor) {
  return floor === null ? "Kat seçilmedi" : `${floor}. kat`;
}

export function loadPlacements(storage) {
  const placements = new Map();
  try {
    const saved = JSON.parse(
      (storage ?? globalThis.localStorage).getItem(PLACEMENT_KEY),
    );
    if (
      saved?.version !== 1 ||
      !saved.floors ||
      typeof saved.floors !== "object" ||
      Array.isArray(saved.floors)
    )
      return placements;
    for (const [nodeId, floor] of Object.entries(saved.floors)) {
      if (floor === null || FLOORS.includes(floor))
        placements.set(nodeId, floor);
    }
  } catch {
    // A blocked or damaged local store must not stop live monitoring.
  }
  return placements;
}

export function savePlacements(placements, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(
      PLACEMENT_KEY,
      JSON.stringify({
        version: 1,
        floors: Object.fromEntries(placements),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
