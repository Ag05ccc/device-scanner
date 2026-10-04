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
    raw.append(element("summary", "", "WiGLE record"), element("pre"));
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
  const props = row.record;
  const entries = [
    ["Scanner", row.nodeId],
    ["Source", row.scanner === "dummy" ? "Dummy data" : "Real hardware"],
    ["Signal", signalText(row.signal)],
  ];
  if (row.radio === "wifi") {
    entries.push(
      ["Channel", row.channel ?? "Unknown"],
      ["Band", row.band === "unknown" ? "Unknown" : `${row.band} GHz`],
      ["Frequency (MHz)", valueText(props.Frequency)],
      ["Security", row.security],
      ["Roaming consortium IDs", valueText(props.RCOIs)],
    );
  } else {
    entries.push(
      ["Type", props.Type],
      ["Capabilities", props.AuthMode || "Unknown"],
      [
        "Device type code",
        valueText(props.Frequency === "" ? null : props.Frequency),
      ],
      ["Manufacturer ID", valueText(props.MfgrId === "" ? null : props.MfgrId)],
    );
  }
  entries.push(
    ["First seen (UTC)", valueText(props.FirstSeen)],
    [
      row.scanner === "dummy" ? "Sample latitude" : "Latitude",
      valueText(props.CurrentLatitude),
    ],
    [
      row.scanner === "dummy" ? "Sample longitude" : "Longitude",
      valueText(props.CurrentLongitude),
    ],
    ["Altitude (m)", valueText(props.AltitudeMeters)],
    ["Accuracy (m)", valueText(props.AccuracyMeters)],
  );
  // An error report's timestamp does not date its retained successful observations.
  entries.push(["Last radio report", ageText(row.receivedAt)]);
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
