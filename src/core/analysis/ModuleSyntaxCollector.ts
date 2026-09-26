/** JS/TS 模块语法的紧凑事实；不引用 service DTO，也不保留活的 tree-sitter 节点。 */
export interface ModuleSyntaxRange {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

export interface ModuleImportSyntax {
  specifier: string;
  kind: 'named' | 'default' | 'namespace' | 'side-effect' | 'dynamic';
  range: ModuleSyntaxRange;
  statement: string;
  symbols: string[];
  alias?: string;
  typeOnly?: boolean;
}

export interface ModuleExportSyntax {
  name: string;
  kind: string;
  range: ModuleSyntaxRange;
  statement: string;
  exportedName?: string;
  specifier?: string;
}

export interface ModuleSyntaxFacts {
  imports: ModuleImportSyntax[];
  exports: ModuleExportSyntax[];
}

/** 必须在 analyzeFile 的 tree.delete 之前调用；字符串/注释不是语法语句。 */
export function collectModuleSyntax(root: TreeSitterNode): ModuleSyntaxFacts {
  const imports: ModuleImportSyntax[] = [];
  const exports: ModuleExportSyntax[] = [];
  const positions = new Map<ModuleSyntaxRange, ModuleSyntaxRange>();
  const rangeOf = (node: TreeSitterNode, exactNode = node): ModuleSyntaxRange => {
    const range = { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
    positions.set(range, {
      startLine: exactNode.startPosition.row + 1,
      endLine: exactNode.endPosition.row + 1,
      startColumn: exactNode.startPosition.column,
      endColumn: exactNode.endPosition.column,
    });
    return range;
  };
  const visit = (node: TreeSitterNode): void => {
    if (node.type === 'comment' || node.type === 'string' || node.type === 'regex') {
      return;
    }
    if (node.type === 'import_statement') {
      const record = collectStaticImport(node, rangeOf);
      if (record) {
        imports.push(record);
      }
      return;
    }
    if (node.type === 'export_statement' && node.parent?.type === 'program') {
      exports.push(...collectExports(node, rangeOf));
    }
    if (node.type === 'call_expression') {
      const record = collectRuntimeImport(node, rangeOf);
      if (record) {
        imports.push(record);
      }
    }
    // template_string 的纯文本没有语句节点；仍进入 substitution，以保留真正执行的 import()。
    for (const child of node.namedChildren) {
      visit(child);
    }
  };
  visit(root);

  // 正常记录继续使用原行范围/ref；同一行里相同端点的多次关系才附精确列，防止去重吞事实。
  distinguishRanges(imports, (item) => `${item.specifier}:${item.symbols.join(',')}`, positions);
  distinguishRanges(exports, (item) => `${item.name}:${item.specifier ?? ''}`, positions);
  return { imports, exports };
}

type RangeOf = (node: TreeSitterNode, exactNode?: TreeSitterNode) => ModuleSyntaxRange;

function collectStaticImport(
  node: TreeSitterNode,
  rangeOf: RangeOf
): ModuleImportSyntax | undefined {
  const specifier = literalValue(node.childForFieldName('source'));
  if (specifier === undefined) {
    return undefined;
  }
  const clause = node.namedChildren.find((child) => child.type === 'import_clause');
  const symbols: string[] = [];
  let kind: ModuleImportSyntax['kind'] = 'side-effect';
  let alias: string | undefined;
  for (const child of clause?.namedChildren ?? []) {
    if (child.type === 'identifier') {
      symbols.push(child.text);
      kind = 'default';
    } else if (child.type === 'namespace_import') {
      alias = child.namedChildren.find((item) => item.type === 'identifier')?.text;
      symbols.push('*');
      kind = 'namespace';
    } else if (child.type === 'named_imports') {
      for (const binding of child.namedChildren) {
        if (binding.type !== 'import_specifier') {
          continue;
        }
        const local = binding.childForFieldName('alias') ?? binding.childForFieldName('name');
        if (local) {
          symbols.push(nameOf(local));
        }
      }
      kind = 'named';
    }
  }
  return {
    specifier,
    kind,
    range: rangeOf(node),
    statement: statementText(node),
    symbols,
    ...(alias ? { alias } : {}),
    typeOnly: node.children.some((child) => child.type === 'type'),
  };
}

function collectRuntimeImport(
  node: TreeSitterNode,
  rangeOf: RangeOf
): ModuleImportSyntax | undefined {
  const callee = node.childForFieldName('function');
  const dynamic = callee?.type === 'import';
  if (!dynamic && !(callee?.type === 'identifier' && callee.text === 'require')) {
    return undefined;
  }
  // tree-sitter 的 comment 也是 named node；webpack 等参数前注释不改变第一个实参。
  const argument = node
    .childForFieldName('arguments')
    ?.namedChildren.find((child) => child.type !== 'comment');
  const specifier = literalValue(argument);
  if (specifier === undefined) {
    return undefined;
  }
  const binding =
    !dynamic && node.parent?.type === 'variable_declarator'
      ? node.parent.childForFieldName('name')
      : undefined;
  const statement = enclosingStatement(node);
  return {
    specifier,
    kind: dynamic
      ? 'dynamic'
      : binding?.type === 'object_pattern'
        ? 'named'
        : binding
          ? 'default'
          : 'side-effect',
    range: rangeOf(node),
    statement: statementText(statement),
    symbols: dynamic || !binding ? [] : bindingNames(binding),
  };
}

function collectExports(node: TreeSitterNode, rangeOf: RangeOf): ModuleExportSyntax[] {
  const statement = statementText(node);
  const specifier = literalValue(node.childForFieldName('source'));
  const clause = node.namedChildren.find((child) => child.type === 'export_clause');
  if (clause) {
    return clause.namedChildren
      .filter((child) => child.type === 'export_specifier')
      .flatMap((binding) => {
        const name = binding.childForFieldName('name');
        if (!name) {
          return [];
        }
        const alias = binding.childForFieldName('alias');
        return [
          {
            name: nameOf(name),
            kind: specifier === undefined ? 'named' : 're-export',
            range: rangeOf(node, binding),
            statement,
            ...(alias ? { exportedName: nameOf(alias) } : {}),
            ...(specifier === undefined ? {} : { specifier }),
          },
        ];
      });
  }
  const namespace = node.namedChildren.find((child) => child.type === 'namespace_export');
  if (specifier !== undefined) {
    const alias = namespace?.namedChildren[0];
    return [
      {
        name: '*',
        kind: alias ? 're-export' : 're-export-all',
        range: rangeOf(node),
        statement,
        specifier,
        ...(alias ? { exportedName: nameOf(alias) } : {}),
      },
    ];
  }
  const declaration = node.childForFieldName('declaration');
  if (declaration) {
    if (declaration.type === 'lexical_declaration' || declaration.type === 'variable_declaration') {
      const kind =
        declaration.children.find((child) => ['const', 'let', 'var'].includes(child.type))?.type ??
        'variable';
      return declaration.namedChildren
        .filter((child) => child.type === 'variable_declarator')
        .flatMap((binding) => {
          const name = binding.childForFieldName('name');
          return name
            ? bindingNames(name).map((value) => ({
                name: value,
                kind,
                range: rangeOf(node),
                statement,
              }))
            : [];
        });
    }
    const name = declaration.childForFieldName('name');
    if (name) {
      const kind =
        declaration.type === 'type_alias_declaration'
          ? 'type'
          : declaration.type.includes('function')
            ? 'function'
            : declaration.type.includes('class')
              ? 'class'
              : declaration.type.replace(/_declaration$/, '');
      return [{ name: nameOf(name), kind, range: rangeOf(node), statement }];
    }
  }
  // default 表达式没有具名声明；保留真实公共名字，不凭文本构造一个函数符号。
  const value = node.childForFieldName('value');
  if (value && node.children.some((child) => child.type === 'default')) {
    return [
      {
        name: value.type === 'identifier' ? value.text : 'default',
        exportedName: 'default',
        kind: 'default',
        range: rangeOf(node),
        statement,
      },
    ];
  }
  return [];
}

function bindingNames(node: TreeSitterNode): string[] {
  if (['identifier', 'shorthand_property_identifier_pattern'].includes(node.type)) {
    return [node.text];
  }
  if (node.type === 'pair_pattern') {
    const value = node.childForFieldName('value');
    return value ? bindingNames(value) : [];
  }
  if (node.type === 'assignment_pattern' || node.type === 'object_assignment_pattern') {
    const left = node.childForFieldName('left');
    return left ? bindingNames(left) : [];
  }
  if (['object_pattern', 'array_pattern', 'rest_pattern'].includes(node.type)) {
    return node.namedChildren.flatMap(bindingNames);
  }
  return [];
}

function literalValue(node: TreeSitterNode | null | undefined): string | undefined {
  if (!node || !['string', 'template_string'].includes(node.type)) {
    return undefined;
  }
  if (node.hasError === true || node.isMissing === true || node.text.at(-1) !== node.text[0]) {
    return undefined;
  }
  if (node.namedChildren.some((child) => child.type === 'template_substitution')) {
    return undefined;
  }
  // 这里只解码 AST 已确认的 literal，不执行源码；保留旧 dynamic scanner 对转义引号的支持。
  // 有界转义 token 不承担语法识别，也不会恢复旧的整行 import/require 回溯。
  return node.text
    .slice(1, -1)
    .replace(
      /\\(?:u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g,
      (escaped) => {
        const value = escaped.slice(1);
        if (value.startsWith('u{')) {
          return String.fromCodePoint(Number.parseInt(value.slice(2, -1), 16));
        }
        if (value[0] === 'u' && value.length === 5) {
          return String.fromCharCode(Number.parseInt(value.slice(1), 16));
        }
        if (value[0] === 'x' && value.length === 3) {
          return String.fromCharCode(Number.parseInt(value.slice(1), 16));
        }
        if (/^[\r\n\u2028\u2029]/.test(value)) {
          return '';
        }
        const controls: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          v: '\v',
          '0': '\0',
        };
        return controls[value] ?? value;
      }
    );
}

function nameOf(node: TreeSitterNode): string {
  return literalValue(node) ?? node.text;
}

function enclosingStatement(node: TreeSitterNode): TreeSitterNode {
  let current = node;
  while (current.parent && current.parent.type !== 'program') {
    if (
      current.type.endsWith('_statement') ||
      current.type === 'lexical_declaration' ||
      current.type === 'variable_declaration'
    ) {
      break;
    }
    current = current.parent;
  }
  return current;
}

function statementText(node: TreeSitterNode): string {
  return node.text.replace(/\s+/g, ' ').trim();
}

function distinguishRanges<T extends { range: ModuleSyntaxRange }>(
  records: T[],
  identityOf: (record: T) => string,
  positions: Map<ModuleSyntaxRange, ModuleSyntaxRange>
): void {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = `${identityOf(record)}:${record.range.startLine}:${record.range.endLine}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    for (const record of group) {
      Object.assign(record.range, positions.get(record.range));
    }
  }
}
