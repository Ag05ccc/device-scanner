// Exports describe exactly the visible rows, including retained/offline results.
// WiGLE v1.6 order; kept in sync with device_scanner/wigle.py by contract tests.
export const WIGLE_COLUMNS = [
  "MAC",
  "SSID",
  "AuthMode",
  "FirstSeen",
  "Channel",
  "Frequency",
  "RSSI",
  "CurrentLatitude",
  "CurrentLongitude",
  "AltitudeMeters",
  "AccuracyMeters",
  "RCOIs",
  "MfgrId",
  "Type",
];

export function exportDocument(rows, view, connected, receivedAt) {
  return {
    exported_at: new Date().toISOString(),
    last_received_at: receivedAt,
    outdated: !connected,
    filters: {
      radio: view.radio,
      node: view.nodeId,
      query: view.query,
      band: view.radio === "wifi" ? view.band : null,
      sort: view.sort,
    },
    count: rows.length,
    observations: rows.map((row) => ({
      node_id: row.nodeId,
      scanner: row.scanner,
      radio: row.radio,
      state: row.state,
      received_at: row.receivedAt,
      report_observed_at: row.observedAt,
      error: row.error,
      record: row.record,
    })),
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  // Preserve measurements and names exactly for WiGLE; RFC4180 escaping.
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(document) {
  const scanners = [
    ...new Set(document.observations.map((row) => row.node_id)),
  ];
  const preheader = [
    "WigleWifi-1.6",
    "appRelease=development",
    "model=",
    "release=",
    `device=${scanners.length === 1 ? scanners[0] : "multiple"}`,
    "display=Device Scanner",
    "board=",
    "brand=",
    "star=Sol",
    "body=3",
    "subBody=0",
  ];
  return (
    [
      preheader,
      WIGLE_COLUMNS,
      ...document.observations.map((row) =>
        WIGLE_COLUMNS.map((column) => row.record[column]),
      ),
    ]
      .map((values) => values.map(csvCell).join(","))
      .join("\r\n") + "\r\n"
  );
}

export function downloadReport(document, format) {
  const body =
    format === "csv" ? toCsv(document) : JSON.stringify(document, null, 2);
  const blob = new Blob([body], {
    type: format === "csv" ? "text/csv;charset=utf-8" : "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `device-scanner-${document.filters.radio}-${Date.now()}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
