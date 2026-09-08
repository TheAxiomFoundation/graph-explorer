# Native Axiom execution for the Mars example

The site displays **recorded native Axiom results** for two fixed Horizons epochs.
The application does not divide the range in JavaScript or run a second physics
model. `mars-axiom.rulespec.yaml` contains the actual formulas:

- `fixed_position_one_way_seconds = range_km / speed_of_light_km_per_second`
- `fixed_position_one_way_minutes = fixed_position_one_way_seconds / 60`

The exact constant is `299792.458` km/s. Input ranges retain the decimal digits
returned by Horizons; converting their scientific notation into decimal strings
changes notation only. Seconds and minutes come verbatim from the native engine's
decimal outputs. These are geometric, fixed-position range/c estimates. They do
not solve an outbound interception trajectory, include network delay, or predict
when a message will arrive at moving Mars.

The `zz:policies/orrery/mars-light-time` identifier is a demonstration namespace.
The current compiler requires one of its supported path prefixes; `policies`
here does not describe a law or claim legal authority. The native module declares
custom units for `s`, `min`, and `km/s`. Those labels do not establish dimensional
soundness. Native requests use the engine's custom `Day` period with equal start
and end dates for each midnight UTC source epoch.

## Reproduce the computation

Use a separate checkout of the public
[axiom-core source at `8ac3a54f60fa3737166ff0c986d9660f34a25435`](https://github.com/TheAxiomFoundation/axiom-core/tree/8ac3a54f60fa3737166ff0c986d9660f34a25435).
Its locked dependency is the real Rust
[axiom-rules-engine at `d142c645917817cf590e036fb99f99b2d4780e1a`](https://github.com/TheAxiomFoundation/axiom-rules-engine/tree/d142c645917817cf590e036fb99f99b2d4780e1a),
version `0.2.2`, artifact format `2`. Build that exact checkout with its lockfile:

```sh
cargo build --locked --manifest-path /path/to/axiom-core/Cargo.toml
```

From the Orrery source checkout, run the capture script with the executable path
supplied explicitly by the operator:

```sh
python3 examples/mars-axiom-capture.py \
  --engine /path/to/axiom-core/target/debug/axiom-core \
  --artifacts examples/mars-axiom-replay-artifacts \
  --record examples/mars-axiom-replay.json
bun test tests/mars-axiom.test.ts
```

Use fresh output paths: the script refuses to replace existing captures. It
checks the input capture hashes, compiles the explicit one-module closure,
verifies the bundle through Axiom's rebuild path, and executes both real ranges
in explain mode. It retains the full native requests and responses. A newly
built executable changes the host hash and development-bundle identity; the
script rebuilds a bundle for that executable rather than weakening verification
of the original bundle. No engine repository is modified by the script.

The recorded execution was built from an isolated archive of the public source,
using `cargo build --locked --offline` and existing cached dependencies. The
local binary hash and locked dependency identity are retained in
`mars-axiom-run.json`. The binary itself is not included in the website.

## Published evidence

`mars-axiom-run.json` defines the explicit artifact allowlist. Its entries contain
repo-relative source paths, SHA-256, byte lengths, extensions, media types and
roles. The site copies exactly those bytes to
`artifacts/mars/<sha256>.<extension>` for inspection. The ten distinct artifacts
cover the authored RuleSpec, build request, capabilities, native compile/verify
result, development bundle, compiled artifact, and both requests and full native
execution records. Compile and verify return byte-identical identity records,
so they share one content-addressed artifact.

These are unsigned local execution records. The Axiom wrapper calls its native
record format an execution receipt; that does not supply a verified Receipt
custody assessment. No author, agent, signature, independent timestamp, or
scientific-correctness claim is invented. The graph keeps those distinctions.
