#!/usr/bin/env node
// Optional developer check: Node built-ins + installed Chrome, no npm packages.
// Starts only temporary local servers, posts synthetic data, never scans radios.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "scanner-browser-"));
const children = [];
const runtimeErrors = [];
const browserRequests = [];
const checks = [];
let chrome;
let commandId = 0;
const pending = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function pass(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function until(fn, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${message}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function child(executable, args, options = {}) {
  const process = spawn(executable, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.push(process);
  process.log = "";
  for (const stream of [process.stdout, process.stderr])
    stream?.on("data", (chunk) => {
      process.log = (process.log + chunk).slice(-12000);
    });
  process.on("error", (error) => {
    process.launchError = error;
  });
  return process;
}
async function waitServer(server, url) {
  await until(async () => {
    if (server.launchError) throw server.launchError;
    if (server.exitCode !== null)
      throw new Error(`Server exited: ${server.log}`);
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  }, "temporary server startup");
}
function cdp(method, params = {}, sessionId) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timed out: ${method}`));
    }, 12000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }) + "\0",
    );
  });
}
function attachCDP() {
  let buffer = "";
  chrome.stdio[4].setEncoding("utf8");
  chrome.stdio[4].on("data", (chunk) => {
    buffer += chunk;
    let separator;
    while ((separator = buffer.indexOf("\0")) !== -1) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error)
          entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        runtimeErrors.push(
          message.params.exceptionDetails.exception?.description ||
            message.params.exceptionDetails.text,
        );
      } else if (message.method === "Network.requestWillBeSent") {
        browserRequests.push(message.params.request.url);
      }
    }
  });
}
async function evaluate(session, expression) {
  const result = await cdp(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    session,
  );
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text,
    );
  return result.result.value;
}
async function click(session, selector) {
  const point = await evaluate(
    session,
    `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Missing element");
    element.scrollIntoView({ block: "center", inline: "center" });
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!bounds.width || !bounds.height || !element.contains(hit)) throw new Error("Element is hidden or covered by " + (hit ? hit.tagName.toLowerCase() + (hit.className ? "." + hit.className : "") : "nothing"));
    return { x, y };
  })()`,
  );
  await cdp(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", ...point, button: "left", clickCount: 1 },
    session,
  );
  await cdp(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", ...point, button: "left", clickCount: 1 },
    session,
  );
}
async function text(session, selector) {
  return evaluate(
    session,
    `document.querySelector(${JSON.stringify(selector)})?.textContent`,
  );
}
// Like until(), but tolerates evaluation errors while a navigation replaces the page.
async function untilPage(session, expression, message) {
  await until(async () => {
    try {
      return await evaluate(session, expression);
    } catch {
      return false;
    }
  }, message);
}
async function setSearch(session, value) {
  await evaluate(
    session,
    `(() => { const input = document.getElementById("search"); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event("input", { bubbles: true })); })()`,
  );
}
async function key(session, name, code, keyCode, typed) {
  const base = {
    key: name,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  };
  await cdp(
    "Input.dispatchKeyEvent",
    {
      type: "keyDown",
      ...base,
      ...(typed ? { text: typed, unmodifiedText: typed } : {}),
    },
    session,
  );
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base }, session);
}
async function screenshot(session, filename) {
  await evaluate(session, "window.scrollTo(0, 0)");
  await sleep(200); // Let scroll position and theme transitions settle.
  const { cssContentSize } = await cdp("Page.getLayoutMetrics", {}, session);
  const result = await cdp(
    "Page.captureScreenshot",
    {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: cssContentSize.width,
        height: cssContentSize.height,
        scale: 1,
      },
    },
    session,
  );
  await writeFile(filename, Buffer.from(result.data, "base64"));
}

let heartbeatTimer;
let fixtureFailure;
try {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = child(process.env.PYTHON || "python3", [
    "-m",
    "device_scanner",
    "server",
    "--port",
    String(port),
    "--offline-after",
    "5",
  ]);
  await waitServer(server, base + "/api/health");
  chrome = child(
    process.env.CHROME_BIN || "/usr/bin/google-chrome",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-debugging-pipe",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--user-data-dir=${path.join(temporary, "chrome")}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] },
  );
  attachCDP();
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId: session } = await cdp("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await cdp("Runtime.enable", {}, session);
  await cdp("Network.enable", {}, session);
  await cdp("Page.enable", {}, session);
  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: temporary,
  });
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 1536, height: 1050, deviceScaleFactor: 1, mobile: false },
    session,
  );
  await cdp("Page.navigate", { url: base }, session);
  await untilPage(
    session,
    "document.getElementById('connection-text')?.textContent === 'Server connected'",
    "initial connection",
  );
  assert.equal(await text(session, "#online-value"), "0");
  assert.equal(
    await text(session, "#empty-title"),
    "Listening for your scanners",
  );
  pass("Empty server renders a useful waiting state");

  const paused = new Set();
  const post = async (nodeId, report) => {
    const response = await fetch(base + "/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId, scanner: "dummy", ...report }),
    });
    assert.equal(response.status, 200, await response.text());
  };
  const wifi = (index) => [
    {
      path: "/wifi/office",
      properties: {
        SSID: "Studio Network",
        BSSID: "02:A4:32:80:11:01",
        Strength: 90 - index * 8,
        Frequency: 5180,
        Channel: 36,
        Security: "WPA2 Personal",
      },
    },
    {
      path: "/wifi/guest",
      properties: {
        SSID: "Studio Guest",
        BSSID: `02:A4:32:80:12:0${index}`,
        Strength: 65 - index * 5,
        Frequency: 2437,
        Channel: 6,
        Security: "WPA2 Personal",
      },
    },
    {
      path: "/wifi/lab",
      properties: {
        SSID: "Lab · 6 GHz",
        BSSID: `02:A4:32:80:13:0${index}`,
        Strength: 55 - index * 3,
        Frequency: 5955,
        Channel: 1,
        Security: "WPA3 Personal",
      },
    },
    {
      path: "/wifi/hidden",
      properties: {
        SSID: "",
        BSSID: `02:A4:32:80:14:0${index}`,
        Strength: 28 + index,
        Frequency: 2462,
        Channel: 11,
        Security: "Open",
      },
    },
  ];
  const sendScan = (nodeId, radio, observations) =>
    post(nodeId, {
      kind: "scan",
      radio,
      status: "success",
      observed_at: new Date().toISOString(),
      observations,
    });
  for (let i = 1; i <= 3; i++) {
    await sendScan(`pi-0${i}`, "wifi", wifi(i));
    await sendScan(`pi-0${i}`, "bluetooth", [
      {
        path: "/bluetooth/beacon",
        properties: {
          Name: `Room ${i} beacon`,
          Address: `02:BB:CC:DD:EE:0${i}`,
          RSSI: -40 - i * 10,
          AddressType: "public",
          Paired: false,
          Connected: false,
        },
      },
    ]);
  }
  heartbeatTimer = setInterval(async () => {
    try {
      for (let i = 1; i <= 3; i++)
        if (!paused.has(i)) await post(`pi-0${i}`, { kind: "heartbeat" });
    } catch (error) {
      fixtureFailure = error;
    }
  }, 500);
  await click(session, "#refresh");
  await untilPage(
    session,
    "document.querySelectorAll('#results tr').length === 12",
    "twelve Wi-Fi observations",
  );
  assert.equal(await text(session, "#online-value"), "3");
  assert.equal(await text(session, "#observations-value"), "12");
  assert.equal(
    await evaluate(
      session,
      "document.querySelectorAll('#distribution-chart .chart-bar').length",
    ),
    4,
  );
  assert.match(
    await text(session, "#distribution-chart title"),
    /Ch 36 \(5 GHz\): 1/,
  );
  pass("All three Pis report; channel chart deduplicates shared BSSIDs");

  await click(session, '#nodes [data-node-id="pi-02"]');
  assert.equal(
    await evaluate(session, "document.querySelectorAll('#results tr').length"),
    4,
  );
  assert.ok((await text(session, "#scope-caption")).startsWith("pi-02"));
  await setSearch(session, " GUEST ");
  assert.equal(
    await evaluate(session, "document.querySelectorAll('#results tr').length"),
    1,
  );
  assert.equal(await text(session, ".detail-identity h3"), "Studio Guest");
  await setSearch(session, "nothing-matches");
  assert.equal(await text(session, "#empty-title"), "No matching observations");
  await click(session, "#clear-filters");
  await click(session, "#all-nodes");
  await evaluate(
    session,
    "document.getElementById('band').value='5'; document.getElementById('band').dispatchEvent(new Event('change'))",
  );
  assert.equal(
    await evaluate(session, "document.querySelectorAll('#results tr').length"),
    3,
  );
  pass("Pi, search, empty-search, and frequency filters compose correctly");

  await click(session, ".export-menu summary");
  await click(session, "#export-json");
  const { readdir } = await import("node:fs/promises");
  let downloaded;
  await until(async () => {
    downloaded = (await readdir(temporary)).find((name) =>
      name.endsWith(".json"),
    );
    return Boolean(downloaded);
  }, "JSON download");
  const exported = JSON.parse(
    await readFile(path.join(temporary, downloaded), "utf8"),
  );
  assert.equal(exported.count, 3);
  assert.equal(exported.filters.band, "5");
  assert.equal(exported.outdated, false);
  await click(session, ".export-menu summary");
  await click(session, "#export-csv");
  await until(
    async () =>
      (await readdir(temporary)).some((name) => name.endsWith(".csv")),
    "CSV download",
  );
  const csv = await readFile(
    path.join(
      temporary,
      (await readdir(temporary)).find((name) => name.endsWith(".csv")),
    ),
    "utf8",
  );
  assert.equal(csv.trim().split("\r\n").length, 4);
  pass("JSON and CSV downloads contain exactly the filtered rows");

  await evaluate(
    session,
    "document.getElementById('band').value='all'; document.getElementById('band').dispatchEvent(new Event('change'))",
  );
  await click(session, "#results tr:nth-child(2) .result-name");
  const selected = await evaluate(
    session,
    "document.querySelector('#results .selected').dataset.key",
  );
  await evaluate(
    session,
    "document.querySelector('#results .selected button').focus()",
  );
  await key(session, "ArrowDown", "ArrowDown", 40);
  assert.notEqual(
    await evaluate(
      session,
      "document.querySelector('#results .selected').dataset.key",
    ),
    selected,
  );
  const focusedKey = await evaluate(
    session,
    "document.activeElement.closest('tr').dataset.key",
  );
  const originalOrder = await evaluate(
    session,
    "Array.from(document.querySelectorAll('#results tr')).map(row => row.dataset.key)",
  );
  const updated = wifi(1);
  updated[0].properties.Strength = 15;
  await sendScan("pi-01", "wifi", updated);
  await untilPage(
    session,
    "document.querySelector('#results tr .signal-reading').textContent === '15%'",
    "updated signal",
  );
  assert.deepEqual(
    await evaluate(
      session,
      "Array.from(document.querySelectorAll('#results tr')).map(row => row.dataset.key)",
    ),
    originalOrder,
  );
  assert.equal(
    await evaluate(
      session,
      "document.activeElement.closest('tr')?.dataset.key",
    ),
    focusedKey,
  );
  await click(session, "#sort-now");
  assert.notEqual(
    await evaluate(
      session,
      "document.querySelector('#results tr').dataset.key",
    ),
    originalOrder[0],
  );
  pass(
    "Polling preserves row order, keyboard focus and selection; explicit sorting reorders",
  );

  await sendScan("pi-01", "wifi", wifi(1));
  await click(session, "#refresh");
  await untilPage(
    session,
    "Array.from(document.querySelectorAll('#results .signal-reading')).some(el => el.textContent === '82%')",
    "restored signal",
  );
  await click(session, "#sort-now");
  await click(session, "#results tr:first-child .result-name");
  assert.ok(
    await evaluate(
      session,
      "document.querySelectorAll('#history-chart .chart-point').length >= 2",
    ),
  );
  await screenshot(session, "/tmp/device-scanner-desktop.png");
  await click(session, "#theme");
  assert.equal(
    await evaluate(session, "document.documentElement.dataset.theme"),
    "dark",
  );
  await screenshot(session, "/tmp/device-scanner-dark.png");
  await cdp("Page.reload", {}, session);
  await untilPage(
    session,
    "document.querySelectorAll('#results tr').length === 12",
    "reload",
  );
  assert.equal(
    await evaluate(session, "document.documentElement.dataset.theme"),
    "dark",
  );
  await click(session, "#theme");
  pass("Signal history records real reports; theme persists across reloads");

  const malicious = '<img src=x onerror="window.__unsafe=1">';
  await sendScan("pi-01", "bluetooth", [
    {
      path: "/bt/unsafe",
      properties: {
        Name: malicious,
        RSSI: -60,
        Extra: { original: "preserved" },
      },
    },
  ]);
  await click(session, "#refresh");
  await click(session, "#radio-bluetooth");
  await untilPage(
    session,
    `Array.from(document.querySelectorAll('.name-text')).some(el => el.textContent === ${JSON.stringify(malicious)})`,
    "literal reported name",
  );
  await setSearch(session, "onerror");
  assert.equal(await text(session, ".detail-identity h3"), malicious);
  await click(session, ".raw-details summary");
  assert.match(await text(session, ".raw-details pre"), /preserved/);
  await evaluate(
    session,
    "document.querySelector('.raw-details summary').focus(); const range = document.createRange(); range.selectNodeContents(document.querySelector('.detail-address')); getSelection().removeAllRanges(); getSelection().addRange(range)",
  );
  const selectedText = await evaluate(session, "getSelection().toString()");
  await sleep(2300);
  assert.equal(
    await evaluate(
      session,
      "document.activeElement.matches('.raw-details summary')",
    ),
    true,
  );
  assert.equal(
    await evaluate(session, "getSelection().toString()"),
    selectedText,
  );
  assert.equal(
    await evaluate(session, "document.querySelector('.raw-details').open"),
    true,
  );
  assert.equal(
    await evaluate(
      session,
      "Boolean(window.__unsafe || document.querySelector('#results img'))",
    ),
    false,
  );
  assert.equal(
    await evaluate(session, "document.getElementById('band-label').hidden"),
    true,
  );
  assert.equal(
    await text(session, "#distribution-title"),
    "Signal distribution",
  );
  await setSearch(session, "");
  pass(
    "Bluetooth uses dBm; names are safe text; detail focus, selection and expansion survive polling",
  );

  await setSearch(session, "");
  await click(session, "#radio-wifi");
  await click(session, '#nodes [data-node-id="pi-03"]');
  await post("pi-03", {
    kind: "scan",
    radio: "wifi",
    status: "error",
    error: "Wi-Fi adapter unavailable",
    observed_at: new Date().toISOString(),
  });
  await click(session, "#refresh");
  await untilPage(
    session,
    "document.querySelectorAll('#results tr.previous').length === 4",
    "retained results",
  );
  assert.equal(await text(session, "#observations-value"), "0");
  assert.match(
    await text(session, "#details-content"),
    /Wi-Fi adapter unavailable/,
  );
  assert.equal(
    await evaluate(
      session,
      "document.querySelectorAll('#distribution-chart .chart-bar').length",
    ),
    0,
  );
  await sendScan("pi-03", "wifi", []);
  await click(session, "#refresh");
  await untilPage(
    session,
    "document.querySelectorAll('#results tr').length === 0",
    "successful empty scan",
  );
  assert.equal(await text(session, "#errors-value"), "0");
  pass(
    "Radio errors retain labeled previous data; successful empty scans clear it",
  );

  await sendScan("pi-03", "wifi", wifi(3));
  paused.add(3);
  await untilPage(
    session,
    "document.querySelector('[data-node-id=\"pi-03\"] .state-label').textContent === 'Offline'",
    "offline Pi",
  );
  assert.equal(await text(session, "#online-value"), "2");
  assert.equal(await text(session, "#observations-value"), "0");
  paused.delete(3);
  await untilPage(
    session,
    "document.querySelector('[data-node-id=\"pi-03\"] .state-label').textContent === 'Online'",
    "Pi reconnects",
  );
  pass(
    "Offline Pi is independent of healthy scanners and recovers on heartbeat",
  );

  await cdp(
    "Network.emulateNetworkConditions",
    { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
    session,
  );
  await click(session, "#refresh");
  await untilPage(
    session,
    "!document.getElementById('connection-banner').hidden",
    "server outage banner",
  );
  assert.equal(await text(session, "#online-value"), "—");
  assert.equal(
    await evaluate(session, "document.querySelectorAll('#results tr').length"),
    4,
  );
  assert.match(await text(session, ".state-badge"), /Outdated/);
  await cdp(
    "Network.emulateNetworkConditions",
    {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    },
    session,
  );
  await click(session, "#refresh");
  await untilPage(
    session,
    "document.getElementById('connection-banner').hidden",
    "server reconnection",
  );
  pass(
    "Server outage preserves labeled old results and recovers without reload",
  );

  await click(session, "#all-nodes");
  for (const width of [1024, 768, 390]) {
    await cdp(
      "Emulation.setDeviceMetricsOverride",
      { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 },
      session,
    );
    assert.equal(
      await evaluate(
        session,
        "document.documentElement.scrollWidth <= innerWidth",
      ),
      true,
      `overflow at ${width}px`,
    );
  }
  await click(session, '#nodes [data-node-id="pi-02"]');
  assert.equal(
    await evaluate(session, "document.querySelectorAll('#results tr').length"),
    4,
  );
  await click(session, "#results tr:first-child .result-name");
  await screenshot(session, "/tmp/device-scanner-mobile.png");
  pass("Tablet and phone layouts fit; Pi selection and details work on mobile");
  assert.deepEqual(runtimeErrors, []);
  assert.equal(
    browserRequests.some(
      (url) => /^https?:/.test(url) && !url.startsWith(base),
    ),
    false,
  );
  assert.equal(fixtureFailure, undefined);
  console.log(
    `\n${checks.length} browser checks passed. Screenshots: /tmp/device-scanner-{desktop,dark,mobile}.png`,
  );
} finally {
  clearInterval(heartbeatTimer);
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Browser shutting down"));
  }
  pending.clear();
  for (const process of children.reverse()) {
    if (process.exitCode !== null) continue;
    process.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => process.once("exit", resolve)),
      sleep(1500),
    ]);
    if (process.exitCode === null) process.kill("SIGKILL");
  }
  await rm(temporary, { recursive: true, force: true });
}
