import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  classifyPublicApiExport,
  summarizePublicApiExports,
} from './support/public-api-inventory.js';

interface PackageJson {
  exports: Record<string, unknown>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
}

describe('public API inventory', () => {
  it('classifies every current package export', () => {
    const exportPaths = Object.keys(readPackageJson().exports);
    const unclassified = exportPaths.filter((exportPath) => !classifyPublicApiExport(exportPath));

    expect(unclassified).toStrictEqual([]);
  });

  it('keeps wildcard exports transitional while public boundaries are being designed', () => {
    const exportPaths = Object.keys(readPackageJson().exports);
    const wildcardPublicExports = exportPaths.filter((exportPath) => {
      const classification = classifyPublicApiExport(exportPath);
      return exportPath.includes('*') && classification?.status !== 'transitional-internal';
    });

    expect(wildcardPublicExports).toStrictEqual([]);
  });

  it('locks the phase 1 export status summary', () => {
    const exportPaths = Object.keys(readPackageJson().exports);

    expect(summarizePublicApiExports(exportPaths)).toStrictEqual({
      'stable-public': 10,
      'provisional-public': 40,
      'transitional-internal': 79,
      'internal-only': 0,
      forbidden: 0,
    });
  });
});
