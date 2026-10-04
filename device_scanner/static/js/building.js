import { $, element, icon, setText } from "./ui.js";
import { FLOORS, floorFor, floorLabel } from "./placement.js";

function statusFor(node, connected) {
  if (!connected) return { key: "unknown", label: "Bağlantı yok" };
  if (!node.online) return { key: "offline", label: "Çevrimdışı" };
  if (Object.values(node.radios).some((scan) => scan.status === "error"))
    return { key: "error", label: "Radyo hatası" };
  return { key: "online", label: "Çevrimiçi" };
}

function createNode(nodeId) {
  const button = element("button", "building-node");
  button.type = "button";
  button.dataset.nodeId = nodeId;
  const symbol = element("span", "building-node-icon");
  symbol.append(icon("node"));
  const identity = element("span", "building-node-identity");
  identity.append(
    element("strong", "", nodeId),
    element("span", "building-node-counts"),
  );
  const state = element("span", "building-node-state");
  state.append(element("i", "status-dot"), element("span"));
  button.append(symbol, identity, state);
  return button;
}

export function renderBuilding(nodes, view, connected, placements) {
  const building = $("building");
  const existing = new Map(
    [...building.querySelectorAll(".building-node")].map((button) => [
      button.dataset.nodeId,
      button,
    ]),
  );
  const counts = new Map(FLOORS.map((floor) => [floor, 0]));
  let unplaced = 0;
  for (const node of nodes) {
    const floor = floorFor(node.node_id, placements);
    const container =
      floor === null ? $("unplaced-nodes") : $("floor-nodes-" + floor);
    const button = existing.get(node.node_id) || createNode(node.node_id);
    existing.delete(node.node_id);
    // Reuse buttons so polling preserves focus and selection.
    if (button.parentElement !== container) container.append(button);
    const state = statusFor(node, connected);
    button.dataset.state = state.key;
    button.classList.toggle("selected", view.nodeId === node.node_id);
    button.setAttribute("aria-pressed", view.nodeId === node.node_id);
    button.setAttribute(
      "aria-label",
      `${node.node_id}, ${floorLabel(floor)}, ${state.label}`,
    );
    setText(button.querySelector(".building-node-state span"), state.label);
    const prefix = state.key === "online" ? "" : "Son kayıt: ";
    setText(
      button.querySelector(".building-node-counts"),
      `${prefix}Wi-Fi ${node.radios.wifi.observations.length} · BT ${node.radios.bluetooth.observations.length}`,
    );
    if (floor === null) unplaced++;
    else counts.set(floor, counts.get(floor) + 1);
  }
  for (const button of existing.values()) button.remove();
  for (const floor of FLOORS) {
    setText($("floor-count-" + floor), `${counts.get(floor)} Pi`);
    $("floor-empty-" + floor).hidden = counts.get(floor) > 0;
    $("building-floor-" + floor).classList.toggle(
      "selected",
      view.nodeId !== "all" && floorFor(view.nodeId, placements) === floor,
    );
  }
  $("building-unplaced").hidden = unplaced === 0;
  setText($("unplaced-count"), unplaced);
  setText(
    $("building-summary"),
    `3 kat · ${nodes.length} Pi${unplaced ? ` · ${unplaced} yerleştirilmemiş` : ""}`,
  );
  $("building-all").setAttribute("aria-pressed", view.nodeId === "all");
  $("building-all").classList.toggle("active", view.nodeId === "all");

  const selected = nodes.find((node) => node.node_id === view.nodeId);
  $("placement-empty").hidden = Boolean(selected);
  $("placement-selection").hidden = !selected;
  if (!selected) return;
  const floor = floorFor(selected.node_id, placements);
  const status = statusFor(selected, connected);
  setText($("placement-node-name"), selected.node_id);
  setText($("placement-location"), floorLabel(floor));
  setText($("placement-state"), status.label);
  $("placement-state").dataset.state = status.key;
  const select = $("placement-floor");
  const value = floor === null ? "unplaced" : String(floor);
  if (select.value !== value) select.value = value;
  select.setAttribute("aria-label", `${selected.node_id} için kat seçimi`);
  for (const [radio, label] of [
    ["wifi", "Wi-Fi"],
    ["bluetooth", "Bluetooth"],
  ]) {
    const scan = selected.radios[radio];
    const message =
      scan.status === "waiting"
        ? "Tarama bekleniyor"
        : scan.status === "error"
          ? "Tarama hatası"
          : !connected || !selected.online
            ? `${scan.observations.length} önceki kayıt`
            : `${scan.observations.length} gözlem`;
    setText($("placement-" + radio), `${label} · ${message}`);
  }
}
