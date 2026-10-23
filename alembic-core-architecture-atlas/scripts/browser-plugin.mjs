import { resolve } from 'node:path';
import { readBrowserInputs, buildBrowserAssets, browserInputFiles } from './browser-assets.mjs';
export function shouldReloadBrowserData(root, path) {
  return Object.values(browserInputFiles).some(
    (name) => path === resolve(root, 'data', name + '.json'),
  );
}
export function browserDataPlugin(root) {
  const id = 'virtual:atlas-bootstrap',
    internal = '\0' + id;
  const build = () => buildBrowserAssets(readBrowserInputs(root));
  return {
    name: 'core-atlas-browser-data',
    resolveId(value) {
      if (value === id) return internal;
    },
    load(value) {
      if (value === internal) return 'export default ' + JSON.stringify(build().bootstrap) + ';';
    },
    generateBundle() {
      for (const [fileName, source] of build().assets)
        this.emitFile({ type: 'asset', fileName, source });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (!path?.startsWith('/atlas-data/')) return next();
        if (!['GET', 'HEAD'].includes(req.method ?? '')) {
          res.statusCode = 405;
          res.end();
          return;
        }
        const text = build().assets.get(path.slice(1));
        res.setHeader('Content-Type', 'application/json');
        if (!text) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'asset-unavailable-reload-snapshot' }));
          return;
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(req.method === 'HEAD' ? '' : text);
      });
      const onChange = (path) => {
        if (shouldReloadBrowserData(root, path)) {
          const module = server.moduleGraph.getModuleById(internal);
          if (module) server.moduleGraph.invalidateModule(module);
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.on('change', onChange);
      server.httpServer?.once('close', () => server.watcher.off('change', onChange));
    },
  };
}
