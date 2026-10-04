# Frontend guide

Run `.venv/bin/python -m device_scanner dev --nodes 3` from the repository and open
<http://127.0.0.1:8001>. The Turkish dashboard handles both dummy and real reports.
Python 3.11+ and browser JavaScript are required; the server and dummy nodes use
only the Python standard library. HTML/CSS, JavaScript modules and native SVG
charts require no frontend packages, build step, fonts or CDN requests.

The [merged one-shot plan](../one-shot-vision-astra.md) describes the product
choices: device observations first, compact floor context, and separate sensor
management. The original technical table and charts remain available in Analiz.

## Views and controls

| View | Purpose |
| --- | --- |
| **Genel bakış** | Building-wide Wi-Fi/Bluetooth counts, new addresses, observation health, first device rows and compact floor summaries. |
| **Cihazlar** | Full address list with name/address search, radio, floor and observation-state filters. |
| **Sensörler** | Pi connections, per-radio freshness/errors, the large three-floor building and shared floor assignments. |
| **Analiz** | Original observations by Pi/radio, Wi-Fi band filtering, signal/channel charts, full WiGLE records and JSON/CSV export. |

The main Wi-Fi, Bluetooth and **Yeni · son 10 dk** numbers always describe the
building; list filters do not change their meaning. A summary card or floor row
filters the device list. Its own count and scope describe the filtered result.
The first 50 rows are shown, with a control to reveal another 50. Existing rows
keep their order during polling; new rows join the end. Changing filters/sort or
using the explicit re-sort button recomputes the order.

Selecting a device opens a right-side dialog with its observation state, server
session first/last sightings, floors and source Pis. Each source keeps its own
signal and last-seen time. Select a source to change the signal chart and raw
WiGLE record, or open that source in Analiz. Escape/close returns keyboard focus
to the originating control. There is no automatically opened empty detail panel.

`/` focuses search in the device/analysis views. `1`, `2`, `3` filter the device
list by floor when focus is outside an input and the detail dialog is closed.
Arrow keys move through device and analysis rows. Buttons, selects and dialogs
support keyboard use. State changes are announced without reading every changing
count on each poll. The dark/light theme follows the system initially and is
remembered in browser storage when available. Narrow windows stack sections;
this is a desktop-first interface, not a separate mobile application.

Refresh requests the latest server snapshot; it does not trigger hardware scans.
Polling starts two seconds after a completed request, or ten seconds while the
tab is hidden. Poll requests time out after four seconds and never overlap.
During an outage the last snapshot remains visible with unknown freshness;
current summary values become unavailable and reconnection is automatic.

## Measured scan rate

The compact **Tarama hızı / Pi** indicator stays visible across views. It reports
Wi-Fi and Bluetooth separately in **Hz (successful scans per second)**, using the
arithmetic mean of available Pi rates. Adding Pis does not multiply their scan
speed. Partial measurements show their available/expected radio count. The Sensors
table shows each source's own Hz and reciprocal `sn/tarama` period; 0.25 Hz means
one successful scan every four seconds.

The server uses monotonic receipt times for at most eleven successful reports
(ten intervals). `scan_rate_hz = intervals / elapsed_seconds`; even an empty
successful scan counts once. Heartbeats, failed reports, device counts and browser
polls do not add samples. The API also provides `scan_rate_samples` and
`scan_rate_window_seconds`. At least two distinct receipt times are needed.

The Hz field becomes null on error, stale/disabled radio, offline Pi, or a gap
longer than `max(2 × measured mean period, 2 seconds)`. Historical sample count and
window remain available, but the UI does not present their rate as current. Radio
enablement and scanner-mode changes reset the measurement. This is the cadence
observed at the server, including delivery delays, not a configured target, radio
carrier frequency, or browser FPS. `js/rates.js` handles display and aggregation.

## Counts and floor meaning

The device key is **radio family + uppercase MAC**. Wi-Fi BSSIDs and Bluetooth
addresses are separate namespaces. BT and BLE reports of the same Bluetooth
address share a device row, while source records retain their original Type.
Matching names/SSIDs do not merge different addresses. Counts are addresses, not
people, guaranteed physical-device counts, connected Wi-Fi clients or traffic.

**Gözlenen katlar** lists the floors of sensors that heard the address. An address
can appear on several floors; floor counts overlap and must not be summed to get
the building total. RSSI does not determine a device's physical floor. Unassigned
sensors remain visible in the building total and the unassigned floor group.

