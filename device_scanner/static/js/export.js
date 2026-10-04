// Exports describe exactly the visible rows, including retained/offline results.
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
      path: row.record.path,
      properties: row.record.properties,
    })),
  };
}

function csvCell(value) {
  let text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Spreadsheet applications may execute device-supplied text as formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(document) {
  const columns = [
    "node_id",
    "scanner",
    "radio",
    "state",
    "outdated",
    "received_at",
    "report_observed_at",
    "error",
    "path",
    "properties",
    "filters",
  ];
  return (
    [
      columns,
      ...document.observations.map((row) =>
        columns.map((column) =>
          column === "outdated"
            ? document.outdated
            : column === "filters"
              ? document.filters
              : row[column],
        ),
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
