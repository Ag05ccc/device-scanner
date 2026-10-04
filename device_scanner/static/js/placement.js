// Floor assignments arrive with the server snapshot and are shared by all users.
export const FLOORS = [3, 2, 1];

export function floorFor(nodeId, placements) {
  if (placements.has(nodeId)) return placements.get(nodeId);
  const match = /^pi-0*([123])$/i.exec(nodeId);
  return match ? Number(match[1]) : null;
}

export function floorLabel(floor) {
  return floor === null ? "Kat seçilmedi" : `${floor}. kat`;
}
