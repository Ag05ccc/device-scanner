import { $, element, svgElement } from "./ui.js";
import { channelCounts, isNumber, signalText } from "./observations.js";

function chart(label, width = 520) {
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} 170`,
    role: "img",
    "aria-label": label,
  });
  svg.append(svgElement("title", {}, label));
  return svg;
}

function placeholder(container, message) {
  container.replaceChildren(element("div", "chart-placeholder", message));
}

export function renderHistory(row, history, connected) {
  $("history-key").textContent = row ? row.nodeId : "Selected observation";
  $("history-subtitle").textContent = row
    ? `${row.name} · ${row.radio === "wifi" ? "signal quality (%)" : "RSSI (dBm)"}${!connected ? " · outdated" : ""}`
    : "Select an observation to follow its signal";
  const container = $("history-chart");
  const samples = row ? history.get(row.id)?.samples || [] : [];
  const known = samples.filter((sample) => isNumber(sample.value));
  if (!known.length) {
    placeholder(
      container,
      row
        ? "No signal measurement reported yet."
        : "Select a result to see its signal history.",
    );
    return;
  }
  const min =
    row.radio === "wifi"
      ? 0
      : Math.min(-100, ...known.map((item) => item.value));
  const max =
    row.radio === "wifi"
      ? 100
      : Math.max(-20, ...known.map((item) => item.value));
  const first = samples[0].time;
  const span = Math.max(1000, samples.at(-1).time - first);
  const x = (sample) => 43 + ((sample.time - first) / span) * 457;
  const y = (sample) =>
    132 - Math.max(0, Math.min(1, (sample.value - min) / (max - min))) * 116;
  const description = `${row.name}, ${known.length} received signal measurements. Latest: ${signalText(known.at(-1).value, row.radio)}.`;
  const svg = chart(description);
  for (let index = 0; index <= 4; index++) {
    const height = 16 + index * 29;
    svg.append(
      svgElement("line", {
        x1: 43,
        x2: 500,
        y1: height,
        y2: height,
        class: "chart-grid",
      }),
    );
    svg.append(
      svgElement(
        "text",
        { x: 33, y: height + 3, "text-anchor": "end", class: "chart-label" },
        Math.round(max - (index / 4) * (max - min)),
      ),
    );
  }
  // Null measurements break the line when a Pi/radio stops providing results.
  let segment = [];
  const drawSegment = () => {
    if (!segment.length) return;
    const points = segment
      .map((sample) => `${x(sample)},${y(sample)}`)
      .join(" ");
    if (segment.length > 1) {
      svg.append(
        svgElement("polygon", {
          points: `${x(segment[0])},132 ${points} ${x(segment.at(-1))},132`,
          class: "chart-area",
        }),
      );
      svg.append(svgElement("polyline", { points, class: "chart-line" }));
    }
    for (const sample of segment) {
      const point = svgElement("circle", {
        cx: x(sample),
        cy: y(sample),
        r: segment.length === 1 ? 4 : 2.5,
        class: "chart-point",
      });
      point.append(
        svgElement(
          "title",
          {},
          `${new Date(sample.time).toLocaleTimeString()} · ${signalText(sample.value, row.radio)}`,
        ),
      );
      svg.append(point);
    }
    segment = [];
  };
  for (const sample of samples) {
    if (isNumber(sample.value)) segment.push(sample);
    else drawSegment();
  }
  drawSegment();
  svg.append(
    svgElement(
      "text",
      { x: 43, y: 155, class: "chart-label" },
      new Date(first).toLocaleTimeString(),
    ),
  );
  svg.append(
    svgElement(
      "text",
      { x: 500, y: 155, "text-anchor": "end", class: "chart-label" },
      known.length === 1
        ? "First sample"
        : new Date(samples.at(-1).time).toLocaleTimeString(),
    ),
  );
  container.replaceChildren(svg);
}

export function renderDistribution(rows, radio, connected) {
  const wifi = radio === "wifi";
  $("distribution-title").textContent = wifi
    ? "Channel usage"
    : "Signal distribution";
  $("distribution-subtitle").textContent =
    `${wifi ? "Access points by band and channel" : "Bluetooth observations by RSSI"}${!connected ? " · outdated" : ""}`;
  $("distribution-label").textContent = wifi ? "WI-FI" : "BLUETOOTH";
  const latest = rows.filter((row) => row.state === "latest");
  const missing = latest.filter((row) =>
    wifi ? row.channel === null : row.signal === null,
  ).length;
  $("distribution-note").textContent =
    (wifi
      ? "Unique BSSIDs in filtered results · count, not airtime"
      : "Filtered observations per Pi · RSSI does not measure distance") +
    (missing ? ` · ${missing} unknown ${wifi ? "channel" : "signal"}` : "");
  const bars = wifi
    ? channelCounts(latest).map((entry) => ({
        label: `Ch ${entry.channel}`,
        sublabel:
          entry.band === "unknown" ? "Unknown band" : `${entry.band} GHz`,
        count: entry.count,
      }))
    : [
        {
          label: "Strong",
          sublabel: "≥ −50 dBm",
          count: latest.filter(
            (row) => row.signal !== null && row.signal >= -50,
          ).length,
        },
        {
          label: "Good",
          sublabel: "−70 to −51",
          count: latest.filter(
            (row) =>
              row.signal !== null && row.signal >= -70 && row.signal < -50,
          ).length,
        },
        {
          label: "Fair",
          sublabel: "−85 to −71",
          count: latest.filter(
            (row) =>
              row.signal !== null && row.signal >= -85 && row.signal < -70,
          ).length,
        },
        {
          label: "Weak",
          sublabel: "< −85 dBm",
          count: latest.filter((row) => row.signal !== null && row.signal < -85)
            .length,
        },
      ];
  const container = $("distribution-chart");
  if (!bars.some((bar) => bar.count)) {
    placeholder(
      container,
      wifi
        ? "No channel data in the latest matching results."
        : "No signal data in the latest matching results.",
    );
    return;
  }
  const width = Math.max(480, bars.length * 65 + 45);
  const svg = chart(
    bars
      .map((bar) => `${bar.label} (${bar.sublabel}): ${bar.count}`)
      .join("; "),
    width,
  );
  if (width > 600) svg.style.minWidth = `${width}px`;
  const maximum = Math.max(...bars.map((bar) => bar.count), 1);
  const step = (width - 54) / bars.length;
  for (let tick = 0; tick <= Math.min(4, maximum); tick++) {
    const value = Math.ceil((maximum / Math.min(4, maximum)) * tick);
    const height = 125 - (value / maximum) * 100;
    svg.append(
      svgElement("line", {
        x1: 30,
        x2: width - 15,
        y1: height,
        y2: height,
        class: "chart-grid",
      }),
    );
    svg.append(
      svgElement(
        "text",
        { x: 20, y: height + 3, "text-anchor": "end", class: "chart-label" },
        value,
      ),
    );
  }
  bars.forEach((bar, index) => {
    const center = 35 + step * (index + 0.5);
    const height = (bar.count / maximum) * 100;
    const rect = svgElement("rect", {
      x: center - Math.min(20, step / 3),
      y: 125 - height,
      width: Math.min(40, step / 1.5),
      height,
      rx: 3,
      class: "chart-bar",
    });
    rect.append(
      svgElement("title", {}, `${bar.label} · ${bar.sublabel}: ${bar.count}`),
    );
    svg.append(
      rect,
      svgElement(
        "text",
        {
          x: center,
          y: 118 - height,
          "text-anchor": "middle",
          class: "chart-label",
        },
        bar.count,
      ),
    );
    svg.append(
      svgElement(
        "text",
        { x: center, y: 143, "text-anchor": "middle", class: "chart-label" },
        bar.label,
      ),
    );
    svg.append(
      svgElement(
        "text",
        { x: center, y: 160, "text-anchor": "middle", class: "chart-label" },
        bar.sublabel,
      ),
    );
  });
  container.replaceChildren(svg);
}
