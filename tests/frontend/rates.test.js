import test from "node:test";
import assert from "node:assert/strict";
import {
  scanRate,
  aggregateScanRate,
} from "../../device_scanner/static/js/rates.js";

function scan(hz, changes = {}) {
  return {
    enabled: true,
    freshness: "fresh",
    status: "success",
    scan_rate_hz: hz,
    scan_rate_samples: hz === null ? 0 : 4,
    scan_rate_window_seconds: hz === null ? null : 4 / hz,
    ...changes,
  };
}

function node(wifi = scan(0.25), bluetooth = scan(0.5), changes = {}) {
  return { online: true, radios: { wifi, bluetooth }, ...changes };
}

test("scan rate formats measured Hz and seconds with Turkish decimal notation", () => {
  const result = scanRate(scan(0.25), true, true);
  assert.equal(result.hz, 0.25);
  assert.equal(result.text, "0,25 Hz");
  assert.equal(result.detail, "4 sn/tarama");
  assert.match(result.title, /4 rapor aralığı/);
  assert.match(result.title, /16 sn ölçüm penceresi/);
  assert.match(result.title, /Sunucunun aldığı başarılı tarama raporlarının/);
  assert.match(result.title, /en fazla son 10/);
  assert.match(result.title, /GHz/);
  assert.equal(scanRate(scan(0.15), true, true).detail, "6,7 sn/tarama");
  assert.equal(scanRate(scan(0.12345), true, true).text, "0,12 Hz");
  assert.equal(scanRate(scan(0.01), true, true).text, "0,01 Hz");
  assert.equal(scanRate(scan(0.009), true, true).text, "<0,01 Hz");
  assert.equal(scanRate(scan(20), true, true).detail, "<0,1 sn/tarama");
});

test("warmup and overdue successful radios stay unknown instead of inventing zero", () => {
  const warming = scanRate(scan(null), true, true);
  assert.equal(warming.hz, null);
  assert.equal(warming.text, "—");
  assert.equal(warming.detail, "Ölçülüyor");
  assert.match(warming.title, /0 rapor aralığı/);
  const overdue = scanRate(
    scan(null, { scan_rate_samples: 3, scan_rate_window_seconds: 12 }),
    true,
    true,
  );
  assert.equal(overdue.hz, null);
  assert.equal(overdue.detail, "Tarama bekleniyor");
  assert.equal(scanRate(undefined, true, true).detail, "Tarama bekleniyor");
});

test("stale rate fields cannot make unavailable radios appear current", () => {
  const cases = [
    [scan(0.5, { enabled: false }), true, true, "Kapalı"],
    [scan(0.5, { freshness: "disabled" }), true, true, "Kapalı"],
    [scan(0.5), false, true, "Çevrimdışı"],
    [scan(0.5), true, false, "Bağlantı yok"],
    [scan(0.5, { status: "error" }), true, true, "Tarama hatası"],
    [scan(0.5, { freshness: "error" }), true, true, "Tarama hatası"],
    [scan(0.5, { freshness: "waiting" }), true, true, "Tarama bekleniyor"],
    [scan(0.5, { freshness: "stale" }), true, true, "Tarama bekleniyor"],
    [scan(0.5, { freshness: "overdue" }), true, true, "Tarama bekleniyor"],
  ];
  for (const [reading, online, connected, expected] of cases) {
    const result = scanRate(reading, online, connected);
    assert.equal(result.hz, null, expected);
    assert.equal(result.text, "—", expected);
    assert.equal(result.detail, expected);
  }
  for (const hz of [0, -1, Infinity, NaN, "0.5"])
    assert.equal(scanRate(scan(hz), true, true).hz, null);
  for (const scan_rate_samples of [0, -1, 11, "3"])
    assert.equal(
      scanRate(scan(0.5, { scan_rate_samples }), true, true).hz,
      null,
    );
  for (const scan_rate_window_seconds of [null, 0, -1, Infinity, "12"])
    assert.equal(
      scanRate(scan(0.5, { scan_rate_window_seconds }), true, true).hz,
      null,
    );
});

test("adding equally fast Pis never inflates per-Pi speed or mixes radios", () => {
  const one = aggregateScanRate([node()], "wifi", true);
  const three = aggregateScanRate([node(), node(), node()], "wifi", true);
  assert.equal(one.hz, 0.25);
  assert.equal(three.hz, one.hz);
  assert.equal(three.text, "0,25 Hz");
  assert.equal(three.available, 3);
  assert.equal(three.total, 3);
  assert.equal(three.detail, "3/3 Pi · 4 sn/tarama");
  assert.equal(
    aggregateScanRate([node(), node(), node()], "bluetooth", true).hz,
    0.5,
  );
  assert.match(three.title, /Wi-Fi/);
  assert.match(three.title, /12 rapor aralığı/);
  assert.match(three.title, /aritmetik ortalaması/);
  assert.match(three.title, /Pi hızları toplanmaz/);
});

test("aggregate averages measured per-Pi rates and states partial coverage", () => {
  const nodes = [
    node(scan(0.25)),
    node(scan(0.75)),
    node(scan(null)),
    node(scan(2, { enabled: false })),
  ];
  const result = aggregateScanRate(nodes, "wifi", true);
  assert.equal(result.hz, 0.5);
  assert.equal(result.text, "0,5 Hz");
  assert.equal(result.available, 2);
  assert.equal(result.total, 3);
  assert.equal(result.detail, "2/3 Pi · kısmi ölçüm");
  assert.match(result.title, /2\/3 Pi/);
  assert.match(result.title, /kısmi ölçüm/);
  assert.match(result.title, /8 rapor aralığı/);
  nodes[1].online = false;
  assert.equal(aggregateScanRate(nodes, "wifi", true).hz, 0.25);
});

test("disconnection, disabled radios and no samples never display a zero aggregate", () => {
  const disconnected = aggregateScanRate([node()], "wifi", false);
  assert.equal(disconnected.hz, null);
  assert.equal(disconnected.text, "—");
  assert.equal(disconnected.available, 0);
  assert.equal(disconnected.total, 1);
  assert.equal(disconnected.detail, "Bağlantı yok");
  const disabled = aggregateScanRate(
    [node(scan(0.5, { enabled: false }))],
    "wifi",
    true,
  );
  assert.equal(disabled.hz, null);
  assert.equal(disabled.detail, "Kapalı");
  assert.equal(disabled.total, 0);
  const warming = aggregateScanRate(
    [node(scan(null)), node(scan(null))],
    "wifi",
    true,
  );
  assert.equal(warming.hz, null);
  assert.equal(warming.detail, "0/2 Pi · Ölçülüyor");
  const empty = aggregateScanRate([], "wifi", true);
  assert.equal(empty.hz, null);
  assert.equal(empty.text, "—");
  assert.equal(empty.available, 0);
  assert.equal(empty.total, 0);
  assert.equal(empty.detail, "Tarama bekleniyor");
});
