import { createServer } from 'vite';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { atlas, documents, readData, writeData, allGraphs, renderExpected } from './atlas.mjs';
import { validateReceipt } from './contracts.mjs';
const nonce = randomBytes(24).toString('hex');
const verificationMiddleware = async (req, res, next) => {
  if (!req.url?.startsWith('/__atlas/')) return next();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, body) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  // 无任意路径参数，无跨源授权。普通dev/build不会注册此维护接口。
  if (req.method === 'GET' && req.url === '/__atlas/manifest')
    return reply(200, {
      nonce,
      ...renderExpected(),
      graphs: allGraphs(documents(), readData('import-graph').edges),
    });
  if (req.method !== 'POST' || req.url !== '/__atlas/receipt')
    return reply(404, { error: 'fixed-endpoints-only' });
  if (
    req.headers.origin !== 'http://127.0.0.1:4174' ||
    req.headers['x-atlas-nonce'] !== nonce ||
    !req.headers['content-type']?.startsWith('application/json')
  )
    return reply(403, { error: 'local-verification-required' });
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('receipt-too-large');
    }
    const input = JSON.parse(raw);
    const expected = renderExpected();
    const errors = validateReceipt(input, expected);
    if (errors.length) return reply(422, { errors });
    const receipt = {
      ...expected,
      observations: input.observations.map((o) => ({
        id: o.id,
        svgBytes: o.svgBytes,
        width: o.width,
        height: o.height,
        missingLabels: o.missingLabels,
      })),
      browser: String(input.browser).slice(0, 500),
      viewport: input.viewport,
      theme: input.theme,
      observedAt: input.observedAt,
      checks: { htmlSanitization: input.checks?.htmlSanitization === true },
    };
    if (!receipt.checks.htmlSanitization)
      return reply(422, { error: 'sanitization-check-required' });
    mkdirSync(resolve(atlas, '.build'), { recursive: true });
    writeFileSync(
      resolve(atlas, '.build/render-receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
    writeData('render-receipt', receipt);
    reply(200, {
      status: 'recorded',
      diagrams: receipt.diagrams.length,
      outputs: ['.build/render-receipt.json', 'data/render-receipt.json'],
    });
  } catch (e) {
    reply(400, { error: e.message });
  }
};
// 在Vite的HTML fallback之前注册固定维护端点，避免JSON请求被当成首页。
const server = await createServer({
  root: atlas,
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  plugins: [
    {
      name: 'atlas-local-verification',
      configureServer(server) {
        server.middlewares.use(verificationMiddleware);
      },
    },
  ],
});
await server.listen();
console.log('Explicit render verification: http://127.0.0.1:4174/?verify=1');
