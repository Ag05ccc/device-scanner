// Report receipt cadence, kept separate from device counts and radio frequency.
const hzFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const secondsFormat = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 1,
});
const positive = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const basis =
  "Sunucunun aldığı başarılı tarama raporlarının sıklığı, en fazla son 10 rapor aralığından hesaplanır. Cihaz sayısı, ekran yenileme hızı veya radyo frekansı (GHz) değildir.";
const formatHz = (hz) => (hz < 0.01 ? "<0,01 Hz" : `${hzFormat.format(hz)} Hz`);
const formatSeconds = (seconds) =>
  seconds < 0.1 ? "<0,1" : secondsFormat.format(seconds);

export function scanRate(scan, online, connected) {
  const samples =
    Number.isInteger(scan?.scan_rate_samples) &&
    scan.scan_rate_samples >= 0 &&
    scan.scan_rate_samples <= 10
      ? scan.scan_rate_samples
      : 0;
  const window = scan?.scan_rate_window_seconds;
  let detail;
  if (!connected) detail = "Bağlantı yok";
  else if (scan?.enabled === false || scan?.freshness === "disabled")
    detail = "Kapalı";
  else if (!online) detail = "Çevrimdışı";
  else if (scan?.status === "error" || scan?.freshness === "error")
    detail = "Tarama hatası";
  else if (scan?.freshness !== "fresh" || scan?.status !== "success")
    detail = "Tarama bekleniyor";
  else if (!positive(scan.scan_rate_hz) || samples === 0 || !positive(window))
    detail = samples > 0 ? "Tarama bekleniyor" : "Ölçülüyor";

  const hz = detail ? null : scan.scan_rate_hz;
  if (hz !== null) detail = `${formatSeconds(1 / hz)} sn/tarama`;
  const measurement = `${samples} rapor aralığı${positive(window) ? ` · ${formatSeconds(window)} sn ölçüm penceresi` : ""}.`;
  return {
    hz,
    text: hz === null ? "—" : formatHz(hz),
    detail,
    title: `${detail}. ${measurement} ${basis}`,
  };
}

export function aggregateScanRate(nodes, radio, connected) {
  const expected = nodes.filter(
    (node) => node.radios?.[radio]?.enabled !== false,
  );
  const readings = expected.map((node) =>
    scanRate(node.radios?.[radio], node.online, connected),
  );
  const availableReadings = readings.filter((rate) => rate.hz !== null);
  const available = availableReadings.length;
  const total = expected.length;
  const hz = available
    ? availableReadings.reduce((mean, rate) => mean + rate.hz / available, 0)
    : null;
  let detail;
  if (!connected) detail = "Bağlantı yok";
  else if (!total) detail = nodes.length ? "Kapalı" : "Tarama bekleniyor";
  else if (!available)
    detail = `${available}/${total} Pi · ${readings.every((rate) => rate.detail === readings[0].detail) ? readings[0].detail : "Tarama bekleniyor"}`;
  else
    detail = `${available}/${total} Pi${available < total ? " · kısmi ölçüm" : ` · ${formatSeconds(1 / hz)} sn/tarama`}`;
  const radioLabel = radio === "wifi" ? "Wi-Fi" : "Bluetooth";
  const sampleCount = expected.reduce(
    (sum, node, index) =>
      sum +
      (readings[index].hz === null ? 0 : node.radios[radio].scan_rate_samples),
    0,
  );
  return {
    hz,
    text: hz === null ? "—" : formatHz(hz),
    detail,
    title: `${radioLabel}: ${detail}. ${available}/${total} Pi için ölçüm var. Geçerli Pi hızlarının aritmetik ortalaması; Pi hızları toplanmaz. ${sampleCount} rapor aralığı kullanıldı; Pi başına en fazla 10 aralık. ${basis}`,
    available,
    total,
  };
}
