export { GraphExplorer, type GraphExplorerProps, type GraphLocationChange, type GraphInspectorContext, type GraphHostContext, type GraphNodeRenderContext, type GraphExportOptions, type GraphExportRequest } from './GraphExplorer.js';
export type { CanvasOptions } from './canvas.js';
export type { GraphDocument, GraphLocation, ReceiptAssessment } from '../core/types.js';

// Orrery is the product name; GraphExplorer remains a compatible public API.
export { GraphExplorer as Orrery, type GraphExplorerProps as OrreryProps } from './GraphExplorer.js';
