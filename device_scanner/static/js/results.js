import { $, element, icon, setText, observationStateText } from "./ui.js";
import { signalText, signalPercent } from "./observations.js";

function createRow(row) {
  const tr = element("tr");
  tr.dataset.key = row.id;
  const nameCell = element("td");
  const button = element("button", "result-name");
  button.type = "button";
  button.append(icon(row.radio), element("span", "name-text"));
  nameCell.append(button, element("span", "address"));
  const signal = element("td", "signal-cell");
  const track = element("div", "signal-track");
  track.setAttribute("aria-hidden", "true");
  track.append(element("span", "signal-fill"));
  signal.append(element("span", "signal-reading"), track);
  const channel = element("td");
  channel.append(
    element("span", "channel-value"),
    element("span", "cell-secondary"),
  );
  const security = element("td");
  security.append(element("span", "security-badge"));
  const node = element("td");
  node.append(element("span", "row-node"), element("span", "cell-secondary"));
  const arrow = element("td", "row-arrow");
  arrow.append(icon("arrow"));
  tr.append(nameCell, signal, channel, security, node, arrow);
  return tr;
}

export function renderResults(rows, view, context) {
  const wifi = view.radio === "wifi";
  setText(
    $("results-name"),
    wifi ? "Wi-Fi kaynak gözlemleri" : "Bluetooth kaynak gözlemleri",
  );
  $("result-count").textContent = rows.length;
  $("name-column").textContent = wifi ? "AĞ / BSSID" : "CİHAZ / ADRES";
  $("channel-column").textContent = wifi ? "KANAL" : "TÜR";
  $("security-column").textContent = wifi ? "GÜVENLİK" : "ÖZELLİKLER";
  $("scope-caption").textContent =
    `${view.nodeId === "all" ? "Tüm sensörler" : view.nodeId} · her Pi'nin ölçümü ayrı gösterilir`;
  const body = $("results");
  const existing = new Map(
    [...body.children].map((row) => [row.dataset.key, row]),
  );
  rows.forEach((row, index) => {
    const tr = existing.get(row.id) || createRow(row);
    existing.delete(row.id);
    setText(tr.querySelector(".name-text"), row.name);
    tr.querySelector(".result-name").title = row.name;
    tr.querySelector(".result-name").setAttribute(
      "aria-pressed",
      row.id === view.selectedId,
    );
    setText(tr.querySelector(".address"), row.address);
    setText(tr.querySelector(".signal-reading"), signalText(row.signal));
    const percent = signalPercent(row.signal);
    tr.querySelector(".signal-fill").style.width = `${percent}%`;
    tr.querySelector(".signal-fill").classList.toggle("weak", percent < 40);
    setText(
      tr.querySelector(".channel-value"),
      wifi ? (row.channel ?? "—") : row.record.Type,
    );
    setText(
      tr.children[2].querySelector(".cell-secondary"),
      wifi && row.band !== "unknown" ? `${row.band} GHz` : "",
    );
    setText(tr.querySelector(".security-badge"), row.security);
    setText(tr.querySelector(".row-node"), row.nodeId);
    setText(
      tr.children[4].querySelector(".cell-secondary"),
      !context.connected
        ? "Sunucuya ulaşılamıyor"
        : row.state === "latest"
          ? row.scanner === "dummy"
            ? "Demo"
            : "Gerçek Pi"
          : `Önceki · ${observationStateText(row.state)}`,
    );
    tr.classList.toggle("selected", row.id === view.selectedId);
    tr.classList.toggle(
      "previous",
      row.state !== "latest" || !context.connected,
    );
    if (body.children[index] !== tr)
      body.insertBefore(tr, body.children[index] || null);
  });
  for (const tr of existing.values()) tr.remove();
  $("empty-state").hidden = rows.length > 0;
  const filtered = Boolean(view.query.trim() || (wifi && view.band !== "all"));
  $("clear-filters").hidden = !filtered;
  const problem = context.nodes.find((node) => node.node_id === view.nodeId)
    ?.radios[view.radio];
  $("empty-title").textContent = filtered
    ? "Eşleşen gözlem yok"
    : !context.nodes.length
      ? "Sensörler bekleniyor"
      : problem?.status === "error"
        ? "Bu radyo tarama yapamıyor"
        : problem?.status === "success"
          ? "Son taramada kayıt görülmedi"
          : "Tarama sonuçları bekleniyor";
  $("empty-description").textContent = filtered
    ? "Başka bir ad veya adres deneyin ya da filtreleri temizleyin."
    : problem?.status === "error"
      ? problem.error
      : problem?.status === "success"
        ? "Tarama başarıyla tamamlandı; kayıt bulunamadı. Yeni gözlemler otomatik görünür."
        : "Pi'ler tarama gönderdiğinde gözlemler burada görünür. Her sensör bağımsız çalışır.";
  const previous = rows.filter((row) => row.state !== "latest").length;
  $("results-summary").textContent =
    `${context.total} gözlemden ${rows.length} gösteriliyor${previous ? ` · ${previous} önceki gözlem` : ""}${!context.connected ? " · sunucuya ulaşılamıyor" : ""}`;
}
