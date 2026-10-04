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

export function renderHistory(row, history, connected, prefix = "history") {
  $(prefix + "-key").textContent = row ? row.nodeId : "Seçili gözlem";
  $(prefix + "-subtitle").textContent = row
    ? `${row.name} · RSSI (dBm)${!connected ? " · güncel değil" : ""}`
    : "Sinyalini izlemek için bir gözlem seçin";
  const container = $(prefix + "-chart");
  const samples = row ? history.get(row.id)?.samples || [] : [];
  const known = samples.filter((sample) => isNumber(sample.value));
  if (!known.length) {
    placeholder(
      container,
      row
        ? "Henüz sinyal ölçümü bildirilmedi."
        : "Sinyal geçmişini görmek için bir gözlem seçin.",
    );
    return;
  }
  const min = Math.min(-100, ...known.map((item) => item.value));
  const max = Math.max(-20, ...known.map((item) => item.value));
  const first = samples[0].time;
  const span = Math.max(1000, samples.at(-1).time - first);
  const x = (sample) => 43 + ((sample.time - first) / span) * 457;
  const y = (sample) =>
    132 - Math.max(0, Math.min(1, (sample.value - min) / (max - min))) * 116;
  const description = `${row.name}, ${known.length} sinyal ölçümü. Son ölçüm: ${signalText(known.at(-1).value)}.`;
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
          `${new Date(sample.time).toLocaleTimeString("tr-TR")} · ${signalText(sample.value)}`,
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
      new Date(first).toLocaleTimeString("tr-TR"),
    ),
  );
  svg.append(
    svgElement(
      "text",
      { x: 500, y: 155, "text-anchor": "end", class: "chart-label" },
      known.length === 1
        ? "İlk ölçüm"
        : new Date(samples.at(-1).time).toLocaleTimeString("tr-TR"),
    ),
  );
  container.replaceChildren(svg);
}

export function renderDistribution(rows, radio, connected) {
  const wifi = radio === "wifi";
  $("distribution-title").textContent = wifi
    ? "Kanallara göre erişim noktaları"
    : "Sinyal dağılımı";
  $("distribution-subtitle").textContent =
    `${wifi ? "Bant ve kanala göre gözlenen erişim noktası sayısı" : "RSSI değerine göre Bluetooth gözlemleri"}${!connected ? " · güncel değil" : ""}`;
  $("distribution-label").textContent = wifi ? "WI-FI" : "BLUETOOTH";
  const latest = rows.filter((row) => row.state === "latest");
  const missing = latest.filter((row) =>
    wifi ? row.channel === null : row.signal === null,
  ).length;
  $("distribution-note").textContent =
    (wifi
      ? "Her BSSID bir kez sayılır · çubuklar kanal doluluğunu ölçmez"
      : "Her Pi’nin gözlemleri ayrı sayılır · RSSI mesafeyi ölçmez") +
    (missing
      ? ` · ${missing} kaydın ${wifi ? "kanalı" : "sinyali"} bilinmiyor`
      : "");
  const bars = wifi
    ? channelCounts(latest).map((entry) => ({
        label: `Kanal ${entry.channel}`,
        sublabel:
          entry.band === "unknown" ? "Bant bilinmiyor" : `${entry.band} GHz`,
        count: entry.count,
      }))
    : [
        {
          label: "Güçlü",
          sublabel: "≥ −50 dBm",
          count: latest.filter(
            (row) => row.signal !== null && row.signal >= -50,
          ).length,
        },
        {
          label: "İyi",
          sublabel: "−70 … −51",
          count: latest.filter(
            (row) =>
              row.signal !== null && row.signal >= -70 && row.signal < -50,
          ).length,
        },
        {
          label: "Orta",
          sublabel: "−85 … −71",
          count: latest.filter(
            (row) =>
              row.signal !== null && row.signal >= -85 && row.signal < -70,
          ).length,
        },
        {
          label: "Zayıf",
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
        ? "Güncel sonuçlarda kanal ölçümü yok."
        : "Güncel sonuçlarda sinyal ölçümü yok.",
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
