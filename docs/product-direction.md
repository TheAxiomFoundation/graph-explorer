# Orrery: product direction for discussion

This note captures the product discussion as of September 9, 2026. The proposed
priorities below are for review; they are not implemented capabilities or an
approved roadmap.

## Purpose

Orrery helps someone open a complicated connected system and understand something
they could not understand before: how a result was constructed, what depends on
it, and where its evidence and contributions came from.

The graph is the core model. Its nodes let a large problem be divided into pieces
that people and agents can build independently; its typed relationships connect
those pieces into a system. The diagram makes that structure visible. Inspection,
search and comparison offer other ways to understand the same graph.

Orrery's near-term role is a shared graph viewer with sources, contributions and
Receipt support. Axiom, Microcosm, PlanGraph and Thesis retain their domain models,
execution, adapters and application workflows. PlanGraph keeps its name.

## What is available to review

| Surface | Review entry point |
| --- | --- |
| Live homepage | [Mars signal demo](https://theaxiomfoundation.github.io/orrery/?example=mars): recorded JPL inputs, real native Axiom calculation, two dates and source downloads |
| Shared viewer foundation | [PR #1](https://github.com/TheAxiomFoundation/orrery/pull/1), merged: portable graph contract, navigation, inspection, activity and Receipt support |
| Orrery launch and forecast walkthrough | [PR #3](https://github.com/TheAxiomFoundation/orrery/pull/3), merged: public site, naming and recorded Thesis example |
| Homepage example | [PR #5](https://github.com/TheAxiomFoundation/orrery/pull/5), merged: approachable Mars question and traceable calculation |
| Search improvement | [PR #4](https://github.com/TheAxiomFoundation/orrery/pull/4), open at this note's date: direct record matches ranked ahead of payload mentions |
| Installable preview | [v0.5.0-preview.1 release](https://github.com/TheAxiomFoundation/orrery/releases/tag/v0.5.0-preview.1); distributed as a GitHub tarball, with [installation instructions](migration.md) |
| Embedding and contract | [React host API](react-hosts.md) and [portable types](../src/core/types.ts) |

The delivered viewer supports directed neighborhoods, search and type filters,
containment collapse, readable focus, node and edge inspection, activity and
source records, baseline comparison, host projections, and offline HTML export.
Application owners decide when to adopt a package and publish their own UI; shared
package acceptance does not imply a host's deployment or default-viewer switch.

Related host reviews, also open at this note's date:

- [Microcosm exporter #888](https://github.com/PolicyEngine/microcosm/pull/888)
  supplies the Microcosm-to-Orrery projection.
- [Microcosm source consolidation #893](https://github.com/PolicyEngine/microcosm/pull/893)
  is a draft bringing the US graph build and enrichment pipeline together; its
  review guide separates component checks from outstanding release work.
- [Microcosm methods and site #72](https://github.com/PolicyEngine/microcosm.institute/pull/72)
  is the accompanying draft documentation review.

These are source review links, not claims of a completed data release or a
deployed host integration.

## Proposed next priorities

### Follow an explanation through the graph

Make it easy to start at a result and follow the relevant input, calculation and
evidence paths without repeatedly searching or losing the surrounding context.
Use the exact relationship meanings supplied by the host: a citation, an input
and a containing record should remain distinguishable.

A useful acceptance case: a visitor can trace the Mars answer to its captured JPL
input and actual Axiom execution, then use the same interaction to inspect a
Thesis forecast. This builds on current traversal and inspection; a guided,
readable path is the proposed improvement.

### Keep large graphs understandable

Explore meaningful groups, expandable subsystems, saved views and detail that
changes with zoom. Preserve a person's orientation as they move between a system
overview and an individual record. Keep the complete index searchable while
showing a manageable canvas.

A useful acceptance case: someone can move from a program or data pipeline to one
exact record and back, preserving selection and scope. Grouping and presentation
must preserve native identities, relationships and explicit export boundaries.

### Explain changes and contributions together

Build on snapshot comparison to show which inputs and outputs changed, which
relationships connect them, and what recorded agent work produced the revision.
A contribution view could bring its changed nodes, edges, sources, execution
records and checks together for review.

A useful acceptance case: compare two real revisions and follow a changed source
through its dependent records, while clearly separating recorded execution from
possible dependency effects. The domain engine must supply any claim that an
output was recomputed or is stale; graph reachability alone does not establish it.

## Boundaries to retain

- Show recorded sources and activity; do not invent missing evidence, agent
  signatures or hidden model reasoning.
- Keep Receipt integrity, freshness and approval distinct. A valid Receipt
  establishes its stated custody scope, not scientific or domain correctness.
- Keep calculations and execution in actual domain engines. A viewer may display
  a recorded trace without executing it.
- Preserve offline use, keyboard access, stable IDs and the host's data boundary.
  A filtered canvas is not a redacted export.

An agent query API, validated change proposals and collaborative approval could
be later extensions. They would broaden Orrery's responsibilities and need
separate design. The immediate test is whether the viewer helps people understand
their connected systems well enough to use it repeatedly.

## Questions for review

1. Which recurring task should drive the next release: tracing a result,
   navigating a large graph, or understanding a revision?
2. Which real host example would provide the strongest acceptance case?
3. Which behavior belongs in the shared viewer, and which should remain in its
   host application?
