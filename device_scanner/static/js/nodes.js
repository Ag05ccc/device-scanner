import { $, element, icon } from "./ui.js";
import { floorFor, floorLabel } from "./placement.js";

export function renderNodes(nodes, view, connected, placements) {
  $("sidebar-count").textContent = nodes.length;
  $("node-count").textContent = nodes.length;
  $("all-nodes").classList.toggle("active", view.nodeId === "all");
  $("all-nodes").setAttribute("aria-pressed", view.nodeId === "all");
  const container = $("nodes");
  const existing = new Map(
    [...container.querySelectorAll(".node-button")].map((button) => [
      button.dataset.nodeId,
      button,
    ]),
  );
  if (!nodes.length) {
    container.replaceChildren(
      element("p", "sidebar-empty", "Waiting for your first Pi…"),
    );
    return;
  }
  container.querySelector(".sidebar-empty")?.remove();
  for (const node of nodes) {
    let button = existing.get(node.node_id);
    if (!button) {
      button = element("button", "node-button");
      button.type = "button";
      button.dataset.nodeId = node.node_id;
      const symbol = element("span", "node-symbol");
      symbol.append(icon("node"));
      const label = element("span");
      label.append(
        element("span", "node-name", node.node_id),
        element("span", "node-meta"),
      );
      const status = element("span", "node-state");
      status.append(
        element("span", "status-dot"),
        element("span", "state-label"),
      );
      button.append(symbol, label, status);
      container.append(button);
    }
    existing.delete(node.node_id);
    const scan = node.radios[view.radio];
    const state = !connected
      ? "Unknown"
      : !node.online
        ? "Offline"
        : scan.status === "error"
          ? "Error"
          : "Online";
    button.querySelector(".node-meta").textContent =
      `${floorLabel(floorFor(node.node_id, placements))} · ${node.scanner === "dummy" ? "Dummy" : "Real Pi"} · ${scan.status === "waiting" ? "waiting" : `${scan.observations.length} ${scan.status === "error" || !node.online ? "previous" : "results"}`}`;
    button.querySelector(".state-label").textContent = state;
    button.querySelector(".node-state").className =
      `node-state ${state === "Error" ? "error" : state !== "Online" ? "offline" : ""}`;
    button.classList.toggle("active", view.nodeId === node.node_id);
    button.setAttribute("aria-pressed", view.nodeId === node.node_id);
    button.setAttribute(
      "aria-label",
      `${node.node_id}, ${state}, ${scan.observations.length} observations`,
    );
  }
  for (const button of existing.values()) button.remove();
}
