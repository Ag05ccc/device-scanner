// Coordinates navigation and selection. Models own meanings; views own DOM.
import { $, ageText, element, setText } from "./ui.js";
import { startPolling, savePlacement } from "./api.js";
import {
  RADIOS,
  observations,
  filterRows,
  sortRows,
  recordHistory,
} from "./observations.js";
import { devices, filterDevices, sortDevices, summary } from "./entities.js";
import { renderOverview } from "./overview.js";
import { renderDevices, renderDeviceDetails } from "./devices.js";
import { renderNodes } from "./nodes.js";
import { renderBuilding } from "./building.js";
import { renderResults } from "./results.js";
import { renderDetails } from "./details.js";
import { renderHistory, renderDistribution } from "./charts.js";
import { exportDocument, downloadReport } from "./export.js";

const view = {
  radio: "all",
  floor: "all",
  status: "all",
  query: "",
  sort: "name",
  selectedId: null,
};
const analysis = {
  radio: "wifi",
  nodeId: "all",
  query: "",
  band: "all",
  sort: "signal",
  selectedId: null,
};
const sensors = { nodeId: "all" };
const pages = {
  overview: [
    "Binanın kablosuz ortamı",
    "Görülen cihazlar, katlar ve gözlem durumu.",
  ],
  devices: [
    "Görülen cihazlar",
    "Her kablosuz adres tek satırda. Gözlem kaynakları ayrıntılarda.",
  ],
  sensors: [
    "Sensörler ve kat yerleşimi",
    "Pi bağlantılarını, tarama durumunu ve kat atamalarını yönetin.",
  ],
  analysis: [
    "Gözlem analizi",
    "Her Pi'nin ölçümünü ayrı inceleyin; sinyal geçmişini ve kanalları karşılaştırın.",
  ],
};
let tab = "overview",
  nodes = [],
  connected = false,
  receivedAt = null,
  session = null;
let entities = [],
  visibleDevices = [],
  source = null,
  selectedSourceId = null,
  limit = 50;
let deviceOrder = [],
  analysisOrder = [],
  analysisRows = [];
let placements = new Map();
const history = new Map();
let returnFocus = null;

function stableRows(rows, order) {
  const map = new Map(rows.map((row) => [row.id, row]));
  const kept = order.filter((id) => map.has(id));
  const known = new Set(kept);
  kept.push(...rows.filter((row) => !known.has(row.id)).map((row) => row.id));
  return [kept.map((id) => map.get(id)), kept];
}

function renderAnalysis() {
  const all = observations(nodes, analysis.radio, analysis.nodeId);
  [analysisRows, analysisOrder] = stableRows(
    sortRows(filterRows(all, analysis), analysis.sort),
    analysisOrder,
  );
  if (!analysisRows.some((row) => row.id === analysis.selectedId))
    analysis.selectedId = analysisRows[0]?.id || null;
  const selected = analysisRows.find((row) => row.id === analysis.selectedId);
  renderResults(analysisRows, analysis, {
    nodes,
    connected,
    total: all.length,
  });
  renderDetails(selected, connected);
  renderHistory(selected, history, connected);
  renderDistribution(analysisRows, analysis.radio, connected);
  $("band-label").hidden = analysis.radio !== "wifi";
  for (const radio of RADIOS) {
    $("radio-" + radio).classList.toggle("active", analysis.radio === radio);
    $("radio-" + radio).setAttribute("aria-pressed", analysis.radio === radio);
    setText(
      $(radio + "-count"),
      connected
        ? observations(nodes, radio, analysis.nodeId).filter(
            (row) => row.state === "latest",
          ).length
        : "—",
    );
  }
  setText(
    $("updated"),
    receivedAt
      ? `Son veri alımı · ${ageText(receivedAt)}`
      : "İlk veri bekleniyor",
  );
  setText(
    $("radio-note"),
    analysis.radio === "wifi"
      ? "Wi-Fi erişim noktalarını gösterir. Aynı BSSID, farklı Pi ölçümlerinde ayrı satırdır."
      : "Bluetooth RSSI sinyal gücüdür; mesafe veya bağlantı kalitesi değildir.",
  );
  for (const format of ["json", "csv"])
    $("export-" + format).disabled = !receivedAt;
  const select = $("analysis-node");
  const expected = ["all", ...nodes.map((node) => node.node_id)];
  if (
    JSON.stringify([...select.options].map((o) => o.value)) !==
    JSON.stringify(expected)
  ) {
    select.replaceChildren(
      ...expected.map((id) => {
        const option = element(
          "option",
          "",
          id === "all" ? "Tüm sensörler" : id,
        );
        option.value = id;
        return option;
      }),
    );
  }
  select.value = analysis.nodeId;
}

