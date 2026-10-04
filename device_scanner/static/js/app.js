// The coordinator owns page state. Views render it; only api.js talks to Python.
import { $, icon, ageText } from "./ui.js";
import { startPolling } from "./api.js";
import {
  RADIOS,
  observations,
  filterRows,
  sortRows,
  recordHistory,
} from "./observations.js";
import { renderNodes } from "./nodes.js";
import { renderResults } from "./results.js";
import { renderDetails } from "./details.js";
import { renderHistory, renderDistribution } from "./charts.js";
import { exportDocument, downloadReport } from "./export.js";

const view = {
  radio: "wifi",
  nodeId: "all",
  query: "",
  band: "all",
  sort: "signal",
  selectedId: null,
};
let nodes = [];
let connected = false;
let receivedAt = null;
let rows = [];
let order = [];
const history = new Map();

function renderMetrics() {
  const scoped = nodes.filter(
    (node) => view.nodeId === "all" || node.node_id === view.nodeId,
  );
  const latest = observations(nodes, view.radio, view.nodeId).filter(
    (row) => row.state === "latest",
  );
  const strongest = sortRows(latest.filter((row) => row.signal !== null))[0];
  const online = nodes.filter((node) => node.online).length;
  const errors = scoped.reduce(
    (sum, node) =>
      sum +
      RADIOS.filter((radio) => node.radios[radio].status === "error").length,
    0,
  );
  $("online-value").textContent = connected ? online : "—";
  $("online-total").textContent = `/ ${nodes.length}`;
  $("online-note").textContent = !connected
    ? "Awaiting server connection"
    : `${nodes.length - online} offline · across the workspace`;
  $("observations-label").replaceChildren(
    document.createTextNode(
      view.radio === "wifi" ? "Wi-Fi observations" : "Bluetooth observations",
    ),
    icon(view.radio),
  );
  $("observations-value").textContent = connected ? latest.length : "—";
  $("observations-note").textContent =
    `${view.nodeId === "all" ? "All scanners" : view.nodeId} · latest successful results`;
  $("signal-value").textContent =
    connected && strongest ? strongest.signal : "—";
  $("signal-unit").textContent = connected && strongest ? "dBm" : "";
  $("signal-note").textContent =
    connected && strongest
      ? `${strongest.name} · ${strongest.nodeId}`
      : "No current signal measurement";
  $("errors-value").textContent = connected ? errors : "—";
  $("errors-tag").classList.toggle("alert", errors > 0 && connected);
  $("errors-note").textContent =
    `${view.nodeId === "all" ? "All scanners" : view.nodeId} · Bluetooth and Wi-Fi`;
  for (const radio of RADIOS) {
    $("radio-" + radio).classList.toggle("active", view.radio === radio);
    $("radio-" + radio).setAttribute("aria-pressed", view.radio === radio);
    $(radio + "-count").textContent = connected
      ? observations(nodes, radio, view.nodeId).filter(
          (row) => row.state === "latest",
        ).length
      : "—";
  }
}

function render() {
  if (
    view.nodeId !== "all" &&
    !nodes.some((node) => node.node_id === view.nodeId)
  )
    view.nodeId = "all";
  const all = observations(nodes, view.radio, view.nodeId);
  const filtered = sortRows(filterRows(all, view), view.sort);
  const byId = new Map(filtered.map((row) => [row.id, row]));
  order = order.filter((id) => byId.has(id));
  const known = new Set(order);
  order.push(
    ...filtered.filter((row) => !known.has(row.id)).map((row) => row.id),
  );
  rows = order.map((id) => byId.get(id));
  if (!rows.some((row) => row.id === view.selectedId))
    view.selectedId = rows[0]?.id || null;
  const selected = rows.find((row) => row.id === view.selectedId);
  renderMetrics();
  renderNodes(nodes, view, connected);
  renderResults(rows, view, { nodes, connected, total: all.length });
  renderDetails(selected, connected);
  renderHistory(selected, history, connected);
  renderDistribution(rows, view.radio, connected);
  $("band-label").hidden = view.radio !== "wifi";
  $("radio-note").textContent =
    view.radio === "wifi"
      ? "Wi-Fi shows access points, not connected clients."
      : "Bluetooth signal is measured in dBm, not distance.";
  $("updated").textContent = receivedAt
    ? `Last updated · ${ageText(receivedAt)}`
    : "Waiting for first update";
  for (const format of ["json", "csv"])
    $("export-" + format).disabled = !receivedAt;
}

