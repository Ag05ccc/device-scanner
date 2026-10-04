# Shared WiGLE data format

Every dummy and real Pi returns the same **WiGLE v1.6** observation fields.
The server validates these records, stores them unchanged, and serves them to
the dashboard. The reference is [WiGLE's CSV specification](https://api.wigle.net/csvFormat.html).
The Python schema and hardware adapters live in `device_scanner/wigle.py`.

## Observation fields

All fourteen keys must be present. Unavailable measurements use `""` (an empty
CSV cell), not zero, `null`, or an estimate. Numbers are JSON numbers; names,
addresses, capabilities, timestamps, RCOIs and Type are strings.

| Field | Wi-Fi | Bluetooth |
| --- | --- | --- |
| `MAC` | Access point BSSID | Device address |
| `SSID` | Network name; blank for hidden SSID | Published device name, if available |
| `AuthMode` | Capabilities such as `[WPA2-PSK-CCMP][ESS]` | Device description and `[BT]` or `[BLE]` |
| `FirstSeen` | First discovery, UTC `YYYY-MM-DD hh:mm:ss` | Same |
| `Channel` | Integer Wi-Fi channel | Always `0` |
| `Frequency` | Integer MHz | Bluetooth device-class code, **not MHz** |
| `RSSI` | Measured signal in dBm | Measured signal in dBm |
| `CurrentLatitude` | Latitude in decimal degrees | Same |
| `CurrentLongitude` | Longitude in decimal degrees | Same |
| `AltitudeMeters` | Integer altitude in meters | Same |
| `AccuracyMeters` | Location accuracy in meters | Same |
| `RCOIs` | Space-separated hexadecimal roaming consortium IDs, if available | Blank |
| `MfgrId` | Blank | Integer manufacturer ID, if available |
| `Type` | `WIFI` | `BT` or `BLE` |

`FirstSeen` stays the same when the same Pi sees the same device again. It is
tracked in the node process and resets after a node restart. The report's
`observed_at` separately records that scan's time. The device view also has
server-session discovery/last-sighting metadata; that metadata is outside these
fourteen fields and does not rewrite `FirstSeen`.

## Reports between a Pi and the server

HTTP still carries JSON. The fields inside each observation match WiGLE's CSV
columns. The surrounding report identifies the Pi, radio, and scan status:

```json
{
  "node_id": "pi-01",
  "scanner": "real",
  "kind": "scan",
  "radio": "wifi",
  "status": "success",
  "observed_at": "2026-10-04T10:00:00Z",
  "observations": [
    {
      "MAC": "02:AA:BB:CC:DD:01",
      "SSID": "Office",
      "AuthMode": "[WPA2-PSK-CCMP][ESS]",
      "FirstSeen": "2026-10-04 09:59:30",
      "Channel": 6,
      "Frequency": 2437,
      "RSSI": -53,
      "CurrentLatitude": "",
      "CurrentLongitude": "",
      "AltitudeMeters": "",
      "AccuracyMeters": "",
      "RCOIs": "",
      "MfgrId": "",
      "Type": "WIFI"
    }
  ]
}
```

Bluetooth uses `radio: "bluetooth"` and the same fourteen observation keys.
A successful empty scan sends `observations: []`. An error report sends
`status: "error"` and `error: "..."`, without observations. Heartbeats include
the enabled radio list and expected full scan cycles outside WiGLE records:

```json
{
  "node_id": "pi-01",
  "scanner": "real",
  "kind": "heartbeat",
  "enabled_radios": ["bluetooth", "wifi"],
  "expected_cycle_seconds": {"bluetooth": 15, "wifi": 15}
}
```

The expected cycle is the scan window plus interval. Metadata is optional for
older clients; a radio with no declaration or scan has unknown enablement. The
server exposes per-radio `last_success_at`, `success_age_seconds`, `last_error_at`
and freshness separately from the latest report time. An error retains the last
successful observations without making their measurements newer. Heartbeats
alone cannot keep radio observations fresh.

Old `{path, properties}` observation records are rejected. Update and restart
the server and every node together, then reload the dashboard. Scan records and
short-term history are in memory; floor assignments are persisted separately and
do not change the observation schema.

## Where real measurements come from

Wi-Fi discovery still uses NetworkManager. Its `Strength` property is a
percentage, so it cannot supply an actual dBm reading. After a scan completes,
the scanner reads `iw dev INTERFACE scan dump` and matches measured dBm by
address and frequency. This reads the kernel scan cache without requesting
another scan or changing connectivity. Install `iw` on real scanner Pis; if it
is missing, access is denied, or the driver only reports signal quality, `RSSI`
stays blank and the dashboard displays **Bilinmiyor**. Scan permissions depend on
the Pi's OS setup.

BlueZ supplies Bluetooth RSSI, device class and manufacturer data. The class
code excludes service/format bits. A single manufacturer ID is used when
unambiguous; multiple advertised IDs leave `MfgrId` blank. BlueZ's automatic
discovery combines transports: a random address or LE-specific properties
(`Appearance`, `AdvertisingFlags`, `AdvertisingData`) identify a record as
`BLE`; otherwise it is reported as `BT`. This is a best-effort classification
and does not reliably distinguish every public-address or dual-mode device.

There is no GPS provider yet. Real scanners leave all location fields blank,
and currently leave `RCOIs` blank. Dummy nodes generate synthetic coordinates
on a small grid near (0, 0), plus sample altitude, accuracy and manufacturer
data. The interface identifies demo measurements and sample coordinates. Each
dummy Pi initially reports eight Wi-Fi and twelve Bluetooth addresses (BT and
BLE), including three Wi-Fi and five Bluetooth addresses shared by all Pis.
Three Pis therefore initially represent eighteen Wi-Fi and twenty-six Bluetooth
addresses after deduplication. Scan seven adds one local address per radio;
scans twelve and thirteen of each twenty-four-scan cycle briefly omit one local
address. Profiles include open/hidden Wi-Fi networks and multiple Bluetooth kinds.

Dummy measurements change on each scan: RSSI has gradual random drift, small
jitter and an 8% chance of a temporary 8–18 dB fade. Readings are limited to
−100 through −25 dBm. Location accuracy varies by up to 0.5 meters around its
sample value. Each Pi/radio/address maintains its own signal drift. Device addresses,
names, channels, coordinates and `FirstSeen` stay stable so the dashboard can
track the same observations over time. Restart dummy nodes to use these changes.

## Saving files from the dashboard

**Analiz → Dışa aktar → WiGLE CSV kaydet** saves a local file using the
`WigleWifi-1.6` metadata line, the exact fourteen-column header, and the visible
source observations in displayed order. Several Pis hearing one address produce
several source rows, even though the device view counts that address once.
It uses UTF-8, CRLF row endings and RFC4180 quoting. Names and measurements are
preserved exactly, including negative RSSI values and formula-like names;
this is an interchange file, not a spreadsheet-sanitized report.

CSV has no extra Pi, floor, filter or status columns. **JSON kaydet** includes
source and filter context outside each unmodified WiGLE `record`, including retained/offline
status. Both formats can include previous results if those are visible.
Nothing is uploaded to WiGLE. Location-free and synthetic records are useful
for this application; generating a CSV does not establish upload eligibility.

Export timestamps describe different events:

- `record.FirstSeen` is the node-process discovery timestamp, unchanged from the
  source record.
- Each JSON row's `received_at` is the server's last **successful** receipt time
  for that observation, taken from the radio's `last_success_at`. This differs
  from the API radio's `received_at`, which dates the latest report, including errors.
- JSON `report_observed_at` is the node-reported scan time when the latest radio
  report succeeded. After an error it is `null`: the old successful node scan time
  is not separately retained, so the error report's timestamp is not substituted.
- Top-level `last_received_at` dates the browser's most recent API snapshot;
  `exported_at` dates file creation. `outdated` indicates loss of server connection,
  while each row's `state` separately indicates stale/error/offline data.

The server's fifteen-minute source history and ten-minute new-address window
use their own metadata. They reset on server restart and are not stored in
WiGLE CSV fields. Shared floor placement survives restart in its separate file.
Changing a Pi ID between dummy and real clears that Pi's old measurements and
source history; the discovery ledger separates scanner modes so a synthetic
sighting does not establish a real source's first-seen time.