function render() {
  entities = devices(nodes, connected);
  const totals = summary(nodes, entities, connected);
  renderOverview(nodes, entities, totals, view, connected);
  const filtered = sortDevices(filterDevices(entities, view), view.sort);
  [visibleDevices, deviceOrder] = stableRows(filtered, deviceOrder);
  renderDevices(visibleDevices.slice(0, limit), view, {
    total: visibleDevices.length,
    visible: entities.length,
    nodes,
    connected,
    summary: totals,
  });
  if ($("device-drawer").open)
    source = renderDeviceDetails(
      entities.find((entity) => entity.id === view.selectedId),
      selectedSourceId,
      history,
      connected,
    );
  if (source) selectedSourceId = source.id;
  if (!nodes.some((node) => node.node_id === sensors.nodeId))
    sensors.nodeId = "all";
  if (!nodes.some((node) => node.node_id === analysis.nodeId))
    analysis.nodeId = "all";
  renderNodes(nodes, sensors, connected, placements);
  renderBuilding(nodes, sensors, connected, placements);
  renderAnalysis();
}

function changeTab(next) {
  if (!pages[next]) return;
  tab = next;
  for (const button of document.querySelectorAll("[data-tab]")) {
    if (button.dataset.tab === tab) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  setText($("page-title"), pages[tab][0]);
  setText($("page-description"), pages[tab][1]);
  $("overview-summary").hidden = tab !== "overview";
  $("view-observations").hidden = !["overview", "devices"].includes(tab);
  $("floor-overview").hidden = tab !== "overview";
  $("open-all-devices").hidden = tab !== "overview";
  $("view-observations").classList.toggle("full-width", tab === "devices");
  $("view-sensors").hidden = tab !== "sensors";
  $("view-analysis").hidden = tab !== "analysis";
  render();
}

function changeDevices(changes) {
  Object.assign(view, changes);
  deviceOrder = [];
  limit = 50;
  for (const name of ["radio", "floor", "status", "sort"])
    $("device-" + name).value = view[name];
  $("device-search").value = view.query;
  render();
}
function changeAnalysis(changes) {
  Object.assign(analysis, changes);
  analysisOrder = [];
  render();
}
function openDevice(id, trigger) {
  returnFocus = trigger;
  view.selectedId = id;
  selectedSourceId = null;
  $("device-drawer").showModal();
  render();
  $("device-close").focus();
}
$("device-drawer").addEventListener("close", () => {
  view.selectedId = null;
  source = null;
  selectedSourceId = null;
  render();
  if (returnFocus?.isConnected && returnFocus.getClientRects().length)
    returnFocus.focus();
});
$("device-close").addEventListener("click", () => $("device-drawer").close());
$("device-drawer").addEventListener("click", (event) => {
  if (event.target === $("device-drawer")) {
    const r = event.target.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      event.target.close();
  }
});
for (const button of document.querySelectorAll("[data-tab]"))
  button.addEventListener("click", () => changeTab(button.dataset.tab));
$("inspect-health").addEventListener("click", () => changeTab("sensors"));
$("open-all-devices").addEventListener("click", () => changeTab("devices"));
for (const button of document.querySelectorAll("[data-metric]"))
  button.addEventListener("click", () => {
    const metric = button.dataset.metric;
    changeDevices({
      radio: metric === "new" ? "all" : metric,
      status: metric === "new" ? "new" : "all",
    });
  });
$("floor-summaries").addEventListener("click", (event) => {
  const button = event.target.closest("[data-floor]");
  if (button)
    changeDevices({
      floor: view.floor === button.dataset.floor ? "all" : button.dataset.floor,
    });
});
$("reset-floor").addEventListener("click", () =>
  changeDevices({ floor: "all" }),
);
for (const name of ["radio", "floor", "status", "sort"])
  $("device-" + name).addEventListener("change", (event) =>
    changeDevices({ [name]: event.target.value }),
  );
$("device-search").addEventListener("input", (event) =>
  changeDevices({ query: event.target.value }),
);
$("device-sort-now").addEventListener("click", () => changeDevices({}));
$("device-clear-filters").addEventListener("click", () =>
  changeDevices({ query: "", radio: "all", floor: "all", status: "all" }),
);
$("device-more").addEventListener("click", () => {
  limit += 50;
  render();
});
$("device-rows").addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-key]");
  if (row) openDevice(row.dataset.key, row.querySelector("button"));
});
$("device-rows").addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  const row = event.target.closest("tr[data-key]");
  if (!row) return;
  event.preventDefault();
  const rows = [...$("device-rows").children];
  const index = rows.indexOf(row);
  rows[
    Math.max(
      0,
      Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
    )
  ]
    .querySelector("button")
    .focus();
});
$("device-sources").addEventListener("click", (event) => {
  const button = event.target.closest("[data-source-id]");
  if (button) {
    selectedSourceId = button.dataset.sourceId;
    render();
  }
});
$("device-open-analysis").addEventListener("click", () => {
  if (!source) return;
  Object.assign(analysis, {
    radio: source.radio,
    nodeId: source.nodeId,
    query: source.record.MAC,
    band: "all",
    selectedId: source.id,
  });
  $("search").value = analysis.query;
  $("band").value = "all";
  analysisOrder = [];
  $("device-drawer").close();
  changeTab("analysis");
  $("analysis-node").focus();
});
$("building").addEventListener("click", (event) => {
  const button = event.target.closest(".building-node");
  if (button) {
    sensors.nodeId = button.dataset.nodeId;
    render();
  }
});
$("nodes").addEventListener("click", (event) => {
  const row = event.target.closest("[data-node-id]");
  if (row) {
    sensors.nodeId = row.dataset.nodeId;
    render();
    $("placement-floor").focus();
  }
});
$("building-all").addEventListener("click", () => {
  sensors.nodeId = "all";
  render();
});
$("sensor-analysis").addEventListener("click", () => {
  Object.assign(analysis, { nodeId: sensors.nodeId, query: "", band: "all" });
  $("search").value = "";
  $("band").value = "all";
  analysisOrder = [];
  changeTab("analysis");
});
$("placement-floor").addEventListener("change", async (event) => {
  const id = sensors.nodeId;
  if (id === "all") return;
  const floor =
    event.target.value === "unplaced" ? null : Number(event.target.value);
  const wasFocused = document.activeElement === event.target;
  event.target.disabled = true;
  setText($("placement-note"), "Kat kaydediliyor…");
  try {
    await savePlacement(id, floor);
    const node = nodes.find((node) => node.node_id === id);
    if (node) node.floor = floor;
    placements.set(id, floor);
    setText(
      $("placement-note"),
      "Kat sunucuda kaydedildi. Tüm kullanıcılar için geçerli.",
    );
  } catch {
    setText(
      $("placement-note"),
      "Kat kaydedilemedi. Bağlantıyı kontrol edip yeniden deneyin.",
    );
  } finally {
    $("placement-floor").disabled = false;
    render();
    if (
      wasFocused &&
      document.activeElement === document.body &&
      tab === "sensors"
    )
      $("placement-floor").focus();
  }
});
for (const radio of RADIOS)
  $("radio-" + radio).addEventListener("click", () =>
    changeAnalysis({ radio }),
  );
