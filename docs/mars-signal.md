# How long would a message take to reach Mars?

This example estimates **one-way light travel in vacuum** from Earth's center to
Mars's center using their separation at a fixed date. It uses real JPL Horizons
ephemeris responses and an actual Axiom arithmetic execution. It is a recorded
calculation, not a live feed or a measurement of a communications network.

The two snapshots use September 8, 2026 and January 16, 2025, both at 00:00 UTC.
They share stable `mars-signal/` record IDs so comparison shows the changed epoch,
distance and result. The comparison is between dates, not a correction to an old
JPL result or a claim that either snapshot was published on its modeled date.

| Modeled epoch, 00:00 UTC | Geometric separation | Native Axiom result | Display |
| --- | ---: | ---: | --- |
| September 8, 2026 | 270,899,051.8510656 km | 903.6219712073797400200107769 s | About 15 min 4 sec |
| January 16, 2025 | 96,279,709.60711069 km | 321.1545422103670466586587712 s | About 5 min 21 sec |

## What the estimate means

The calculation is `geometric_range_km / 299792.458`, giving seconds. The speed of
light is exactly 299,792,458 metres per second in the SI definition; kilometres
use the exact conversion of 1,000 metres. The [NIST constant page](https://physics.nist.gov/cgi-bin/cuu/Value?c)
is captured alongside the ephemeris responses.

This treats both planets as fixed at the same instant. It does not solve for
Mars's later position when an outgoing signal arrives. It omits motion during
transit, gravitational propagation corrections, surface-station positions,
atmospheric or plasma effects, relay routing, processing, scheduling and outages.
It is not a round trip: a reply adds another journey and any intervening delay.
The displayed answer rounds the executed result to the nearest second and says
“About”; additional stored digits make the arithmetic reproducible, not the
physical approximation more precise.

Horizons has other light-time products. In particular, observer-table quantity
21 is a **down-leg** light-time: light arriving at the observer from the target.
That reception quantity must not be relabeled as an Earth-to-Mars transmission.
This example requests geometric vectors with `VEC_CORR=NONE`. Its recorded vector
table includes `LT`; we check agreement with that column as an arithmetic and
unit consistency check, not as an independently solved outgoing-signal path.
See the [Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html).

## Exact source settings

The [documented Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) is
called once per fixed epoch with these explicit choices:

| Setting | Value and meaning |
| --- | --- |
| Target | `COMMAND='499'`: Mars center, not its system barycenter |
| Origin | `CENTER='500@399'`: Earth's body center, not a surface station |
| Product | `EPHEM_TYPE='VECTORS'`, `VEC_TABLE='3'` |
| Corrections | `VEC_CORR='NONE'`: same-epoch geometric states |
| Axes | `REF_SYSTEM='ICRF'`, `REF_PLANE='FRAME'`: equatorial ICRF axes |
| Units | `OUT_UNITS='KM-S'`: kilometres and seconds |
| Time | `TLIST` calendar epoch, `TIME_TYPE='UT'`; these post-1962 dates use UTC |
| Calendar | Proleptic Gregorian, fractional seconds printed |
| Conversion | `VEC_DELTA_T='YES'`: returned TDB minus UT retained |

The responses identify Mars ephemeris `mar099`, Earth's `DE441`, and the Earth
orientation file in use. Original Julian dates, position and velocity vectors,
range, range rate, light-time and time-scale offset remain in the record details.
The model epoch, the source's response-generation text, HTTP date and our local
retrieval times are distinct fields. Retrieval timestamps are local observations;
they are not signed timestamps or an independent custody proof.

## Source bytes and execution evidence

`examples/mars-signal-horizons.json` records request parameters, original numeric
strings, HTTP metadata and SHA-256 hashes. Raw public responses are preserved in
`examples/mars-signal-artifacts/`. The NIST HTML bytes are deliberately served as
plain text, so upstream page scripts cannot run as part of the example.

The published graph links captured artifacts at content-addressed URLs of the
form `artifacts/mars/<sha256>.<extension>`. A separate link reproduces each live
JPL query; a later request can return different bytes or updated ephemerides and
must not be mistaken for the captured artifact. The site copies only an explicit
hash-checked artifact allowlist. No graph action executes source content.

`examples/mars-axiom-run.json` records the actual native Axiom execution, including
the source module, compiled artifact, runtime version, exact inputs, outputs and
trace. The wrapper is [Axiom Core at `8ac3a54`](https://github.com/TheAxiomFoundation/axiom-core/tree/8ac3a54f60fa3737166ff0c986d9660f34a25435),
using [Axiom rules engine 0.2.2 at `d142c64`](https://github.com/TheAxiomFoundation/axiom-rules-engine/tree/d142c645917817cf590e036fb99f99b2d4780e1a).
The RuleSpec module is astronomy demonstration arithmetic; its `zz:policies/`
namespace is a compiler-compatible demonstration path, not a law encoding.
Check records compare those returned outputs with the captured Horizons
range and light-time, and check that the position-vector norm agrees with range.
These checks establish numerical consistency of the recorded calculation. They
do not independently verify JPL's astronomy or the physical omissions above.

No Receipt or trusted verification assessment is supplied. Activity records
describe the actual capture, calculation and check commands; they do not invent
an agent signature or imply that a graph can verify its own provenance.

## Reproduce

The source checkout contains the capture, native-runtime replay and check scripts.
`python3 examples/mars-signal-capture.py` explicitly makes fresh public requests
and updates the source manifest. It is not run when browsing or importing the
example. Keep the existing captures when reproducing an already-published
snapshot; reretrieval times and hashes will naturally differ.

Run the recorded-data tests without network requests:

```sh
bun test tests/mars-signal-source.test.ts tests/mars-signal.test.ts tests/mars-axiom.test.ts
```

`python3 examples/mars-signal-check.py` reruns local byte and numerical checks and
records a new check time and artifact allowlist. It does not invoke NASA or the
Axiom engine. To execute the actual compiled module again, use the pinned native
CLI with `examples/mars-axiom-capture.py`; its `--artifacts` and `--record` paths
must be new, preserving the original execution record. The separate capture
script describes and enforces the native build, verification and run steps.

`marsSignalExamples` in `examples/mars-signal.ts` provides the two validated
portable documents, date comparison, answer presentation and guided inspection
stops. Exported JSON and offline HTML preserve recorded data and source references.
Referenced artifact bodies remain separate downloads; an offline report does not
silently fetch them.
