// Complete on-wire records for frontend unit and browser checks.
export function record(fields = {}) {
  return {
    MAC: "02:00:00:00:00:01",
    SSID: "",
    AuthMode: "",
    FirstSeen: "2026-10-04 10:00:00",
    Channel: "",
    Frequency: "",
    RSSI: "",
    CurrentLatitude: "",
    CurrentLongitude: "",
    AltitudeMeters: "",
    AccuracyMeters: "",
    RCOIs: "",
    MfgrId: "",
    Type: "WIFI",
    ...fields,
  };
}
