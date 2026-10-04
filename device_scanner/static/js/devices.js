import { $, element, icon, setText, ageText } from "./ui.js";
import { kindLabel } from "./entities.js";
import { signalText } from "./observations.js";
import { renderHistory } from "./charts.js";

export const stateLabels = {
  current: "Görüldü",
  recent: "Az önce görüldü",
  missing: "Artık görülmüyor",
  unknown: "Durum bilinmiyor",
};
const floorsText = (floors) =>
  floors.map((f) => (f === null ? "Atanmamış" : `${f}. kat`)).join(", ");

function createRow(entity) {
  const row = element("tr");
  row.dataset.key = entity.id;
  const name = element("td");
  const button = element("button", "device-name");
  button.type = "button";
  button.append(
    icon(entity.radio),
    element("span", "name-text"),
    element("span", "new-badge", "Yeni"),
  );
  name.append(button, element("span", "device-address"));
  row.append(
    name,
    element("td", "device-kind"),
    element("td", "device-floors"),
    element("td", "device-state-cell"),
    element("td", "device-signal"),
    element("td", "device-seen"),
  );
  row
    .querySelector(".device-state-cell")
    .append(element("span", "device-state"));
  return row;
}

export function renderDevices(
  rows,
  view,
  { total, visible, nodes, connected, summary },
) {
  const tbody = $("device-rows");
  const old = new Map([...tbody.children].map((el) => [el.dataset.key, el]));
  rows.forEach((entity, index) => {
    const row = old.get(entity.id) || createRow(entity);
    old.delete(entity.id);
    // Move only if the chosen order changed, preserving keyboard focus on polls.
    if (tbody.children[index] !== row)
      tbody.insertBefore(row, tbody.children[index] || null);
    setText(row.querySelector(".name-text"), entity.name);
    row.querySelector(".device-name").title = entity.name;
    row.querySelector(".new-badge").hidden = !entity.isNew;
    setText(row.querySelector(".device-address"), entity.address);
    setText(row.querySelector(".device-kind"), kindLabel(entity.kind));
    setText(row.querySelector(".device-floors"), floorsText(entity.floors));
    setText(row.querySelector(".device-state"), stateLabels[entity.state]);
    row.querySelector(".device-state").dataset.state = entity.state;
    setText(
      row.querySelector(".device-signal"),
      entity.signal === null ? "—" : signalText(entity.signal),
    );
    row.querySelector(".device-signal").title =
      "Güncel kaynaklardaki en güçlü RSSI; mesafe veya bağlantı kalitesi değildir.";
    setText(
      row.querySelector(".device-seen"),
      entity.lastSeenAt ? ageText(entity.lastSeenAt) : "Bilinmiyor",
    );
    row.classList.toggle("selected", entity.id === view.selectedId);
    row.querySelector("button").setAttribute("aria-haspopup", "dialog");
  });
  for (const row of old.values()) row.remove();
  const filtered =
    view.query ||
    view.radio !== "all" ||
    view.floor !== "all" ||
    view.status !== "all";
  setText($("device-count"), total);
  setText(
    $("device-scope"),
    `${view.floor === "all" ? "Tüm katlar" : view.floor === "unassigned" ? "Atanmamış" : `${view.floor}. kat`} · ${view.radio === "all" ? "tüm türler" : view.radio === "wifi" ? "Wi-Fi" : "Bluetooth"}`,
  );
  $("devices-empty").hidden = rows.length > 0;
  const available =
    summary.radios.wifi.available + summary.radios.bluetooth.available > 0;
  setText(
    $("devices-empty-title"),
    filtered
      ? "Filtrelerle eşleşen cihaz yok"
      : !connected
        ? "Güncel veri alınamıyor"
        : !nodes.length || !available
          ? "İlk güncel gözlem bekleniyor"
          : "Henüz cihaz görülmedi",
  );
  setText(
    $("devices-empty-description"),
    filtered
      ? "Aramayı veya filtreleri değiştirin."
      : !connected
        ? "Sunucu bağlantısı otomatik olarak yeniden deneniyor."
        : available
          ? "Başarılı taramalar alındı; görülen kablosuz adres yok."
          : "Sensörler başarılı tarama gönderdiğinde cihazlar burada görünür.",
  );
  $("device-clear-filters").hidden = !filtered;
  setText(
    $("device-list-note"),
    `${rows.length} / ${total} kayıt${filtered ? ` · bina genelinde ${visible}` : ""} · Her kablosuz adres tek satır`,
  );
  $("device-more").hidden = rows.length >= total;
}

