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
`observed_at` separately records the latest scan time.

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
`status: "error"` and `error: "..."`, without observations. Heartbeats retain
their `node_id`, `scanner`, and `kind: "heartbeat"` envelope.

Old `{path, properties}` observation records are rejected. Update and restart
the server and every node together, then reload the dashboard. The application
has no persisted records to migrate.

## Where real measurements come from

Wi-Fi discovery still uses NetworkManager. Its `Strength` property is a
percentage, so it cannot supply an actual dBm reading. After a scan completes,
the scanner reads `iw dev INTERFACE scan dump` and matches measured dBm by
address and frequency. This reads the kernel scan cache without requesting
another scan or changing connectivity. Install `iw` on real scanner Pis; if it
is missing, access is denied, or the driver only reports signal quality, `RSSI`
stays blank and the dashboard displays **Unknown**. Scan permissions depend on
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
data. The inspector labels these as dummy data and sample coordinates. Each
dummy Pi still reports one Wi-Fi network and one BLE device.

Dummy measurements change on each scan: RSSI has gradual random drift, small
jitter and an 8% chance of a temporary 8–18 dB fade. Readings are limited to
−100 through −25 dBm. Location accuracy varies by up to 0.5 meters around its
sample value. Each Pi/radio maintains its own signal drift. Device addresses,
names, channels, coordinates and `FirstSeen` stay stable so the dashboard can
track the same observations over time. Restart dummy nodes to use these changes.

## Saving files from the dashboard

**Export → CSV** saves a local file using the `WigleWifi-1.6` metadata line,
the exact fourteen-column header, and the visible records in displayed order.
It uses UTF-8, CRLF row endings and RFC4180 quoting. Names and measurements are
preserved exactly, including negative RSSI values and formula-like names;
this is an interchange file, not a spreadsheet-sanitized report.

CSV has no extra Pi, filter or status columns. **Export → JSON** includes that
context outside each unmodified WiGLE `record`, including retained/offline
status. Both formats can include previous results if those are visible.
Nothing is uploaded to WiGLE. Location-free and synthetic records are useful
for this application; generating a CSV does not establish upload eligibility.
