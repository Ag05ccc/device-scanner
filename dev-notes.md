# Dev notes

## Known bugs and logic issues (review of 2026-10-03)

These came from the original code review. At that time all 18 tests in `tests/`
passed without covering these issues. Resolved entries below describe subsequent
changes and regression coverage; the original findings are retained for context.

**Reproduced** means the issue was confirmed with a throwaway script, using either an in-memory `dbus_fast` stub or a real in-process server. Line numbers refer to the code as of this review.

| # | Issue | Severity | Where | Status |
|---|-------|----------|-------|--------|
| 1 | Wi-Fi scan can drop networks it actually found | Medium | `scanners/wifi.py` | Open |
| 2 | Radio data never expires; disabled radios look "waiting" | Medium | `server.py`, `static/js/` | Resolved 2026-10-04; bounded observation history added |
| 3 | Rejected reports leave no useful trace | Medium | `node.py`, `server.py` | Open |
| 4 | Dashboard rebuilds the whole page every 2 s | Medium (UX) | `static/js/results.js`, `static/js/details.js` | Resolved in analyzer dashboard |
| 5 | Bluetooth "connect timed out" message is unreachable | Low | `scanners/bluetooth.py` | Open |
| 6 | Local traffic is sent through `http_proxy` | Low | `node.py`, `dev.py` | Open |
| 7 | On Python 3.10 the node silently stops | Low | `node.py`, `__main__.py` | Open |
| 8 | Server memory is unbounded | Low | `server.py` | Open |
| 9 | Dev launcher can hang on Ctrl+C (rare) | Low | `dev.py` | Open |
| 10 | Minor error-handling issues | Minor | `node.py`, `scanners/wifi.py` | Open |

---

### 1. Wi-Fi scan can drop networks it actually found