Wi-Fi/Bluetooth counts include **Görüldü** and **Az önce görüldü** entries. A
radio/floor without an available observation source displays **—**, not zero.
Partial source availability is labeled as partial. A fresh empty first scan can
show zero; previously seen addresses receive the short absence tolerance below.
Intentionally disabled radios are not treated as sensor failures. Dummy data has
a visible demo label; mixed real/dummy sources have a mixed-data label.

## Freshness and retained history

Heartbeat metadata declares `enabled_radios` and `expected_cycle_seconds`; the
node reports scan window plus interval as its expected cycle. Per-radio success
age uses the server's monotonic receipt clock. A radio is fresh while its last
successful receipt is younger than `max(30 seconds, 2 × expected cycle)`.
Heartbeat age, radio freshness and browser/server connection are independent.
The server exposes `fresh`, `stale`, `error`, `waiting` and `disabled`. Old clients
without metadata have unknown enablement until a scan arrives; they are not
silently assumed to have disabled their other radio.

| Device state | Rule |
| --- | --- |
| **Görüldü** | At least one online, fresh source includes it in the last successful scan. |
| **Az önce görüldü** | A fresh source no longer includes it, but last saw it within 60 seconds; it still counts. |
| **Artık görülmüyor** | Relevant sources remain available, at least two successful scans omitted it, and `max(60 seconds, 3 × expected cycle)` has elapsed. |
| **Durum bilinmiyor** | Sources cannot currently observe it, or there is not enough evidence for absence. It does not inflate current counts. |

Errors do not advance successful timestamps or count as missing scans. A live
heartbeat cannot refresh stale radio measurements. If a formerly observing
source is unavailable, the UI does not turn that outage into a definite device
loss. A new valid sighting restores current status.

Each Pi/radio's first successful scan establishes a baseline. A genuinely new
address first discovered in a later scan is marked new for ten minutes. Other
Pis share its discovery metadata; an additional Pi's initial unknown addresses
are baseline data. Reloading or opening another browser does not reset this
server-derived state. The discovery ledger distinguishes dummy and real sources
so synthetic discovery cannot establish a real device's first-seen timestamp.

Source history expires 15 minutes after last sighting and is capped at 10,000
records across all sources. The session identity ledger has a separate combined
10,000-identity cap, including both scanner modes; evicted identities can be
rediscovered later. This is limited, in-memory history, not a permanent inventory.
Changing a Pi ID between dummy and real resets that Pi's retained measurements
and source baselines. Other Pis and floor assignments remain intact.

`session_started_at` identifies a server restart. Server history/baselines reset
on restart; the browser clears its signal cache and old row ordering. Browser
signal samples for a Pi are also cleared when that Pi's scanner mode changes.
The server still retains node registrations and each radio's latest successful
scan for technical inspection. Those structures have no global node-count cap;
the history limits do not bound all server memory. See [dev notes](../dev-notes.md).

## Shared placement

The large building is in **Sensörler**. `pi-01`/`pi-1`, `pi-02`/`pi-2`, and
`pi-03`/`pi-3` default to floors 1, 2 and 3; other IDs start unassigned. Any number
of Pis can share a floor. Select a Pi and use **Bulunduğu kat**; an explicit
unassigned selection overrides its default floor.

`POST /api/placements` accepts `{ "node_id": "pi-01", "floor": 2 }`, with floor
1/2/3 or `null`. The server writes assignments atomically and exposes them in
`GET /api/placements` and every node's `floor` field in `/api/nodes`. A write
failure leaves the old assignment intact. All browsers share the server state;
local storage is used for the theme, not floor assignments.

The default file is `.device-scanner/placements.json`. Both `server` and `dev`
accept `--placements-file PATH`; the file survives restarts. In-process tests use
`make_server(placement_path=None)` for isolated in-memory assignments. Placement
is application metadata outside the WiGLE record. The building neither creates
physical Pis nor assigns IPs or starts/stops their scanners.

## Technical analysis and export

Analiz rows are **one Pi's observation**, not one merged device. Several Pis may
therefore produce multiple rows for the same BSSID, each with its original RSSI.
Search matches name, address or Pi ID; Wi-Fi also has a band filter.