export function renderDeviceDetails(
  entity,
  selectedSourceId,
  history,
  connected,
) {
  if (!entity) {
    delete $("device-identity").dataset.key;
    const title = element("h2", "", "Gözlem süresi doldu");
    title.id = "device-title";
    $("device-identity").replaceChildren(
      title,
      element(
        "p",
        "subtle",
        "Bu cihazın kısa dönem geçmişi sona erdi. Listeden başka bir cihaz seçin.",
      ),
    );
    $("device-sources").replaceChildren();
    $("device-raw").textContent = "";
    $("device-open-analysis").disabled = true;
    renderHistory(null, history, connected, "device-history");
    return null;
  }
  const container = $("device-identity");
  if (container.dataset.key !== entity.id || !container.querySelector("h2")) {
    container.dataset.key = entity.id;
    const title = element("h2");
    title.id = "device-title";
    container.replaceChildren(
      title,
      element("p", "drawer-address"),
      element("p", "drawer-description"),
      element("p", "drawer-times subtle"),
    );
  }
  setText($("device-title"), entity.name);
  setText(
    container.querySelector(".drawer-address"),
    `${entity.address} · ${entity.typeLabel}`,
  );
  setText(
    container.querySelector(".drawer-description"),
    `${stateLabels[entity.state]} · ${kindLabel(entity.kind)} · ${floorsText(entity.floors)}`,
  );
  const localDate = (value) =>
    value ? new Date(value).toLocaleString("tr-TR") : "Bilinmiyor";
  setText(
    container.querySelector(".drawer-times"),
    `Bu izleme döneminde ilk: ${localDate(entity.firstSeenAt)} · Son: ${localDate(entity.lastSeenAt)}`,
  );
  const source =
    entity.sources.find((s) => s.id === selectedSourceId) || entity.sources[0];
  const existing = new Map(
    [...$("device-sources").children].map((el) => [el.dataset.sourceId, el]),
  );
  for (const item of entity.sources) {
    let button = existing.get(item.id);
    if (!button) {
      button = element("button", "device-source");
      button.type = "button";
      button.dataset.sourceId = item.id;
      button.append(
        element("strong"),
        element("span", "source-measurement"),
        element("small"),
        element("span", "source-error"),
      );
      $("device-sources").append(button);
    }
    existing.delete(item.id);
    setText(
      button.querySelector("strong"),
      `${item.nodeId} · ${floorsText([item.floor])}${item.scanner === "dummy" ? " · Demo" : ""}`,
    );
    setText(
      button.querySelector(".source-measurement"),
      signalText(item.signal),
    );
    setText(
      button.querySelector("small"),
      `${stateLabels[item.state]} · ${item.lastSeenAt ? ageText(item.lastSeenAt) : "Zaman bilinmiyor"}`,
    );
    setText(button.querySelector(".source-error"), item.error || "");
    button.querySelector(".source-error").hidden = !item.error;
    button.setAttribute("aria-pressed", source.id === item.id);
  }
  for (const el of existing.values()) el.remove();
  $("device-open-analysis").disabled = false;
  setText($("device-raw"), JSON.stringify(source.record, null, 2));
  renderHistory(
    { ...source, name: entity.name },
    history,
    connected,
    "device-history",
  );
  return source;
}
