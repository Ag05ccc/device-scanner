import { $, element, ageText, setText } from "./ui.js";
import { floorFor, floorLabel } from "./placement.js";
import { scanRate } from "./rates.js";

export function radioState(node, radio, connected) {
  const scan = node.radios[radio];
  if (scan.enabled === false) return "Kapalı";
  if (!connected) return "Durum bilinmiyor";
  if (!node.online) return "Sensör çevrimdışı";
  return (
    {
      fresh: "Güncel",
      error: "Tarama hatası",
      stale: "Tarama gecikti",
      waiting: "İlk tarama bekleniyor",
      disabled: "Kapalı",
    }[scan.freshness] || "İlk tarama bekleniyor"
  );
}

export function renderNodes(nodes, view, connected, placements) {
  const tbody = $("nodes");
  const old = new Map(
    [...tbody.children].map((row) => [row.dataset.nodeId, row]),
  );
  for (const node of nodes) {
    let row = old.get(node.node_id);
    if (!row) {
      row = element("tr");
      row.dataset.nodeId = node.node_id;
      const name = element("td");
      const button = element("button", "text-button", node.node_id);
      button.type = "button";
      name.append(
        button,
        element(
          "small",
          "cell-secondary",
          node.scanner === "dummy" ? "Demo sensör" : "Gerçek sensör",
        ),
      );
      row.append(
        name,
        element("td", "sensor-floor"),
        element("td", "sensor-connection"),
      );
      for (const radio of ["wifi", "bluetooth"]) {
        const cell = element("td", "sensor-" + radio);
        cell.append(
          element("span"),
          element("small", "cell-secondary"),
          element("small", "sensor-error"),
        );
        const rate = element("div", "sensor-rate");
        rate.append(
          element("strong", "sensor-rate-value"),
          element("small", "sensor-rate-period"),
        );
        cell.append(rate);
        row.append(cell);
      }
      tbody.append(row);
    }
    old.delete(node.node_id);
    setText(
      row.querySelector("td:first-child small"),
      node.scanner === "dummy" ? "Demo sensör" : "Gerçek sensör",
    );
    row.classList.toggle("selected", view.nodeId === node.node_id);
    setText(
      row.querySelector(".sensor-floor"),
      floorLabel(floorFor(node.node_id, placements)),
    );
    setText(
      row.querySelector(".sensor-connection"),
      !connected ? "Bilinmiyor" : node.online ? "Çevrimiçi" : "Çevrimdışı",
    );
    for (const radio of ["wifi", "bluetooth"]) {
      const cell = row.querySelector(".sensor-" + radio);
      const scan = node.radios[radio];
      setText(cell.querySelector("span"), radioState(node, radio, connected));
      cell.dataset.state = scan.freshness;
      const rate = scanRate(scan, node.online, connected);
      setText(cell.querySelector(".sensor-rate-value"), rate.text);
      setText(cell.querySelector(".sensor-rate-period"), rate.detail);
      cell.querySelector(".sensor-rate").title = rate.title;
      setText(
        cell.querySelector(".cell-secondary"),
        scan.last_success_at
          ? `Son başarılı: ${ageText(scan.last_success_at)}`
          : "Başarılı tarama yok",
      );
      setText(cell.querySelector(".sensor-error"), scan.error || "");
      cell.querySelector(".sensor-error").hidden = !scan.error;
    }
  }
  for (const row of old.values()) row.remove();
  $("sensors-empty").hidden = nodes.length > 0;
}