$("analysis-node").addEventListener("change", (event) =>
  changeAnalysis({ nodeId: event.target.value }),
);
$("search").addEventListener("input", (event) =>
  changeAnalysis({ query: event.target.value }),
);
for (const key of ["band", "sort"])
  $(key).addEventListener("change", (event) =>
    changeAnalysis({ [key]: event.target.value }),
  );
$("sort-now").addEventListener("click", () => changeAnalysis({}));
$("clear-filters").addEventListener("click", () => {
  $("search").value = "";
  $("band").value = "all";
  changeAnalysis({ query: "", band: "all" });
});
$("results").addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-key]");
  if (row) {
    analysis.selectedId = row.dataset.key;
    render();
  }
});
$("results").addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  const row = event.target.closest("tr[data-key]");
  if (!row) return;
  event.preventDefault();
  const index = analysisRows.findIndex((r) => r.id === row.dataset.key);
  const next =
    analysisRows[
      Math.max(
        0,
        Math.min(
          analysisRows.length - 1,
          index + (event.key === "ArrowDown" ? 1 : -1),
        ),
      )
    ];
  if (next) {
    analysis.selectedId = next.id;
    render();
    [...$("results").children]
      .find((r) => r.dataset.key === next.id)
      ?.querySelector("button")
      .focus();
  }
});
for (const format of ["json", "csv"])
  $("export-" + format).addEventListener("click", () => {
    downloadReport(
      exportDocument(analysisRows, analysis, connected, receivedAt),
      format,
    );
    document.querySelector(".export-menu").open = false;
  });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    document.querySelector(".export-menu").open = false;
  if (
    event.target.closest("input, select, textarea, [contenteditable]") ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    $("device-drawer").open
  )
    return;
  if (
    ["1", "2", "3"].includes(event.key) &&
    ["overview", "devices"].includes(tab)
  ) {
    event.preventDefault();
    changeDevices({ floor: event.key });
  }
  if (event.key === "/" && tab !== "sensors") {
    event.preventDefault();
    $(tab === "analysis" ? "search" : "device-search").focus();
  }
});
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç";
  $("theme").setAttribute("aria-label", label);
  $("theme").title = label;
}
let savedTheme;
try {
  savedTheme = localStorage.getItem("device-scanner-theme");
} catch {
  /* Storage is optional. */
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
    /* Session theme still works. */
  }
});
function connectionChanged(value) {
  if (connected && !value)
    recordHistory(
      history,
      RADIOS.flatMap((radio) => observations(nodes, radio)).map((row) => ({
        ...row,
        state: "disconnected",
      })),
    );
  connected = value;
  $("connection").classList.toggle("disconnected", !value);
  setText($("connection-text"), value ? "Canlı veri" : "Yeniden bağlanıyor");
  $("connection-banner").hidden = value;
  setText(
    $("connection-banner"),
    receivedAt
      ? `Sunucu bağlantısı kesildi. Son veri alımı: ${new Date(receivedAt).toLocaleTimeString("tr-TR")}. Yeniden deneniyor; güncellik bilinmiyor.`
      : "Sunucuya ulaşılamıyor. Otomatik olarak yeniden deneniyor.",
  );
  setText(
    $("footer-status"),
    value ? "2 saniyede bir güncellenir" : "Sunucu bağlantısı bekleniyor",
  );
  render();
}
render();
const polling = startPolling((snapshot) => {
  if (session && session !== snapshot.session_started_at) {
    history.clear();
    deviceOrder = [];
    analysisOrder = [];
  }
  const previousModes = new Map(
    nodes.map((node) => [node.node_id, node.scanner]),
  );
  const changedModes = new Set(
    snapshot.nodes
      .filter(
        (node) =>
          previousModes.has(node.node_id) &&
          previousModes.get(node.node_id) !== node.scanner,
      )
      .map((node) => node.node_id),
  );
  // A real scan must never inherit the same node's synthetic signal samples.
  for (const key of history.keys())
    if (changedModes.has(JSON.parse(key)[0])) history.delete(key);
  session = snapshot.session_started_at;
  nodes = snapshot.nodes;
  receivedAt = new Date().toISOString();
  placements = new Map(nodes.map((node) => [node.node_id, node.floor ?? null]));
  recordHistory(
    history,
    RADIOS.flatMap((radio) => observations(nodes, radio)),
  );
}, connectionChanged);
$("refresh").addEventListener("click", () => polling.refresh());
