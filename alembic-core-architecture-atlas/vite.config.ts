import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Node维护脚本在Vite配置中复用，无产品包依赖。
import { browserDataPlugin } from './scripts/browser-plugin.mjs';
export default defineConfig({
  base: './',
  plugins: [browserDataPlugin(fileURLToPath(new URL('.', import.meta.url)))],
  build: { outDir: '.build/site', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
