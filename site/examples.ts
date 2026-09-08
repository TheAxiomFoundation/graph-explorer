import { axiomExample, thesisExample } from '../examples/adapter-examples';
import type { GraphDocument, GraphLocation } from '../src/core';
import { thesisWalkthrough, thesisWalkthroughBaseline, thesisWalkthroughLocation, thesisWalkthroughSteps, thesisWalkthroughDescription, thesisWalkthroughCaveat } from '../examples/thesis-walkthrough';

export interface Example {
  id: string;
  label: string;
  summary: string;
  document: GraphDocument;
  baseline?: GraphDocument;
  location: GraphLocation;
  caveat?: string;
  guide?: readonly { label: string; description: string; selectedId: string; focusId: string }[];
}

/** Only public native projections belong here; host applications own private data. */
export const examples: Example[] = [
  {
    id: 'thesis', label: 'Thesis · recorded forecast', document: thesisWalkthrough,
    baseline: thesisWalkthroughBaseline, location: { ...thesisWalkthroughLocation, focusId: thesisWalkthroughLocation.selectedId },
    summary: thesisWalkthroughDescription,
    caveat: `${thesisWalkthroughCaveat} Comparison shows the original-attempt subset of this same snapshot, not an earlier publication. Linked source artifacts require a connection.`,
    guide: thesisWalkthroughSteps,
  },
  {
    id: 'source', label: 'Thesis · source replay', document: thesisExample,
    summary: 'A recorded replay of a public Thesis test fixture. Native observations and source links; no live retrieval or forecast.',
    location: { selectedId: thesisExample.nodes[2].id, selectedType: 'node', focusId: thesisExample.nodes[2].id, depth: 1, direction: 'both' },
  },
  {
    id: 'axiom', label: 'Axiom · rule dependencies', document: axiomExample,
    summary: 'A recorded graph from an actual compiled Axiom OASDI artifact. Rule dependencies, inputs, and citations; no live evaluation.',
    location: { selectedId: axiomExample.nodes[0].id, selectedType: 'node', focusId: axiomExample.nodes[0].id, depth: 1, direction: 'both' },
  },
];
