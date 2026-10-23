declare module 'cytoscape-elk' {
  import type cytoscape from 'cytoscape';
  const extension: cytoscape.Ext;
  export default extension;
}

declare module 'virtual:atlas-bootstrap' {
  const bootstrap: import('../schemas/browser.ts').AtlasBootstrap;
  export default bootstrap;
}
