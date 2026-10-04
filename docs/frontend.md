# Frontend guide

Run `python3 -m device_scanner dev --nodes 3` and open <http://127.0.0.1:8001>.
The same dashboard handles dummy and real scanner reports. The browser requires
JavaScript; the server and dummy nodes need only Python 3.11+.

## Design references

- `bakici-app/static/building.html`: Pi selection, separate radio views, a results
  table, and an observation inspector.
- [Acrylic Wi-Fi Analyzer](https://www.acrylicwifi.com/en/wifi-analyzer/): a compact
  network inventory, signal indicators, channel analysis, and light/dark themes.

This implementation uses original HTML/CSS and native SVG charts. It has no
frontend packages, build step, external fonts, analytics, or CDN requests.

## Where the code lives

| File under `device_scanner/static/` | Responsibility |
| --- | --- |
| `index.html` | Page structure, controls, accessible labels, inline icon symbols |
| `styles.css` | Theme variables, component styles, responsive layouts |
| `js/app.js` | Selected Pi/radio/row, user events, coordinating the views |
| `js/api.js` | Fetching `/api/nodes`, request timeout, refresh scheduling |
| `js/observations.js` | Normalize reports, search, sort, count channels, collect history |
| `js/nodes.js` | Pi navigation and status |
| `js/results.js` | Results table and empty states |
| `js/details.js` | Selected observation and original reported properties |
| `js/charts.js` | Signal history and channel/RSSI distribution SVGs |
| `js/export.js` | Filtered JSON/CSV documents and browser downloads |
| `js/ui.js` | Small DOM, text, time, and icon helpers |

Data flows from `api.js` to the state in `app.js`, through the pure transformations
in `observations.js`, then into the views. Only `api.js` makes API requests.
`server.py` serves an explicit allowlist of frontend assets with their correct
content types. Assets are loaded when the server starts; restart it after editing
HTML, CSS, or JavaScript, then refresh the browser.

## Using the interface

Select a Pi in the sidebar or choose **All scanners**. The Wi-Fi/Bluetooth buttons
change the radio; Wi-Fi also has a band filter. Search matches a reported name,
address, or Pi ID without case sensitivity. It trims surrounding whitespace.

Each row is one observation from one Pi. Several Pis hearing the same access point
produce several rows, preserving their individual signal readings. Counts in the
summary refer to the selected Pi/radio before search and band filtering. The table
footer gives the filtered count. Online Pi count always covers the whole workspace.
Scan errors count both radios within the selected Pi scope.

Select a row to inspect it. **All reported properties** includes its original
object path and properties. `/` focuses search; arrow keys move between focused
result buttons. All controls are keyboard accessible. Narrow layouts stack the
panels; the Pi list and results table can scroll horizontally.

Refresh fetches reports immediately; it does not command a hardware scan. Nodes
continue scanning independently. Polling runs two seconds after each completed
request, or ten seconds when the tab is hidden. Requests time out after four
seconds, and only one request runs at a time.

Existing result rows retain their order during polling. New rows join the end.
Changing scope, filters, or sort recomputes the order. The circular-arrow button
beside the sort menu explicitly sorts again. Selection, keyboard focus, table
scroll, and expanded properties survive refreshes; unchanged text is kept in place
so it can be selected/copied.

The theme button switches between light and dark. On the first visit, the system
preference is used; a chosen theme is remembered in that browser when storage is
available.

## What the graphs and statuses mean

- **Wi-Fi signal:** the scanner's `Strength` percentage. It is not converted to dBm.
- **Bluetooth signal:** the reported RSSI in dBm. It does not estimate distance.
- **Signal history:** up to 60 samples per observation, collected only when a new
  radio report arrives during this browser session. Repeated polling of the same
  report does not invent samples. Missing/error/offline observations break the
  line. Reloading resets history; inactive entries expire after ten minutes and
  the cache is capped at 2,000 observations.
- **Channel usage:** distinct BSSIDs per band/channel in the filtered latest
  successful results. Multiple Pis hearing the same BSSID do not inflate a bar.
  Unknown channels are omitted and counted in the caption. This is an AP count,
  not channel utilization, interference, bandwidth, or a channel recommendation.
- **Bluetooth distribution:** counts each Pi's observation in the indicated RSSI
  range. Missing signal values are omitted and counted in the caption.
- **Previous results:** observations retained after a scan error or a Pi going
  offline. These remain inspectable/exportable and are excluded from latest-result
  summary counts and distribution charts.
- **Server disconnected:** the last snapshot remains visible, explicitly marked
  outdated; current summary values become unavailable. Reconnection is automatic.
- **Empty scan:** a successful zero-observation report clears previous results.

The existing API does not expose per-radio expiry or which radios are disabled.
“Latest” therefore means the last successful report on an online Pi, not a promise
that the radio is still scanning. The inspector's **Last radio report** dates the
report, which can be an error; it does not date retained successful observations.
The sidebar shows Pis that have reported since this server started. No configured
inventory, floor map, IP assignment, or remote start/stop command is added.

## Export

JSON and CSV contain the displayed rows in their displayed order, their original
properties, reporting Pi, radio state, and filters. JSON also carries the snapshot
time and an `outdated` flag; CSV repeats the flag and filters per row. Exporting an
empty filter produces an empty JSON observation array or a header-only CSV.
Device-supplied formula-like strings in CSV cells are escaped for spreadsheets.
Exported timestamps refer to the last radio report, including when retained data
is shown after an error.

## Verification

```bash
python3 -m unittest discover -s tests -v
node --test tests/frontend/*.test.js
node tools/check_browser.mjs
```

Node.js 20+ is only needed for the optional frontend checks. The browser check uses
installed Chrome (`CHROME_BIN` can override its path) via its debugging pipe, without
npm dependencies. It launches an isolated temporary server, sends synthetic reports,
checks real interactions/downloads/failure recovery, and cleans up its processes.
Screenshots go to `/tmp/device-scanner-desktop.png`, `/tmp/device-scanner-dark.png`,
and `/tmp/device-scanner-mobile.png`.
