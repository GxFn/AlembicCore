import { renderSvg } from './renderer.ts';
import { mermaidSource } from './graph-model.ts';
import { renderMarkdown } from './content.ts';
import type { Graph } from '../schemas/model.ts';
interface Manifest {
  nonce: string;
  renderer: string;
  configDigest: string;
  harnessDigest: string;
  diagrams: Array<{ id: string; digest: string }>;
  graphs: Graph[];
}
async function digest(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
export async function startVerification(app: HTMLElement) {
  app.innerHTML =
    '<main style="max-width:1100px"><div class="eyebrow">EXPLICIT LOCAL VERIFICATION</div><h1>图形渲染验证</h1><p>此操作使用阅读器同一渲染器，逐图验证实际 SVG、边界与文字。仅将回执写入本 Atlas 的固定 .build/ 与 data/ 路径。不会运行产品测试。</p><button id="verify-start">开始实际渲染并保存回执</button><p id="verify-progress" role="status">等待显式开始</p><div id="verify-stage"></div><pre id="verify-result"></pre></main>';
  const progress = app.querySelector('#verify-progress')!,
    result = app.querySelector('#verify-result')!,
    stage = app.querySelector<HTMLElement>('#verify-stage')!,
    button = app.querySelector<HTMLButtonElement>('#verify-start')!;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await fetch('/__atlas/manifest');
      if (!response.ok) throw new Error('请使用 npm run render:verify 启动专用本地验证服务');
      const manifest = (await response.json()) as Manifest;
      const observations = [];
      const sanitized = renderMarkdown(
        '<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">链接</a>',
      );
      if (/onerror|javascript:|<script/i.test(sanitized)) throw new Error('unsafe-markdown');
      for (const [i, g] of manifest.graphs.entries()) {
        progress.textContent = `${i + 1} / ${manifest.graphs.length} · ${g.title}`;
        stage.replaceChildren();
        const expected = manifest.diagrams.find((d) => d.id === g.id);
        if ((await digest(mermaidSource(g))) !== expected?.digest)
          throw new Error(`browser-source-mismatch:${g.id}`);
        const observed = await renderSvg(g, stage);
        if (
          observed.width <= 0 ||
          observed.height <= 0 ||
          observed.svgBytes < 100 ||
          observed.missingLabels.length
        )
          throw new Error(`invalid-svg:${g.id}:${observed.missingLabels.join(',')}`);
        observations.push(observed);
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      const receipt = {
        renderer: manifest.renderer,
        configDigest: manifest.configDigest,
        harnessDigest: manifest.harnessDigest,
        diagrams: manifest.diagrams,
        observations,
        browser: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight },
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        observedAt: new Date().toISOString(),
        checks: { htmlSanitization: true },
      };
      const saved = await fetch('/__atlas/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Atlas-Nonce': manifest.nonce },
        body: JSON.stringify(receipt),
      });
      const output = await saved.json();
      if (!saved.ok) throw new Error(JSON.stringify(output));
      progress.textContent = `已实际渲染 ${observations.length} 图；固定路径回执已保存。`;
      result.textContent = JSON.stringify(output, null, 2);
      result.setAttribute('data-complete', 'true');
    } catch (e) {
      progress.textContent = '验证失败，未生成通过回执';
      result.textContent = e instanceof Error ? e.message : String(e);
      result.setAttribute('data-failed', 'true');
      button.disabled = false;
    }
  });
}