function changeView(changes) {
  Object.assign(view, changes);
  order = [];
  render();
}

function connectionChanged(value) {
  connected = value;
  $("connection").classList.toggle("disconnected", !value);
  $("connection-text").textContent = value
    ? "Server connected"
    : "Reconnecting";
  $("connection-banner").hidden = value;
  $("connection-banner").textContent = receivedAt
    ? `Server connection lost. Showing the last received results from ${new Date(receivedAt).toLocaleTimeString()}. These results are outdated; retrying automatically.`
    : "Cannot reach the scanner server. Retrying automatically.";
  $("footer-status").textContent = value
    ? "Automatic updates every 2 seconds"
    : "Reconnecting · displayed data may be outdated";
  render();
}

$("all-nodes").addEventListener("click", () => changeView({ nodeId: "all" }));
$("nodes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-node-id]");
  if (button) changeView({ nodeId: button.dataset.nodeId });
});
for (const radio of RADIOS)
  $("radio-" + radio).addEventListener("click", () => changeView({ radio }));
$("search").addEventListener("input", () =>
  changeView({ query: $("search").value }),
);
$("band").addEventListener("change", () =>
  changeView({ band: $("band").value }),
);
$("sort").addEventListener("change", () =>
  changeView({ sort: $("sort").value }),
);
$("sort-now").addEventListener("click", () => changeView({}));
$("clear-filters").addEventListener("click", () => {
  $("search").value = "";
  $("band").value = "all";
  changeView({ query: "", band: "all" });
});
$("results").addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-key]");
  if (row) {
    view.selectedId = row.dataset.key;
    render();
  }
});
$("results").addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  const current = event.target.closest("tr[data-key]");
  if (!current) return;
  event.preventDefault();
  const index = rows.findIndex((row) => row.id === current.dataset.key);
  const next =
    rows[
      Math.max(
        0,
        Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
      )
    ];
  if (next) {
    view.selectedId = next.id;
    render();
    [...$("results").children]
      .find((row) => row.dataset.key === next.id)
      ?.querySelector("button")
      .focus();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    document.querySelector(".export-menu").open = false;
  if (
    event.target.closest("input, select, textarea, [contenteditable]") ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  if (event.key === "/") {
    event.preventDefault();
    $("search").focus();
  }
});
for (const format of ["json", "csv"])
  $("export-" + format).addEventListener("click", () => {
    downloadReport(exportDocument(rows, view, connected, receivedAt), format);
    document.querySelector(".export-menu").open = false;
  });

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
  $("theme").setAttribute("aria-label", label);
  $("theme").title = label;
}
let savedTheme;
try {
  savedTheme = localStorage.getItem("device-scanner-theme");
} catch {
  /* Browser storage can be disabled. */
}
applyTheme(
  ["light", "dark"].includes(savedTheme)
    ? savedTheme
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
);
$("theme").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try {
    localStorage.setItem("device-scanner-theme", theme);
  } catch {
    /* Theme still works without storage. */
  }
});

render();
const polling = startPolling((snapshot) => {
  nodes = snapshot;
  receivedAt = new Date().toISOString();
  recordHistory(
    history,
    RADIOS.flatMap((radio) => observations(nodes, radio)),
  );
}, connectionChanged);
$("refresh").addEventListener("click", () => polling.refresh());
