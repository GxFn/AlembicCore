import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  classifyPublicApiExport,
  PUBLIC_API_BOUNDARY_POLICY,
  summarizePublicApiExports,
} from './support/public-api-inventory.js';

interface PackageJson {
  exports: Record<string, unknown>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
}

describe('public API inventory', () => {
  it('keeps the actual ReportReader type limited to query and stats', () => {
    // Vitest 会擦除类型，检查手写对象的 typeof 不能证明只读契约；直接检查导出类型。
    const file = fileURLToPath(new URL('../src/report.ts', import.meta.url));
    const program = ts.createProgram([file], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const module = checker.getSymbolAtLocation(program.getSourceFile(file)!);
    const reader = checker
      .getExportsOfModule(module!)
      .find((symbol) => symbol.name === 'ReportReader');
    expect(reader).toBeDefined();
    expect(
      checker
        .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(reader!))
        .map((property) => property.name)
        .sort()
    ).toEqual(['query', 'stats']);
  });

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

  it('locks the phase 9 export status summary from policy', () => {
    const exportPaths = Object.keys(readPackageJson().exports);

    expect(summarizePublicApiExports(exportPaths)).toStrictEqual(
      PUBLIC_API_BOUNDARY_POLICY.expectedCounts
    );
  });
});
