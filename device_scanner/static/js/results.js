import { $, element, icon, setText } from "./ui.js";
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
    wifi ? "Nearby access points" : "Nearby Bluetooth devices",
  );
  $("result-count").textContent = rows.length;
  $("name-column").textContent = wifi ? "NETWORK / BSSID" : "DEVICE / ADDRESS";
  $("channel-column").textContent = wifi ? "CHANNEL" : "ADDRESS TYPE";
  $("security-column").textContent = wifi ? "SECURITY" : "PAIRED";
  $("scope-caption").textContent =
    `${view.nodeId === "all" ? "All scanners" : view.nodeId} · one observation per Pi`;
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
    setText(
      tr.querySelector(".signal-reading"),
      signalText(row.signal, row.radio),
    );
    const percent = signalPercent(row.signal, row.radio);
    tr.querySelector(".signal-fill").style.width = `${percent}%`;
    tr.querySelector(".signal-fill").classList.toggle("weak", percent < 40);
    const props = row.record.properties;
    setText(
      tr.querySelector(".channel-value"),
      wifi ? (row.channel ?? "—") : props.AddressType || "Unknown",
    );
    setText(
      tr.children[2].querySelector(".cell-secondary"),
      wifi && row.band !== "unknown" ? `${row.band} GHz` : "",
    );
    setText(
      tr.querySelector(".security-badge"),
      wifi
        ? row.security
        : props.Paired === true
          ? "Yes"
          : props.Paired === false
            ? "No"
            : "Unknown",
    );
    setText(tr.querySelector(".row-node"), row.nodeId);
    setText(
      tr.children[4].querySelector(".cell-secondary"),
      !context.connected
        ? "Outdated view"
        : row.state === "latest"
          ? row.scanner === "dummy"
            ? "Dummy"
            : "Real Pi"
          : `Previous · ${row.state}`,
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
    ? "No matching observations"
    : !context.nodes.length
      ? "Listening for your scanners"
      : problem?.status === "error"
        ? "This radio needs attention"
        : problem?.status === "success"
          ? "Nothing found in the last scan"
          : "Waiting for scan results";
  $("empty-description").textContent = filtered
    ? "Try another name or address, or clear the filters."
    : problem?.status === "error"
      ? problem.error
      : problem?.status === "success"
        ? "The scan completed successfully with zero observations. New reports appear automatically."
        : "Results appear here when a Pi sends a scan. Scanners run independently.";
  const previous = rows.filter((row) => row.state !== "latest").length;
  $("results-summary").textContent =
    `${rows.length} of ${context.total} observations${previous ? ` · ${previous} previous` : ""}${!context.connected ? " · outdated" : ""}`;
}
