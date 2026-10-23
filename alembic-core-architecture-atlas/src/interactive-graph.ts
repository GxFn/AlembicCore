import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import { elements } from './graph-model.ts';
import type { Graph } from '../schemas/model.ts';
cytoscape.use(elk);
export function createInteractive(
  graph: Graph,
  target: HTMLElement,
  onEvidence: (id: string) => void,
) {
  const cy = cytoscape({
    container: target,
    elements: elements(graph),
    layout: {
      name: 'elk',
      fit: false,
      nodeDimensionsIncludeLabels: true,
      elk: {
        algorithm: 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '50',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      },
    } as cytoscape.LayoutOptions,
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          shape: 'round-rectangle',
          'background-color': '#e1eff0',
          'border-color': '#35717a',
          'border-width': 1,
          width: 190,
          height: 52,
          'text-wrap': 'wrap',
          'text-overflow-wrap': 'anywhere',
          'text-max-width': '180px',
          'font-size': 12,
          'text-valign': 'center',
          'text-halign': 'center',
          color: '#173843',
        },
      },
      {
        selector: 'edge',
        style: {
          label: 'data(label)',
          'font-size': 10,
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'line-color': '#8da5ad',
          'target-arrow-color': '#8da5ad',
        },
      },
    ],
  });
  cy.on('tap', 'edge', (event) => onEvidence(event.target.id()));
  cy.one('layoutstop', () => {
    if (cy.destroyed()) return;
    cy.zoom(1);
    cy.pan({ x: 24, y: 24 });
  });

  return cy;
}
