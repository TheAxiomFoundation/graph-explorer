#!/usr/bin/env python3
"""Capture public Horizons bytes for fixed epochs; this does not evaluate Axiom."""

import csv
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "mars-signal-artifacts"
EPOCHS = ("2026-09-08", "2025-01-16")
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
PARAMETERS = {
    "format": "json", "COMMAND": "'499'", "CENTER": "'500@399'",
    "MAKE_EPHEM": "'YES'", "OBJ_DATA": "'YES'", "EPHEM_TYPE": "'VECTORS'",
    "TLIST_TYPE": "'CAL'", "TIME_TYPE": "'UT'", "REF_SYSTEM": "'ICRF'",
    "REF_PLANE": "'FRAME'", "OUT_UNITS": "'KM-S'", "VEC_CORR": "'NONE'",
    "VEC_TABLE": "'3'", "CSV_FORMAT": "'YES'", "VEC_LABELS": "'YES'",
    "VEC_DELTA_T": "'YES'", "CAL_TYPE": "'GREGORIAN'", "TIME_DIGITS": "'FRACSEC'",
}


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def capture(url, extension, media_type):
    started = utc_now()
    with urlopen(Request(url, headers={"User-Agent": "Orrery-public-Mars-example/1"}), timeout=45) as response:
        body = response.read()
        assert response.status == 200
        headers = {key: response.headers.get(key) for key in ("Date", "Content-Type", "Last-Modified") if response.headers.get(key)}
    ended = utc_now()
    digest = hashlib.sha256(body).hexdigest()
    filename = f"{digest}.{extension}"
    ARTIFACTS.mkdir(exist_ok=True)
    (ARTIFACTS / filename).write_bytes(body)
    return body, {
        "sha256": digest, "byteLength": len(body), "file": f"mars-signal-artifacts/{filename}",
        "mediaType": media_type, "url": url, "retrievalStartedAt": started,
        "retrievedAt": ended, "httpStatus": 200, "responseHeaders": headers,
        "timestampScope": "Local retrieval clock; no signed timestamp or independent custody attestation",
    }


def parse_horizons(body):
    response = json.loads(body)
    assert "error" not in response, response.get("error")
    text = response["result"]
    for expected in ("Target body name: Mars (499)", "Center body name: Earth (399)",
                     "Center-site name: BODY CENTER", "Output units    : KM-S",
                     "Output type     : GEOMETRIC cartesian states", "Reference frame : ICRF",
                     "Geometric state vectors have NO corrections or aberrations applied."):
        assert expected in text, expected
    rows = list(csv.reader(text.split("$$SOE\n", 1)[1].split("$$EOE", 1)[0].strip().splitlines()))
    assert len(rows) == 1
    values = [value.strip() for value in rows[0]]
    assert len(values) == 13 and values[-1] == "", values
    names = ("julianDayUT", "calendarDateUT", "tdbMinusUTSeconds", "xKm", "yKm", "zKm",
             "vxKmPerSecond", "vyKmPerSecond", "vzKmPerSecond", "horizonsLTSeconds", "rangeKm", "rangeRateKmPerSecond")
    return {
        "signature": response["signature"], "values": dict(zip(names, values[:-1])),
        "targetEphemeris": re.search(r"Target body name:.*?\{source: ([^}]+)\}", text).group(1),
        "centerEphemeris": re.search(r"Center body name:.*?\{source: ([^}]+)\}", text).group(1),
        "eopFile": re.search(r"EOP file\s*:\s*(\S+)", text).group(1),
    }


def main():
    records = []
    for epoch in EPOCHS:
        parameters = {**PARAMETERS, "TLIST": f"'{epoch} 00:00:00'"}
        body, artifact = capture(f"{API}?{urlencode(parameters)}", "json", "application/json")
        parsed = parse_horizons(body)
        assert datetime.strptime(parsed["values"]["calendarDateUT"], "A.D. %Y-%b-%d %H:%M:%S.%f").strftime("%Y-%m-%d") == epoch
        records.append({"epoch": f"{epoch}T00:00:00Z", "parameters": parameters, "capture": artifact, **parsed})
    # Preserve HTML bytes as plain text: a source capture is never an executable
    # same-origin page, including any scripts the upstream page happens to carry.
    body, constant_artifact = capture("https://physics.nist.gov/cgi-bin/cuu/Value?c", "txt", "text/plain")
    # The original NIST page is preserved. These checks guard the selected value,
    # not its custody or the astronomy: c is exact in the SI definition.
    constant_text = html.unescape(re.sub(r"<[^>]+>", " ", body.decode()))
    assert re.search(r"299\s+792\s+458", constant_text)
    assert "exact" in constant_text.lower()
    result = {
        "schemaVersion": "orrery-mars-signal-source/v1",
        "retrievalMethod": "HTTPS GET from documented public JPL Horizons API and NIST constant page",
        "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "timeScale": "Horizons UT; these post-1962 epochs are UTC. Internal ephemeris scale is TDB; delta-T is retained.",
        "geometry": "Mars center499 relative to Earth center399 at the same epoch; ICRF equatorial axes; km and seconds; no light-time or stellar-aberration corrections",
        "snapshots": records,
        "speedOfLight": {"metersPerSecond": "299792458", "kilometersPerSecond": "299792.458", "exact": True, "capture": constant_artifact},
    }
    destination = HERE / "mars-signal-horizons.json"
    destination.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": str(destination), "snapshots": [{"epoch": r["epoch"], "rangeKm": r["values"]["rangeKm"], "sha256": r["capture"]["sha256"]} for r in records]}))


if __name__ == "__main__":
    main()
