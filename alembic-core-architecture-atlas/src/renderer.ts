import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import type cytoscape from 'cytoscape';
import type { Graph } from '../schemas/model.ts';
import { mermaidSource } from './graph-model.ts';
import { renderConfig } from './render-config.ts';
mermaid.initialize(renderConfig);
let sequence = 0;
export interface RenderObservation {
  id: string;
  svgBytes: number;
  width: number;
  height: number;
  missingLabels: string[];
}
export async function renderSvg(graph: Graph, container: HTMLElement): Promise<RenderObservation> {
  const result = await mermaid.render(`atlas-${++sequence}`, mermaidSource(graph));
  container.innerHTML = DOMPurify.sanitize(result.svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_ATTR: ['aria-roledescription'],
  });
  const svg = container.querySelector('svg');
  if (!svg) throw new Error(`empty-svg:${graph.id}`);
  const view = svg.viewBox.baseVal;
  const text = (svg.textContent ?? '').replace(/\s/g, '');
  const missingLabels = [
    ...graph.nodes.map((n) => n.label),
    ...graph.edges.map((e) => e.label),
  ].filter((s) => !text.includes(s.replace(/\s/g, '')));
  return {
    id: graph.id,
    svgBytes: result.svg.length,
    width: view.width,
    height: view.height,
    missingLabels,
  };
}
const button = (label: string, fn: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
};
export async function mountDiagram(
  graph: Graph,
  host: HTMLElement,
  onEvidence: (id: string) => void,
): Promise<() => void> {
  let alive = true,
    cy: cytoscape.Core | undefined,
    zoom = 1;
  const abort = new AbortController();
  const toolbar = document.createElement('div');
  toolbar.className = 'diagram-toolbar';
  const stage = document.createElement('div');
  stage.className = 'diagram-stage';
  const canvas = document.createElement('div');
  canvas.className = 'svg-canvas';
  stage.append(canvas);
  host.append(toolbar, stage);
  const observation = await renderSvg(graph, canvas);
  if (observation.missingLabels.length) throw new Error(`missing-labels:${graph.id}`);
  let mode: 'mermaid' | 'interactive' = 'mermaid';
  const setZoom = (scale: number) => {
    zoom = Math.max(0.15, Math.min(3, scale));
    if (cy) {
      cy.zoom(zoom);
      return;
    }
    canvas.style.width = `${observation.width * zoom}px`;
    canvas.style.height = `${observation.height * zoom}px`;
    const svg = canvas.querySelector('svg');
    if (svg) {
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.maxWidth = 'none';
    }
  };
  const fit = () => {
    if (cy) cy.fit(undefined, 32);
    else setZoom(Math.min(1, (stage.clientWidth - 32) / observation.width));
  };
  const read = () => {
    if (cy) {
      cy.zoom(1);
      cy.center();
    } else setZoom(1);
  };
  toolbar.append(
    button('阅读', read),
    button('全图', fit),
    button('−', () => setZoom((cy?.zoom() ?? zoom) / 1.2)),
    button('＋', () => setZoom((cy?.zoom() ?? zoom) * 1.2)),
    button('1:1', () => setZoom(1)),
    button('全屏', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void (host.closest('.graph-card') ?? host).requestFullscreen();
    }),
  );
  if (graph.viewType === 'F0') {
    const toggle = button('交互依赖图', async () => {
      if (mode === 'interactive') {
        cy?.destroy();
        cy = undefined;
        mode = 'mermaid';
        canvas.style.display = '';
        stage.querySelector('.cy-canvas')?.remove();
        toggle.textContent = '交互依赖图';
        fit();
        return;
      }
      toggle.disabled = true;
      toggle.textContent = '正在载入交互图…';
      let target: HTMLElement | undefined;
      try {
        const { createInteractive } = await import('./interactive-graph.ts');
        if (!alive || !host.isConnected) return;
        target = document.createElement('div');
        target.className = 'cy-canvas';
        stage.append(target);
        cy = createInteractive(graph, target, onEvidence);
        if (cy.nodes().length !== graph.nodes.length || cy.edges().length !== graph.edges.length)
          throw Error('projection-mismatch');
        target.dataset.nodeCount = String(cy.nodes().length);
        target.dataset.edgeCount = String(cy.edges().length);
        canvas.style.display = 'none';
        mode = 'interactive';
        toggle.textContent = 'Mermaid 文本图';
      } catch (error) {
        cy?.destroy();
        cy = undefined;
        target?.remove();
        if (!alive) return;
        const message = document.createElement('p');
        message.className = 'note warning';
        message.textContent = `交互图加载失败，保留完整Mermaid图：${error instanceof Error ? error.message : String(error)}`;
        host.append(message);
        toggle.textContent = '重试交互依赖图';
      } finally {
        if (alive) toggle.disabled = false;
      }
    });
    toolbar.append(toggle);
  }
  const counts = document.createElement('span');
  counts.className = 'graph-count';
  counts.textContent = `${graph.viewType} · ${graph.nodes.length} 节点 / ${graph.edges.length} 边`;
  toolbar.append(counts);
  graph.edges.forEach((e, i) => {
    const path = canvas.querySelector(`[id$="-e${i}"]`);
    if (path) {
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `证据：${e.label}`);
      path.addEventListener('click', () => onEvidence(e.id), { signal: abort.signal });
      path.addEventListener(
        'keydown',
        (event) => {
          if ((event as KeyboardEvent).key === 'Enter') onEvidence(e.id);
        },
        { signal: abort.signal },
      );
    }
  });
  // 普通阅读默认保持字形大小；超宽图可横向拖动，完整fit由读者显式选择。
  setZoom(1);
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (mode === 'interactive' || (e.target as Element).closest('button,[role="button"]')) return;
      drag = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
      stage.setPointerCapture(e.pointerId);
    },
    { signal: abort.signal },
  );
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (drag) {
        stage.scrollLeft = drag.left - e.clientX + drag.x;
        stage.scrollTop = drag.top - e.clientY + drag.y;
      }
    },
    { signal: abort.signal },
  );
  stage.addEventListener(
    'pointerup',
    () => {
      drag = null;
    },
    { signal: abort.signal },
  );
  const resize = new ResizeObserver(() => {
    if (alive) cy?.resize();
  });
  resize.observe(host);
  return () => {
    alive = false;
    abort.abort();
    resize.disconnect();
    cy?.destroy();
    host.replaceChildren();
  };
}
