import axiom from './fixtures/axiom-oasdi.json';
import thesis from './fixtures/thesis-source-replay.json';
import { fromAxiomProgramGraph } from '../src/adapters/axiom';
import { fromThesisRecords } from '../src/adapters/thesis';

export const axiomExample = fromAxiomProgramGraph(axiom.graph, {
  id: 'axiom-oasdi-recorded-graph',
  title: 'Axiom · recorded OASDI rule graph',
  revision: axiom.source.artifactSha256,
  provenance: axiom.source,
  sources: [{ label: 'Recorded Axiom graph projector', url: `${axiom.source.repository}/blob/${axiom.source.commit}/src/runtime-graph.ts` }],
});

export const thesisExample = fromThesisRecords(thesis.records, {
  id: 'thesis-native-source-replay',
  title: 'Thesis · native source fixture replay',
  provenance: thesis.source,
  sources: [{ label: 'Committed Thesis input fixture', url: `${thesis.source.repository}/blob/${thesis.source.commit}/${thesis.source.fixturePath}`, sha256: thesis.source.fixtureSha256 }],
});
