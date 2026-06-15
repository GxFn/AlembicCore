import type { NamingSummary } from '../../../domain/project-context/index.js';
import type { ExtractedFileSymbol } from './contracts.js';

export function summarizeFileSymbolNaming(symbols: readonly ExtractedFileSymbol[]): NamingSummary {
  const warnings: string[] = [];
  if (symbols.length === 0) {
    warnings.push('file-symbols found no symbols for this file.');
  }

  const exportedSymbols = symbols.filter((symbol) => symbol.exported === true).length;
  const classLike = symbols.filter((symbol) =>
    ['class', 'interface', 'type', 'enum'].includes(symbol.kind)
  );
  const lowerCamelMembers = symbols.filter((symbol) =>
    ['function', 'method', 'property', 'variable'].includes(symbol.kind)
  );

  if (classLike.some((symbol) => !isUpperCamelCase(symbol.name))) {
    warnings.push('Some type-level symbols do not use UpperCamelCase.');
  }
  if (lowerCamelMembers.some((symbol) => !isLowerCamelCase(symbol.name))) {
    warnings.push('Some member-level symbols do not use lowerCamelCase.');
  }

  return {
    convention:
      exportedSymbols > 0
        ? `typescript symbols: ${exportedSymbols} exported / ${symbols.length} total`
        : `typescript symbols: ${symbols.length} total`,
    warnings,
  };
}

function isUpperCamelCase(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(value);
}

function isLowerCamelCase(value: string): boolean {
  return /^[_$]?[a-z][A-Za-z0-9_$]*$/.test(value) || value === 'constructor';
}