*Reproduced.* Code: [wifi.py:118-122](device_scanner/scanners/wifi.py#L118-L122) (`is_fresh`) and [wifi.py:243-261](device_scanner/scanners/wifi.py#L243-L261) (the `LastScan` wait loop).

**Problem**
- The scanner treats the first `LastScan` update at or after `started` as the result of its own `RequestScan`.
- If NetworkManager was already scanning when the request was made, that update belongs to a scan that began *before* the request.
- `is_fresh()` requires `LastSeen >= started - 1`, so access points found in the first seconds of that scan are thrown away.
- The upper bound `LastSeen <= completed + 1` can only remove valid access points. Anything seen after the scan completed is even fresher.

**Effect:** the number of networks on the dashboard jumps around between scans.

**Evidence:**
- In the stub, NetworkManager's completed scan contained `/ap/early` (seen at t=97) and `/ap/late` (seen at t=100), and the request was made at t=100.
- `scan()` returned only `/ap/late`.

**Suggested fix**
- Use the completion time of the last scan that finished *before* the request as the lower bound: `last_seen >= 0 and last_seen >= previous_scan // 1000`.
- Drop the upper bound and the then-unused `completed`.

**Check on a Pi:** compare the access point counts across several cycles with `nmcli dev wifi list`. The NetworkManager timing was worked out from its design and only simulated here.

### 2. Radio data never expires; disabled radios look "waiting"

*Reproduced in the original dashboard.* Code: [server.py](device_scanner/server.py)
(`accept_report`, `snapshot`).

**Resolved (2026-10-04):** node heartbeats declare `enabled_radios` and
`expected_cycle_seconds` (`timeout + interval`). The server tracks per-radio
`last_success_at`, `success_age_seconds`, `last_error_at` and `freshness`, separately
from heartbeat age and the latest report timestamps. Freshness expires at
`max(30 seconds, 2 × expected cycle)`. Disabled radios, initial waiting, errors
and stale scans are distinct states. Older clients without metadata retain
unknown enablement until a scan arrives.

Errors no longer date retained measurements as though they were newly seen:
last-success receipt time remains available in the UI/export, and a retained
export's `report_observed_at` is `null` after an error rather than the error time.
Successful empty scans clear the latest technical observations. The device view
has a separate 60-second absence tolerance and only declares absence after at
least two successful missing scans and `max(60 seconds, 3 × expected cycle)`;
source outages remain uncertain. Errors do not count as missing scans.

Source history expires after fifteen minutes with a combined 10,000-record cap;
the shared discovery ledger also has a combined 10,000-identity cap. First scans
establish baselines, later new addresses are marked for ten minutes, and browser
reloads preserve this server-session state. Scanner mode changes clear the
affected Pi's old radio/source history; discovery metadata is separated by mode
to avoid presenting synthetic sightings as real history.

Regression cases in [test_monitoring.py](tests/test_monitoring.py) and
[test_server.py](tests/test_server.py) cover stale radios with live heartbeats,
errors retaining the successful timestamp, disabled metadata, absent/empty scans,
baseline/new flags, mode changes, expiry and history bounds. Browser/data-model
checks cover the resulting device states. See [frontend guide](docs/frontend.md)
for the current rules.

**Remaining limits:** history is not persisted across server restarts. Latest
successful source scans remain available for technical inspection, labeled stale
when appropriate. Node registrations and those latest scans are not globally
capped; issue #8 remains open. The history limits alone do not bound all memory.

**Original finding**

**Problem**
- A node's `online` flag is driven only by heartbeats, and the data for each radio has no age.
- A radio that is not enabled on the node shows "Tarama bekleniyor." forever.
- A radio that was enabled before a restart keeps its last result forever.
- An error report overwrites `observed_at` and `received_at`, so the kept "Önceki başarılı taramanın verileri" has no timestamp. When no scan ever succeeded, it shows `[]`.

**Evidence:**
- After a node was restarted with `--radios wifi`, it was still online 3 hours later, Bluetooth still showed its 3-hour-old result, and Wi-Fi showed "waiting".
- After a success at 12:00 and an error at 13:00, no field mentioned 12:00 any more.

**Suggested fix**
- The heartbeat sends the list of enabled `radios`, and the server marks the others as `disabled`.
- Store `last_success_at` for each radio.
- Add `age_seconds` for each radio, using a monotonic tick like `_last_seen_tick`.
- On the dashboard:
  - Show "Bu node'da kapalı." for a disabled radio.
  - Add "(N sn önce)" to the last report time.
  - Label the kept data with its time, and hide it when no scan has succeeded yet.

### 3. Rejected reports leave no useful trace

*Reproduced.* Code: [node.py:49-54](device_scanner/node.py#L49-L54) (`send_report`) and [server.py:143-145](device_scanner/server.py#L143-L145) (`log_message`).

**Problem**
- The node logs only the exception class.
- The server suppresses all logging.

**Evidence:**
- A report with an invalid observation produced only this node log line: `pi-01 wifi upload failed (HTTPError); next report will contain current data`.
- The server's reason, "Each observation needs a nonempty path", appeared nowhere.

**Effect (example):** a crowded Bluetooth scan larger than 1 MiB gets HTTP 413 every time, and that radio quietly stops updating.

**Suggested fix**
- In `post_report`, turn `HTTPError` into an `OSError` that carries the status and the server's `error` text, and log `str(exc)`.
- The server logs rejected POSTs (client IP, status, reason) and keeps normal traffic quiet.

### 4. Dashboard rebuilds the whole page every 2 s

Original code: `dashboard.html` (`render`, `disconnected`) in baseline commit `77bfcfb`.

**Resolved (2026-10-04):** the analyzer dashboard keeps Pi buttons, result rows,
and selected-detail elements in place. Unchanged text is not replaced. Server
outages retain the last snapshot with an outdated label. The Chrome check verifies
row order, focus, selected text, expanded properties, and connection recovery.

**Problem:** every poll runs `container.replaceChildren()`. As a result:
- scrolling inside the scan data `<pre>` jumps back to the top,
- text selection is cleared, so a MAC address can't be copied,
- keyboard focus on `<summary>` is lost,
- any short server hiccup wipes all the cards.

**Suggested fix**
- Update in place: keep a `Map` from node_id to its elements and change text only when it changed.
- Replace the `<pre>` text only when the JSON changed.
- When disconnected, hide the grid instead of destroying it.
- Add `[hidden]{display:none!important}`, because `#nodes{display:grid}` overrides the default `hidden` style.

### 5. Bluetooth "connect timed out" message is unreachable

*Reproduced.* Code: [bluetooth.py:254-261](device_scanner/scanners/bluetooth.py#L254-L261).

**Problem:** `TimeoutError` is a subclass of `OSError`, so `except (OSError, EOFError)` catches it first. The `except TimeoutError` branch is dead code.

**Effect:** the dashboard shows `Cannot communicate with the system D-Bus: ` with nothing after it.

**Suggested fix:** move `except TimeoutError` above `except (OSError, EOFError)`.

### 6. Local traffic is sent through `http_proxy`

*Confirmed.* Code: [node.py:44](device_scanner/node.py#L44) (`post_report`) and [dev.py:63](device_scanner/dev.py#L63) (health check).

**Problem**
- `urllib` uses the proxy environment variables.
- It does not skip the proxy for 127.0.0.1 or LAN addresses unless `no_proxy` is set. With `http_proxy` set, `urllib.request.proxy_bypass('127.0.0.1')` returns `False`.

**Effect:** on a Pi with a system proxy, reports go to the proxy. They either fail or send scan data to it.

**Suggested fix:** use `build_opener(ProxyHandler({}))` instead of `urlopen`.

### 7. On Python 3.10 the node silently stops

Code: [node.py:57-61](device_scanner/node.py#L57-L61) (`pause`), [dummy.py:10-14](device_scanner/scanners/dummy.py#L10-L14). There is no version check in [`__main__.py`](device_scanner/__main__.py).

**Problem**
- Before 3.11, `asyncio.wait_for` raises `asyncio.TimeoutError`, which is not the built-in `TimeoutError`, so `except TimeoutError` misses it.
- Every loop task dies after its first report.
- The exceptions are only collected at shutdown, so nothing is logged.
- The process keeps running, and the server marks the node offline.

The README requires 3.11+, but Ubuntu 22.04 ships 3.10. This was not run on 3.10, because no 3.10 interpreter was available; it follows from how asyncio behaves.

**Suggested fix:** check `sys.version_info` at the start of `main()` and exit with a clear message.

### 8. Server memory is unbounded

Code: [server.py:110](device_scanner/server.py#L110) (`accept_report`), [server.py:124-133](device_scanner/server.py#L124-L133) (`snapshot`).

**Still open after the 2026-10-04 changes:** short-term source history and the
discovery ledger are bounded, but the node registry and each radio's latest
successful scan are still retained without a global node-count limit. These
structures are still deep-copied for snapshots. The new history limits do not
resolve this original server-memory issue.

**Problem**
- Any client can register unlimited node IDs, each holding up to 1 MiB per radio, and they are never removed.
- `snapshot()` deep-copies all of it under the lock on every poll, once for each open dashboard.
- The README says to bind `0.0.0.0` without authentication.

**Suggested fix**
- Cap the number of nodes (e.g. 100). When the cap is reached, evict the node that has been silent longest if it is offline; otherwise reply 503.
- Use shallow copies in `snapshot()`. Observation lists are replaced, never changed in place, so sharing them is safe.

### 9. Dev launcher can hang on Ctrl+C (rare)

Code: [dev.py:40-43](device_scanner/dev.py#L40-L43) and the `stopped.wait()` loops.

**Problem**
- The signal handler calls `threading.Event.set()`.
- `Event` uses a non-reentrant `Lock` internally (`Condition(Lock())`).
- If the signal is handled while the main thread holds that lock inside `stopped.wait()`, the handler blocks forever.

**Effect**
- The launcher hangs.
- The children were started with `start_new_session=True`, so they keep running and holding the port.

**Suggested fix:** the handler only sets a plain flag, and the loops use `time.sleep()` and check that flag.

### 10. Minor error-handling issues

- **A scan timeout shows only "TimeoutError" on the dashboard.**
  - Code: [node.py:84-94](device_scanner/node.py#L84-L94).
  - Cause: `str(TimeoutError())` is empty, so the code falls back to the class name.
  - Fix: use an explicit message, such as "Scan did not finish within N seconds".
- **A disappearing network device aborts the Wi-Fi scan.**
  - Code: [wifi.py:219-224](device_scanner/scanners/wifi.py#L219-L224).
  - Cause: if a device disappears between `GetDevices` and `GetAll`, for example a Docker veth interface, the whole Wi-Fi scan fails.
  - Fix: skip `UnknownObject` errors, as the access point loop already does.

---

## Known gaps (not bugs; possible features)

- **Duplicate node IDs are merged.** Two nodes started with the same `--id` silently share one card. Their data interleaves, and either one keeps it "online".
- **The server is IPv4-only.** `ThreadingHTTPServer` defaults to `AF_INET`, so `--host ::` fails.
- **`Content-Length` parsing is lenient.** For example `int("5_0") == 50`, and `+7` is accepted.
- **`--interval` has no lower bound.** A value like `0.0001` floods the server.
