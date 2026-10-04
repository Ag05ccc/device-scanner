import {
  $,
  element,
  icon,
  ageText,
  valueText,
  setText,
  observationStateText,
} from "./ui.js";
import { signalText } from "./observations.js";

export function renderDetails(row, connected) {
  $("details-empty").hidden = Boolean(row);
  $("details-content").hidden = !row;
  if (!row) {
    $("details-content").replaceChildren();
    return;
  }
  const container = $("details-content");
  if (container.dataset.key !== row.id || !container.children.length) {
    container.dataset.key = row.id;
    const identity = element("div", "detail-identity");
    const symbol = element("span", "detail-icon");
    symbol.append(icon(row.radio));
    identity.append(
      symbol,
      element("h3"),
      element("p", "detail-address"),
      element("span", "state-badge"),
    );
    const raw = element("details", "raw-details");
    raw.append(element("summary", "", "Ham WiGLE kaydı"), element("pre"));
    container.replaceChildren(
      identity,
      element("dl", "detail-fields"),
      element("p", "detail-error"),
      raw,
    );
  }
  const previous = row.state !== "latest" || !connected;
  const state = !connected
    ? "Önceki gözlem · sunucuya ulaşılamıyor"
    : row.state === "latest"
      ? "Güncel tarama sonucu"
      : `Önceki gözlem · ${observationStateText(row.state)}`;
  setText(container.querySelector("h3"), row.name);
  setText(container.querySelector(".detail-address"), row.address);
  setText(container.querySelector(".state-badge"), state);
  container
    .querySelector(".state-badge")
    .classList.toggle("previous", previous);
  const fields = container.querySelector(".detail-fields");
  const props = row.record;
  const entries = [
    ["Sensör", row.nodeId],
    ["Kaynak", row.scanner === "dummy" ? "Demo verisi" : "Gerçek donanım"],
    ["Sinyal", signalText(row.signal)],
  ];
  const optional = (label, value) => {
    if (value !== "" && value !== null && value !== undefined)
      entries.push([label, valueText(value)]);
  };
  if (row.radio === "wifi") {
    optional("Kanal", row.channel);
    optional("Bant", row.band === "unknown" ? null : `${row.band} GHz`);
    optional("Frekans (MHz)", props.Frequency);
    entries.push(["Güvenlik", row.security]);
    optional("Dolaşım konsorsiyumu kimlikleri", props.RCOIs);
  } else {
    entries.push(
      ["Tür", props.Type],
      ["Özellikler", props.AuthMode || "Bilinmiyor"],
    );
    optional("Cihaz sınıfı kodu", props.Frequency);
    optional("Üretici kimliği", props.MfgrId);
  }
  entries.push(["İlk görülme (UTC)", valueText(props.FirstSeen)]);
  optional(
    row.scanner === "dummy" ? "Örnek enlem" : "Enlem",
    props.CurrentLatitude,
  );
  optional(
    row.scanner === "dummy" ? "Örnek boylam" : "Boylam",
    props.CurrentLongitude,
  );
  optional("Yükseklik (m)", props.AltitudeMeters);
  optional("Konum doğruluğu (m)", props.AccuracyMeters);
  // An error report's timestamp does not date its retained successful observations.
  entries.push(["Son başarılı tarama", ageText(row.receivedAt)]);
  if (row.lastReportAt && row.lastReportAt !== row.receivedAt)
    entries.push(["Son radyo raporu", ageText(row.lastReportAt)]);
  entries.forEach(([label, value], index) => {
    let pair = fields.children[index];
    if (!pair) {
      pair = element("div");
      pair.append(element("dt", "", label), element("dd"));
      fields.append(pair);
    }
    setText(pair.querySelector("dt"), label);
    setText(pair.querySelector("dd"), value);
  });
  while (fields.children.length > entries.length)
    fields.lastElementChild.remove();
  container.querySelector(".detail-error").hidden = !row.error;
  setText(container.querySelector(".detail-error"), row.error || "");
  setText(container.querySelector("pre"), JSON.stringify(row.record, null, 2));
}
