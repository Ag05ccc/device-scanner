import { $, element, icon, ageText, valueText, setText } from "./ui.js";
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
    raw.append(
      element("summary", "", "All reported properties"),
      element("pre"),
    );
    container.replaceChildren(
      identity,
      element("dl", "detail-fields"),
      element("p", "detail-error"),
      raw,
    );
  }
  const previous = row.state !== "latest" || !connected;
  const state = !connected
    ? "Outdated · server disconnected"
    : row.state === "latest"
      ? "Latest scan result"
      : `Previous result · ${row.state}`;
  setText(container.querySelector("h3"), row.name);
  setText(container.querySelector(".detail-address"), row.address);
  setText(container.querySelector(".state-badge"), state);
  container
    .querySelector(".state-badge")
    .classList.toggle("previous", previous);
  const fields = container.querySelector(".detail-fields");
  const props = row.record.properties;
  const entries = [
    ["Scanner", row.nodeId],
    ["Source", row.scanner === "dummy" ? "Dummy data" : "Real hardware"],
    ["Signal", signalText(row.signal, row.radio)],
  ];
  if (row.radio === "wifi") {
    entries.push(
      ["Channel", row.channel ?? "Unknown"],
      ["Band", row.band === "unknown" ? "Unknown" : `${row.band} GHz`],
      ["Security", row.security],
    );
  } else {
    entries.push(
      ["Address type", valueText(props.AddressType)],
      ["Paired", valueText(props.Paired)],
      ["Connected", valueText(props.Connected)],
    );
  }
  // An error report's timestamp does not date its retained successful observations.
  entries.push(["Last radio report", ageText(row.receivedAt)]);
  entries.forEach(([label, value], index) => {
    let pair = fields.children[index];
    if (!pair) {
      pair = element("div");
      pair.append(element("dt", "", label), element("dd"));
      fields.append(pair);
    }
    setText(pair.querySelector("dd"), value);
  });
  container.querySelector(".detail-error").hidden = !row.error;
  setText(container.querySelector(".detail-error"), row.error || "");
  setText(container.querySelector("pre"), JSON.stringify(row.record, null, 2));
}