- Signal is measured RSSI in dBm; missing measurements display **Bilinmiyor**.
  Visual bars do not claim distance or a measured quality percentage.
- Signal history holds up to 60 samples per source during this browser session.
  Repeated polls of one scan do not add samples; missing/error/offline/connection
  gaps break the line. Inactive cache entries expire after ten minutes, and the
  browser cache is capped at 2,000 sources. Reloading clears this chart history.
- Wi-Fi distribution counts distinct BSSIDs per band/channel in filtered fresh
  results. It is not channel utilization, interference or a channel recommendation.
  Bluetooth distribution counts filtered fresh source observations by RSSI range.
- Retained error/offline/stale results remain inspectable and exportable, with
  their state shown. They are excluded from current distribution charts. A new
  successful empty scan clears the latest source table while device history may
  still show recently seen entries.

**Dışa aktar → JSON/CSV** saves the visible Analiz rows in their displayed order.
JSON keeps each original `record` plus Pi, scanner, radio, state, errors, filters
and snapshot context. `outdated` describes browser/server disconnection; individual
row state separately covers stale/offline/error readings. CSV contains only the
WiGLE v1.6 metadata line, fourteen-column header and original observation fields.
It has no extra floor/Pi/status columns. Empty results produce an empty JSON
array or a CSV metadata/header pair. Nothing is uploaded to WiGLE.

Timestamp meanings deliberately differ by context:

| Field | Meaning |
| --- | --- |
| WiGLE `FirstSeen` | Node-process discovery timestamp, UTC; resets when the node restarts. |
| API radio `received_at`, `observed_at` | Latest report receipt and node-reported scan time, including an error report. |
| API radio `last_success_at`, `success_age_seconds` | Receipt time and monotonic age of the last successful scan; errors do not change these. |
| History `first_seen_at`, `last_seen_at` | Server-session shared discovery and source's successful last sighting. |
| JSON export row `received_at` | The retained observation's **successful** receipt time, taken from `last_success_at`. |
| JSON export row `report_observed_at` | Node scan time if latest radio status is success; `null` after an error, rather than assigning the error's time to an old measurement. |
| Export `last_received_at` | Browser time when the last API snapshot arrived. |

See [WiGLE format](wigle.md) for schema, units and hardware limits.

## Module boundaries

| File under `device_scanner/static/` | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Structure, controls, icons, themes and layouts. |
| `js/app.js` | View/filter/selection state, stable ordering, events and render coordination. |
| `js/api.js` | Snapshot polling and shared placement writes. |
| `js/entities.js` | Pure address grouping, states, fixed global counts and overlapping floor summaries. |
| `js/overview.js`, `devices.js` | Summary/floor cards, merged list and source detail dialog. |
| `js/nodes.js`, `building.js`, `placement.js` | Sensor status, building Pi cards and floor labels. |
| `js/observations.js` | Source rows, search/sort/channel counts and browser signal history. |
| `js/results.js`, `details.js`, `charts.js` | Technical source table, WiGLE inspector and SVG charts. |
| `js/export.js`, `ui.js` | File generation and shared DOM/text/time helpers. |

API snapshots flow through state in `app.js`, pure transformations, then the
renderers. Only `api.js` makes API requests. `server.py` loads an explicit asset
allowlist at startup; restart it after frontend edits, then reload the browser.
The related backend modules are `monitoring.py` for bounded history and
`placements.py` for atomic shared assignments.

## Verification

```bash
.venv/bin/python -m unittest discover -s tests -v
node --test tests/frontend/*.test.js
PYTHON=.venv/bin/python node tools/check_browser.mjs
```

Python tests need no physical radio hardware. To exercise optional real-driver
adapters rather than skip those checks, install `requirements-pi.txt` in the
virtual environment. Node.js 20+ is needed only for frontend tests. The browser
harness uses installed Chrome (`CHROME_BIN` overrides its path) and the interpreter
chosen with `PYTHON`. It launches a temporary server and placements file, sends
synthetic reports, checks interactions/downloads/failure recovery and cleans up
its processes. It checks first-screen layout at 1366×650, 1440×900 and 1920×1080.

Screenshots are `/tmp/device-scanner-oneshot-{overview,dark,drawer,sensors,analysis}.png`.
A layout failure can produce `/tmp/device-scanner-oneshot-layout-failure.png`.
These automated checks do not replace the proposed five-second test with people.
