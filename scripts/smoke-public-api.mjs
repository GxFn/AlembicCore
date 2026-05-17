import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const exactExportPaths = Object.keys(pkg.exports).filter((exportPath) => !exportPath.includes('*'));
const requiredRootExports = [
  'DEFAULT_FOLDER_NAMES',
  'KnowledgeRepositoryImpl',
  'ProjectIntelligenceCapability',
  'createExternalWorkflowSession',
];

const imported = [];

for (const exportPath of exactExportPaths) {
  const specifier = exportPath === '.' ? pkg.name : `${pkg.name}/${exportPath.slice(2)}`;
  const mod = await import(specifier);
  imported.push({ specifier, keys: Object.keys(mod).length });
}

const root = await import(pkg.name);
for (const exportName of requiredRootExports) {
  if (!(exportName in root)) {
    throw new Error(`Missing root export: ${exportName}`);
  }
}

console.log(`Imported ${imported.length} exact public API entrypoints.`);

