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

import { record } from "../tests/frontend/fixtures.js";
import { WIGLE_COLUMNS } from "../device_scanner/static/js/export.js";

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
async function untilPage(session, expression, message, timeout = 12000) {
  await until(
    async () => {
      try {
        return await evaluate(session, expression);
      } catch {
        return false;
      }
    },
    message,
    timeout,
  );
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

async function setField(session, id, value) {
  await evaluate(
    session,
    `(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  })()`,
  );
}
async function activeTab(session, tab) {
  await click(session, `[data-tab="${tab}"]`);
}
const rowCount = (session) =>
  evaluate(session, "document.querySelectorAll('#device-rows tr').length");
const selectedSource = (session) =>
  evaluate(
    session,
    "document.querySelector('#device-sources [aria-pressed=true]')?.dataset.sourceId",
  );

let heartbeatTimer;
let fixtureFailure;
try {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const placementsFile = path.join(temporary, "placements.json");
  const server = child(process.env.PYTHON || "python3", [
    "-m",
    "device_scanner",
    "server",
    "--port",
    String(port),
    "--offline-after",
    "5",
    "--placements-file",
    placementsFile,
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
  for (const domain of ["Runtime", "Network", "Page"])
    await cdp(`${domain}.enable`, {}, session);
  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: temporary,
  });
  const viewport = (width, height) =>
    cdp(
      "Emulation.setDeviceMetricsOverride",
      {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      session,
    );
  await viewport(1440, 900);
  await cdp("Page.navigate", { url: base }, session);
  await untilPage(
    session,
    "document.getElementById('connection-text')?.textContent === 'Canlı veri'",
    "initial connection",
  );
  assert.equal(await text(session, "#summary-wifi"), "—");
  assert.equal(await text(session, "#summary-bluetooth"), "—");
  assert.equal(await rowCount(session), 0);
  assert.equal(
    await evaluate(session, "document.getElementById('view-sensors').hidden"),
    true,
  );
  assert.equal(
    await evaluate(session, "document.getElementById('device-drawer').open"),
    false,
  );
  pass(
    "Empty server shows unknown counts and waiting state; setup and details stay secondary",
  );

  const paused = new Set();
  const blockedRadios = new Set();
  const fixtures = new Map();
  const post = async (nodeId, report) => {
    const response = await fetch(base + "/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId, scanner: "dummy", ...report }),
    });
    assert.equal(response.status, 200, await response.text());
  };
  const heartbeat = (nodeId) =>
    post(nodeId, {
      kind: "heartbeat",
      enabled_radios: ["wifi", "bluetooth"],
      expected_cycle_seconds: { wifi: 2, bluetooth: 2 },
    });
  const reportScan = (nodeId, radio, observations) =>
    post(nodeId, {
      kind: "scan",
      radio,
      status: "success",
      observed_at: new Date().toISOString(),
      observations,
    });
  const sendScan = async (nodeId, radio, observations) => {
    if (!fixtures.has(nodeId)) fixtures.set(nodeId, {});
    fixtures.get(nodeId)[radio] = observations;
    blockedRadios.delete(`${nodeId}:${radio}`);
    await reportScan(nodeId, radio, observations);
  };
  const refresh = async () => {
    await click(session, "#refresh");
    await sleep(150);
  };
  const snapshot = async () => (await fetch(base + "/api/nodes")).json();
  const wifi = (index) => [
    record({
      SSID: "Ofis Ağı",
      MAC: "02:A4:32:80:11:01",
      RSSI: -30 - index * 8,
      Frequency: 5180,
      Channel: 36,
      AuthMode: "[WPA2-PSK-CCMP][ESS]",
    }),
    record({
      SSID: `Misafir ${index}`,
      MAC: `02:A4:32:80:12:0${index}`,
      RSSI: -55 - index * 5,
      Frequency: 2437,
      Channel: 6,
      AuthMode: "[ESS]",
    }),
    record({
      SSID: `Laboratuvar ${index}`,
      MAC: `02:A4:32:80:13:0${index}`,
      RSSI: -65 - index * 3,
      Frequency: 5955,
      Channel: 1,
      AuthMode: "[WPA2-SAE-CCMP][ESS]",
    }),
    record({
      SSID: "",
      MAC: `02:A4:32:80:14:0${index}`,
      RSSI: -90 + index,
      Frequency: 2462,
      Channel: 11,
      AuthMode: "[WPA2-PSK-CCMP][ESS]",
    }),
  ];
  const bluetooth = (index) => [
    record({
      SSID: "Ortak işaretçi",
      MAC: "02:BB:CC:DD:EE:00",
      RSSI: -40 - index * 8,
      Type: index === 1 ? "BT" : "BLE",
      Channel: 0,
      Frequency: 7936,
      AuthMode: `Misc [${index === 1 ? "BT" : "BLE"}]`,
      MfgrId: 72,
    }),
    record({
      SSID: `Kulaklık ${index}`,
      MAC: `02:BB:CC:DD:EE:0${index}`,
      RSSI: -50 - index * 6,
      Type: "BLE",
      Channel: 0,
      Frequency: 7936,
      AuthMode: "audio-headset [BLE]",
      MfgrId: 72,
    }),
  ];
  await heartbeat("pi-01");
  await sendScan("pi-01", "wifi", []);
  await sendScan("pi-01", "bluetooth", []);
  await refresh();
  await untilPage(
    session,
    "document.getElementById('summary-wifi').textContent === '0' && document.getElementById('summary-bluetooth').textContent === '0'",
    "successful empty scan counts",
  );
  assert.match(await text(session, "#devices-empty-title"), /görül|bulun/i);
  assert.equal(
    await text(session, '#floor-summaries [data-floor="1"] .wifi-value'),
    "0 Wi-Fi",
  );
  assert.equal(
    await text(session, '#floor-summaries [data-floor="2"] .wifi-value'),
    "— Wi-Fi",
  );
  pass(
    "Successful empty scans show zero, distinct from an unobserved building",
  );

  for (let index = 1; index <= 3; index++) {
    const nodeId = `pi-0${index}`;
    await heartbeat(nodeId);
    await sendScan(nodeId, "wifi", wifi(index));
    await sendScan(nodeId, "bluetooth", bluetooth(index));
  }
  let fixtureBusy = false;
  let lastScans = Date.now();
  heartbeatTimer = setInterval(async () => {
    if (fixtureBusy) return;
    fixtureBusy = true;
    try {
      const scanNow = Date.now() - lastScans >= 2000;
      if (scanNow) lastScans = Date.now();
      for (const [nodeId, radios] of fixtures) {
        if (paused.has(nodeId)) continue;
        await heartbeat(nodeId);
        if (scanNow)
          for (const [radio, records] of Object.entries(radios))
            if (!blockedRadios.has(`${nodeId}:${radio}`))
              await reportScan(nodeId, radio, records);
      }
    } catch (error) {
      fixtureFailure = error;
    } finally {
      fixtureBusy = false;
    }
  }, 500);
  await refresh();
  await untilPage(
    session,
    "document.querySelectorAll('#device-rows tr').length === 14",
    "14 grouped devices",
  );
  assert.equal(await text(session, "#summary-wifi"), "10");
  assert.equal(await text(session, "#summary-bluetooth"), "4");
  assert.match(await text(session, "#coverage-value"), /3\s*\/\s*3/);
  assert.equal(
    await evaluate(session, "document.getElementById('demo-banner').hidden"),
    false,
  );
  assert.equal(
    await evaluate(
      session,
      "document.querySelectorAll('#floor-summaries button[data-floor]').length >= 3",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      session,
      "/pi-0[123]/.test(document.getElementById('view-observations').innerText)",
    ),
    false,
  );
  pass(
    "Overview deduplicates three-Pi Wi-Fi and BT/BLE readings; demo data is explicit",
  );

  for (const [width, height] of [
    [1366, 650],
    [1440, 900],
    [1920, 1080],
  ]) {
    await viewport(width, height);
    await evaluate(session, "window.scrollTo(0,0)");
    const bounds = await evaluate(
      session,
      `(() => {
      const selectors = ['#environment-status','#overview-summary','#floor-overview','#device-rows tr:nth-child(5)'];
      return selectors.map(selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {selector,bottom:r.bottom,top:r.top,height:innerHeight}; });
      })()`,
    );
    if (bounds.some((item) => item.top < 0 || item.bottom > height)) {
      console.log(
        await evaluate(
          session,
          `Array.from(document.querySelectorAll('.workspace-heading,#demo-banner,#environment-status,.environment-metrics,.observation-layout,#floor-overview,#floor-summaries button,#device-rows tr:nth-child(5)')).map(element=>({element:element.id||element.className,...JSON.parse(JSON.stringify(element.getBoundingClientRect()))}))`,
        ),
      );
      await screenshot(
        session,
        "/tmp/device-scanner-oneshot-layout-failure.png",
      );
    }
    for (const item of bounds)
      assert.ok(
        item.top >= 0 && item.bottom <= height,
        `${width}x${height}: ${item.selector} bottom ${item.bottom}`,
      );
    assert.equal(
      await evaluate(
        session,
        "document.documentElement.scrollWidth <= innerWidth",
      ),
      true,
    );
  }
  await viewport(1440, 900);
  await screenshot(session, "/tmp/device-scanner-oneshot-overview.png");
  await click(session, "#theme");
  assert.equal(
    await evaluate(session, "document.documentElement.dataset.theme"),
    "dark",
  );
  await screenshot(session, "/tmp/device-scanner-oneshot-dark.png");
  await cdp("Page.reload", {}, session);
  await untilPage(
    session,
    "document.querySelectorAll('#device-rows tr').length === 14",
    "theme reload",
  );
  assert.equal(
    await evaluate(session, "document.documentElement.dataset.theme"),
    "dark",
  );
  await click(session, "#theme");
  pass(
    "Three desktop sizes expose status, counters, all floors and five rows immediately; theme persists",
  );

  await setField(session, "device-radio", "wifi");
  assert.equal(await rowCount(session), 10);
  await click(session, '#floor-summaries button[data-floor="1"]');
  assert.equal(await rowCount(session), 4);
  await setField(session, "device-search", " misafir ");
  assert.equal(await rowCount(session), 1);
  assert.equal(await text(session, "#summary-wifi"), "10");
  assert.equal(await text(session, "#summary-bluetooth"), "4");
  await setField(session, "device-search", "nothing-matches");
  assert.equal(await rowCount(session), 0);
  assert.equal(
    await evaluate(
      session,
      "document.getElementById('device-clear-filters').hidden",
    ),
    false,
  );
  await click(session, "#device-clear-filters");
  assert.equal(await rowCount(session), 14);
  await key(session, "2", "Digit2", 50, "2");
  assert.equal(
    await evaluate(session, "document.getElementById('device-floor').value"),
    "2",
  );
  assert.equal(await rowCount(session), 6);
  await click(session, "#reset-floor");
  await key(session, "/", "Slash", 191, "/");
  assert.equal(
    await evaluate(session, "document.activeElement.id"),
    "device-search",
  );
  pass(
    "Device filters compose and clear without changing the building counters",
  );

  const order = await evaluate(
    session,
    "Array.from(document.querySelectorAll('#device-rows tr')).map(row=>row.dataset.key)",
  );
  await evaluate(
    session,
    "document.querySelector('#device-rows tr:nth-child(3) button').focus()",
  );
  const focused = await evaluate(
    session,
    "document.activeElement.closest('tr').dataset.key",
  );
  const changed = wifi(1);
  changed[0].RSSI = -95;
  await sendScan("pi-01", "wifi", changed);
  await sleep(2300);
  assert.deepEqual(
    await evaluate(
      session,
      "Array.from(document.querySelectorAll('#device-rows tr')).map(row=>row.dataset.key)",
    ),
    order,
  );
  assert.equal(
    await evaluate(
      session,
      "document.activeElement.closest('tr')?.dataset.key",
    ),
    focused,
  );
  await setField(session, "device-search", "Ofis Ağı");
  await click(session, "#device-rows tr:first-child button");
  assert.equal(
    await evaluate(session, "document.getElementById('device-drawer').open"),
    true,
  );
  assert.equal(
    await evaluate(
      session,
      "document.querySelectorAll('#device-sources [data-source-id]').length",
    ),
    3,
  );
  await click(session, "#device-sources button:nth-child(2)");
  const sourceId = await selectedSource(session);
  assert.ok(sourceId);
  const sourceNode = JSON.parse(sourceId)[0];
  const next = wifi(1);
  next[0].RSSI = -25;
  await sendScan("pi-01", "wifi", next);
  await sleep(2300);
  assert.equal(await selectedSource(session), sourceId);
  assert.match(
    await text(session, "#device-history-key"),
    new RegExp(sourceNode),
  );
  const drawerRecord = JSON.parse(await text(session, "#device-raw"));
  assert.deepEqual(Object.keys(drawerRecord), WIGLE_COLUMNS);
  assert.equal(drawerRecord.RSSI, fixtures.get(sourceNode).wifi[0].RSSI);
  assert.ok(
    await evaluate(
      session,
      "document.querySelectorAll('#device-history-chart .chart-point').length >= 1",
    ),
  );
  await screenshot(session, "/tmp/device-scanner-oneshot-drawer.png");
  await key(session, "Escape", "Escape", 27);
  assert.equal(
    await evaluate(session, "document.getElementById('device-drawer').open"),
    false,
  );
  assert.equal(
    await evaluate(
      session,
      "document.activeElement.closest('tr')?.dataset.key",
    ),
    JSON.stringify(["wifi", "02:A4:32:80:11:01"]),
  );
  assert.equal(
    await evaluate(session, "document.getElementById('device-search').value"),
    "Ofis Ağı",
  );
  await click(session, "#device-rows tr:first-child button");
  await click(session, "#device-sources button:nth-child(2)");
  const analyzedSource = JSON.parse(await selectedSource(session))[0];
  await click(session, "#device-open-analysis");
  assert.equal(
    await evaluate(session, "document.getElementById('view-analysis').hidden"),
    false,
  );
  assert.equal(
    await evaluate(session, "document.getElementById('analysis-node').value"),
    analyzedSource,
  );
  pass(
    "Live updates preserve row order and focus; drawer keeps per-Pi history and restores keyboard context",
  );

  await setField(session, "analysis-node", "all");
  await setSearch(session, "");
  await setField(session, "band", "5");
  assert.equal(
    await evaluate(session, "document.querySelectorAll('#results tr').length"),
    3,
  );
  assert.equal(
    await evaluate(
      session,
      "document.querySelectorAll('#distribution-chart .chart-bar').length",
    ),
    1,
  );
  await evaluate(session, "document.querySelector('.export-menu').open=true");
  await click(session, "#export-json");
  const { readdir } = await import("node:fs/promises");
  let downloaded;
  await until(async () => {
    downloaded = (await readdir(temporary)).find(
      (name) => name.startsWith("device-scanner-") && name.endsWith(".json"),
    );
    return Boolean(downloaded);
  }, "JSON download");
  const exported = JSON.parse(
    await readFile(path.join(temporary, downloaded), "utf8"),
  );
  assert.equal(exported.count, 3);
  assert.equal(exported.filters.band, "5");
  assert.equal(exported.outdated, false);
  assert.deepEqual(
    new Set(exported.observations.map((item) => item.node_id)),
    new Set(["pi-01", "pi-02", "pi-03"]),
  );
  for (const item of exported.observations)
    assert.deepEqual(Object.keys(item.record), WIGLE_COLUMNS);
  await evaluate(session, "document.querySelector('.export-menu').open=true");
  await click(session, "#export-csv");
  await until(
    async () =>
      (await readdir(temporary)).some((name) => name.endsWith(".csv")),
    "CSV download",
  );
  const csvName = (await readdir(temporary)).find((name) =>
    name.endsWith(".csv"),
  );
  const csv = await readFile(path.join(temporary, csvName), "utf8");
  assert.equal(csv.trim().split("\r\n").length, 5);
  assert.ok(csv.startsWith("WigleWifi-1.6,"));
  assert.equal(csv.split("\r\n")[1], WIGLE_COLUMNS.join(","));
  for (const line of csv.trim().split("\r\n").slice(2))
    assert.equal(line.split(",").length, 14);
  await evaluate(session, "document.querySelector('.export-menu').open=false");
  await setField(session, "band", "all");
  await click(session, "#results tr:first-child .result-name");
  await screenshot(session, "/tmp/device-scanner-oneshot-analysis.png");
  pass(
    "Analysis retains every Pi measurement and exports exact filtered WiGLE v1.6 records",
  );

  await activeTab(session, "sensors");
  for (let floor = 1; floor <= 3; floor++)
    assert.equal(
      await evaluate(
        session,
        `document.querySelector('#floor-nodes-${floor} .building-node')?.dataset.nodeId`,
      ),
      `pi-0${floor}`,
    );
  await click(session, '#building .building-node[data-node-id="pi-02"]');
  await evaluate(session, "document.getElementById('placement-floor').focus()");
  await key(session, "ArrowUp", "ArrowUp", 38);
  await until(
    async () =>
      (await snapshot()).nodes.find((node) => node.node_id === "pi-02")
        .floor === 1,
    "shared floor assignment",
  );
  await untilPage(
    session,
    "document.querySelectorAll('#floor-nodes-1 .building-node').length === 2",
    "two sensors on first floor",
  );
  await sleep(2300);
  assert.equal(
    await evaluate(session, "document.activeElement.id"),
    "placement-floor",
  );
  assert.equal(JSON.parse(await readFile(placementsFile, "utf8"))["pi-02"], 1);
  await screenshot(session, "/tmp/device-scanner-oneshot-sensors.png");
  await cdp("Page.reload", {}, session);
  await untilPage(
    session,
    "document.querySelectorAll('#device-rows tr').length === 14",
    "reload after placement",
  );
  await activeTab(session, "sensors");
  assert.equal(
    await evaluate(
      session,
      "document.querySelectorAll('#floor-nodes-1 .building-node').length",
    ),
    2,
  );
  await click(session, '#building .building-node[data-node-id="pi-02"]');
  assert.equal(await text(session, "#placement-location"), "1. kat");
  await setField(session, "placement-floor", "2");
  await until(
    async () =>
      (await snapshot()).nodes.find((node) => node.node_id === "pi-02")
        .floor === 2,
    "restored floor assignment",
  );
  pass(
    "Keyboard placement supports multiple Pis per floor and survives reload in shared server storage",
  );

  const malicious = '<img src=x onerror="window.__unsafe=1">';
  const unsafeRecords = bluetooth(1);
  unsafeRecords[1].SSID = malicious;
  await sendScan("pi-01", "bluetooth", unsafeRecords);
  await activeTab(session, "overview");
  await setField(session, "device-search", "onerror");
  await refresh();
  await untilPage(
    session,
    "document.querySelectorAll('#device-rows tr').length === 1",
    "literal reported name",
  );
  assert.match(await text(session, "#device-rows"), /<img src=x onerror=/);
  await click(session, "#device-rows tr:first-child button");
  assert.equal(JSON.parse(await text(session, "#device-raw")).SSID, malicious);
  assert.equal(
    await evaluate(
      session,
      "Boolean(window.__unsafe || document.querySelector('#device-rows img') || document.querySelector('#device-drawer img'))",
    ),
    false,
  );
  await click(session, "#device-close");
  await setField(session, "device-search", "");
  await sendScan("pi-01", "bluetooth", bluetooth(1));
  await refresh();
  pass(
    "Reported names remain literal text in grouped rows and raw-record details",
  );

  blockedRadios.add("pi-03:wifi");
  await post("pi-03", {
    kind: "scan",
    radio: "wifi",
    status: "error",
    error: "Wi-Fi adapter unavailable",
    observed_at: new Date().toISOString(),
  });
  await refresh();
  await untilPage(
    session,
    "document.getElementById('summary-wifi').textContent === '7'",
    "partial Wi-Fi count",
  );
  assert.equal(await text(session, "#summary-bluetooth"), "4");
  assert.match(await text(session, "#environment-message"), /3\. kat/);
  assert.match(await text(session, "#environment-message"), /Wi-Fi/);
  assert.match(await text(session, "#coverage-value"), /2\s*\/\s*3/);
  assert.equal(
    (await snapshot()).nodes.find((node) => node.node_id === "pi-03").online,
    true,
  );
  await setField(session, "device-status", "unknown");
  assert.equal(await rowCount(session), 3);
  await setField(session, "device-status", "all");
  await activeTab(session, "sensors");
  assert.match(
    await text(session, '#nodes tr[data-node-id="pi-03"]'),
    /Wi-Fi adapter unavailable/,
  );
  pass(
    "A live heartbeat does not hide a radio error or invent observations on the affected floor",
  );

  await sendScan("pi-03", "wifi", wifi(3));
  blockedRadios.add("pi-03:wifi");
  await activeTab(session, "overview");
  await refresh();
  await until(
    async () =>
      (await snapshot()).nodes.find((node) => node.node_id === "pi-03").radios
        .wifi.freshness === "stale",
    "radio ages despite healthy heartbeat",
    36000,
  );
  await refresh();
  await untilPage(
    session,
    "document.getElementById('summary-wifi').textContent === '7'",
    "stale radio removed from current count",
  );
  assert.equal(
    (await snapshot()).nodes.find((node) => node.node_id === "pi-03").online,
    true,
  );
  assert.match(await text(session, "#coverage-value"), /2\s*\/\s*3/);
  assert.match(await text(session, "#environment-message"), /güncel değil/);
  await sendScan("pi-03", "wifi", wifi(3));
  await sendScan("pi-03", "wifi", []);
  await refresh();
  await untilPage(
    session,
    "document.getElementById('summary-wifi').textContent === '10'",
    "grace period counts",
  );
  await setField(session, "device-status", "recent");
  assert.equal(await rowCount(session), 3);
  await setField(session, "device-status", "all");
  await sendScan("pi-03", "wifi", wifi(3));
  pass(
    "Stale radios stay distinct from live sensors; brief absences use a labeled 60-second grace period",
  );

  paused.add("pi-03");
  await until(
    async () =>
      !(await snapshot()).nodes.find((node) => node.node_id === "pi-03").online,
    "offline Pi",
    10000,
  );
  await refresh();
  await untilPage(
    session,
    "document.getElementById('summary-wifi').textContent === '7' && document.getElementById('summary-bluetooth').textContent === '3'",
    "offline sensor count exclusion",
  );
  assert.match(await text(session, "#coverage-value"), /2\s*\/\s*3/);
  paused.delete("pi-03");
  await untilPage(
    session,
    "document.getElementById('summary-wifi').textContent === '10' && document.getElementById('summary-bluetooth').textContent === '4'",
    "reconnected Pi readings",
  );
  pass(
    "Offline sensors affect only their observations and recover independently",
  );

  await setField(session, "device-search", "Ofis Ağı");
  await click(session, "#device-rows tr:first-child button");
  await click(session, '#device-sources [data-source-id*="pi-01"]');
  const linesBeforeOutage = await evaluate(
    session,
    "document.querySelectorAll('#device-history-chart .chart-line').length",
  );
  assert.ok(linesBeforeOutage > 0);
  await click(session, "#device-close");
  await setField(session, "device-search", "");
  await cdp(
    "Network.emulateNetworkConditions",
    { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
    session,
  );
  await refresh();
  await untilPage(
    session,
    "!document.getElementById('connection-banner').hidden",
    "server connection failure",
  );
  assert.equal(await text(session, "#summary-wifi"), "—");
  assert.equal(await text(session, "#summary-bluetooth"), "—");
  assert.equal(await rowCount(session), 14);
  await setField(session, "device-status", "unknown");
  assert.equal(await rowCount(session), 14);
  await setField(session, "device-status", "all");
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
  await refresh();
  await untilPage(
    session,
    "document.getElementById('connection-banner').hidden && document.getElementById('summary-wifi').textContent === '10'",
    "server reconnect",
  );
  await setField(session, "device-search", "Ofis Ağı");
  await click(session, "#device-rows tr:first-child button");
  await click(session, '#device-sources [data-source-id*="pi-01"]');
  await untilPage(
    session,
    `document.querySelectorAll('#device-history-chart .chart-line').length > ${linesBeforeOutage}`,
    "signal history gap across server outage",
  );
  await click(session, "#device-close");
  await setField(session, "device-search", "");
  pass(
    "Server loss preserves labeled history with a chart gap while totals become unknown, then recovers",
  );

  const many = Array.from({ length: 105 }, (_, index) =>
    record({
      SSID: `Test ağı ${String(index + 1).padStart(3, "0")}`,
      MAC: `02:D0:00:00:00:${(index + 1).toString(16).padStart(2, "0").toUpperCase()}`,
      RSSI: -40 - (index % 50),
      Frequency: 2412,
      Channel: 1,
      AuthMode: "[WPA2-PSK-CCMP][ESS]",
    }),
  );
  await sendScan("pi-01", "wifi", [...wifi(1), ...many]);
  await refresh();
  await untilPage(
    session,
    "document.getElementById('summary-wifi').textContent === '115'",
    "large device set",
  );
  assert.equal(await rowCount(session), 50);
  assert.equal(
    await evaluate(session, "document.getElementById('device-more').hidden"),
    false,
  );
  await click(session, "#device-more");
  assert.equal(await rowCount(session), 100);
  await click(session, "#device-more");
  assert.equal(await rowCount(session), 119);
  assert.equal(
    await evaluate(session, "document.getElementById('device-more').hidden"),
    true,
  );
  await activeTab(session, "devices");
  await setField(session, "device-search", "Test ağı");
  assert.equal(await text(session, "#device-count"), "105");
  assert.equal(await text(session, "#summary-wifi"), "115");
  assert.equal(await text(session, "#summary-bluetooth"), "4");
  pass(
    "Large scans render 50 rows at a time and preserve global metrics when the full device list is filtered",
  );

  await activeTab(session, "overview");
  await setField(session, "device-search", "Ofis Ağı");
  await click(session, "#device-rows tr:first-child button");
  await click(session, '#device-sources [data-source-id*="pi-01"]');
  assert.ok(
    await evaluate(
      session,
      "document.querySelectorAll('#device-history-chart .chart-point').length > 1",
    ),
  );
  await click(session, "#device-close");
  paused.add("pi-01");
  await until(
    () => !fixtureBusy,
    "fixture reports settle before scanner mode switch",
  );
  await post("pi-01", {
    scanner: "real",
    kind: "heartbeat",
    enabled_radios: ["wifi", "bluetooth"],
    expected_cycle_seconds: { wifi: 2, bluetooth: 2 },
  });
  await refresh();
  await untilPage(
    session,
    "document.getElementById('summary-wifi').textContent === '7'",
    "demo records cleared on real-mode heartbeat",
  );
  assert.match(await text(session, "#demo-banner"), /KARMA/);
  await post("pi-01", {
    scanner: "real",
    kind: "scan",
    radio: "wifi",
    status: "success",
    observed_at: new Date().toISOString(),
    observations: [record({ ...wifi(1)[0], RSSI: -22 })],
  });
  await refresh();
  await click(session, "#device-rows tr:first-child button");
  await untilPage(
    session,
    "!!document.querySelector('#device-sources [data-source-id*=\"pi-01\"]')",
    "new real source",
  );
  await click(session, '#device-sources [data-source-id*="pi-01"]');
  assert.equal(
    await evaluate(
      session,
      "document.querySelectorAll('#device-history-chart .chart-point').length",
    ),
    1,
  );
  assert.equal(JSON.parse(await text(session, "#device-raw")).RSSI, -22);
  assert.doesNotMatch(
    await text(session, '#device-sources [data-source-id*="pi-01"]'),
    /Demo/,
  );
  await click(session, "#device-close");
  pass(
    "Switching a Pi from demo to real clears its old records and signal history before new measurements",
  );

  assert.deepEqual(runtimeErrors, []);
  assert.equal(
    browserRequests.some(
      (url) => /^https?:/.test(url) && !url.startsWith(base),
    ),
    false,
  );
  assert.equal(fixtureFailure, undefined);
  console.log(
    `\n${checks.length} browser checks passed. Screenshots: /tmp/device-scanner-oneshot-{overview,dark,drawer,sensors,analysis}.png`,
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
