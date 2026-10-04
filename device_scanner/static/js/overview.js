import { $, element, setText, ageText } from "./ui.js";
import { floorSummaries } from "./entities.js";

const countText = (value) => (value === null ? "—" : String(value));
let announcedState = null;

// Global numbers never change meaning when the device list is filtered.
export function renderOverview(nodes, entities, summary, view, connected) {
  for (const radio of ["wifi", "bluetooth"]) {
    const coverage = summary.radios[radio];
    setText($("summary-" + radio), countText(coverage.count));
    setText(
      $("summary-" + radio + "-note"),
      coverage.total === 0 && coverage.disabled
        ? "Bu radyo sensörlerde kapalı"
        : coverage.availability === "none"
          ? "Güncel gözlem yok"
          : coverage.availability === "partial"
            ? "Kısmi gözlem · sayı eksik olabilir"
            : "Bina genelinde farklı adresler",
    );
  }
  setText($("summary-new"), countText(summary.counts.new));
  const kind = !connected
    ? "connection"
    : !nodes.length
      ? "waiting"
      : summary.issues.length
        ? "partial"
        : summary.sensorWorking
          ? "ready"
          : "disabled";
  let message;
  if (kind === "connection")
    message = "Sunucuya ulaşılamıyor. Son gözlemlerin güncelliği bilinmiyor.";
  else if (kind === "waiting")
    message = "Henüz gözlem yok. Sensörlerin ilk taraması bekleniyor.";
  else if (kind === "partial") message = summary.issues[0].message;
  else if (kind === "disabled")
    message = "Sensörlerin radyoları kapalı. Güncel gözlem yok.";
  else {
    const seen = [];
    if (summary.counts.wifi !== null)
      seen.push(`${summary.counts.wifi} Wi-Fi erişim noktası`);
    if (summary.counts.bluetooth !== null)
      seen.push(`${summary.counts.bluetooth} Bluetooth cihazı`);
    message = `${seen.join(" ve ")} görüldü. Etkin radyoların gözlemleri güncel.`;
  }
  setText($("environment-message"), message);
  $("environment-status").dataset.state = kind;
  if (announcedState !== kind) {
    setText($("status-announcement"), message);
    announcedState = kind;
  }
  setText(
    $("coverage-state"),
    kind === "ready"
      ? "Gözlemler güncel"
      : kind === "partial"
        ? "Gözlem eksik"
        : kind === "connection"
          ? "Güncellik bilinmiyor"
          : kind === "disabled"
            ? "Radyolar kapalı"
            : "Gözlem bekleniyor",
  );
  setText(
    $("coverage-value"),
    connected ? `${summary.sensorWorking} / ${summary.sensorTotal}` : "—",
  );
  setText($("coverage-note"), "Sensörün etkin radyoları güncel");
  $("demo-banner").hidden = !summary.demo;
  setText(
    $("demo-banner"),
    summary.mixed
      ? "KARMA VERİ · Gerçek ölçümler ve demo cihazları birlikte gösteriliyor."
      : "DEMO · Cihazlar ve sinyal ölçümleri simülasyondur.",
  );
  const scanDates = nodes
    .flatMap((node) =>
      Object.values(node.radios).map((scan) => scan.last_success_at),
    )
    .filter(Boolean)
    .sort();
  setText(
    $("last-observation"),
    scanDates.length
      ? `Son başarılı tarama · ${ageText(scanDates.at(-1))}`
      : "İlk başarılı tarama bekleniyor",
  );
  const floors = floorSummaries(nodes, entities, connected).filter(
    (f) => f.floor !== null || f.nodeIds.length,
  );
  const existing = new Map(
    [...$("floor-summaries").children].map((el) => [el.dataset.floor, el]),
  );
  const max = Math.max(
    1,
    ...floors.map((f) => (f.counts.wifi || 0) + (f.counts.bluetooth || 0)),
  );
  for (const floor of floors.sort(
    (a, b) => (b.floor ?? -1) - (a.floor ?? -1),
  )) {
    const key = floor.floor === null ? "unassigned" : String(floor.floor);
    let button = existing.get(key);
    if (!button) {
      button = element("button", "floor-summary");
      button.type = "button";
      button.dataset.floor = key;
      const heading = element("span", "floor-summary-heading");
      heading.append(element("strong"), element("span", "floor-availability"));
      const values = element("span", "floor-values");
      values.append(element("span", "wifi-value"), element("span", "bt-value"));
      const bar = element("span", "floor-bars");
      bar.setAttribute("aria-hidden", "true");
      bar.append(element("i", "wifi-bar"), element("i", "bt-bar"));
      button.append(heading, values, bar);
      $("floor-summaries").append(button);
    }
    existing.delete(key);
    setText(button.querySelector("strong"), floor.label);
    setText(
      button.querySelector(".floor-availability"),
      !floor.nodeIds.length
        ? "Sensör yok"
        : floor.availability === "none"
          ? "Veri yok"
          : floor.availability === "partial"
            ? "Kısmi"
            : "Güncel",
    );
    setText(
      button.querySelector(".wifi-value"),
      `${countText(floor.counts.wifi)} Wi-Fi`,
    );
    setText(
      button.querySelector(".bt-value"),
      `${countText(floor.counts.bluetooth)} BT`,
    );
    button.querySelector(".wifi-bar").style.width =
      `${((floor.counts.wifi || 0) / max) * 100}%`;
    button.querySelector(".bt-bar").style.width =
      `${((floor.counts.bluetooth || 0) / max) * 100}%`;
    button.setAttribute("aria-pressed", view.floor === key);
    button.classList.toggle("active", view.floor === key);
  }
  for (const el of existing.values()) el.remove();
}
