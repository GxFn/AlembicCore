import ts from 'typescript';
import { resolve, relative } from 'node:path';
import { readFileSync } from 'node:fs';
export function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}
const rel = (root, path) => relative(root, path).replaceAll('\\', '/');
export function analyze(root, paths) {
  const configFile = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  if (configFile.error)
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, ' '));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const options = { ...parsed.options, allowJs: true, checkJs: false, noEmit: true };
  const program = ts.createProgram(
    paths.map((p) => resolve(root, p)),
    options,
  );
  const checker = program.getTypeChecker();
  const imports = [],
    declarations = new Map(),
    sourceFiles = new Map();
  const resolveModule = (specifier, from) => {
    const r = ts.resolveModuleName(specifier, resolve(root, from), options, ts.sys).resolvedModule;
    if (!r) return null;
    const path = rel(root, r.resolvedFileName);
    return path.startsWith('..') || path.includes('node_modules') ? null : path;
  };
  for (const path of paths) {
    const sf = program.getSourceFile(resolve(root, path));
    if (!sf) continue;
    sourceFiles.set(path, sf);
    const names = new Set();
    walk(sf, (node) => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isVariableDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isPropertyDeclaration(node)) &&
        node.name
      )
        names.add(node.name.getText(sf));
      let specifier, kind;
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        specifier = node.moduleSpecifier.text;
        const clause = node.importClause;
        if (!clause) kind = 'side-effect';
        else if (clause.isTypeOnly) kind = 'type';
        else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          const a = clause.namedBindings.elements;
          const types = a.filter((x) => x.isTypeOnly).length;
          kind = types === a.length && !clause.name ? 'type' : types ? 'mixed' : 'value';
        } else kind = 'value';
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifier = node.moduleSpecifier.text;
        const els =
          node.exportClause && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements
            : [];
        kind =
          node.isTypeOnly || (els.length && els.every((x) => x.isTypeOnly))
            ? 'type-re-export'
            : els.some((x) => x.isTypeOnly)
              ? 'mixed-re-export'
              : 're-export';
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const arg = node.arguments[0];
        specifier = arg && ts.isStringLiteralLike(arg) ? arg.text : node.getText(sf);
        kind = arg && ts.isStringLiteralLike(arg) ? 'dynamic-literal' : 'dynamic-unresolved';
      }
      if (kind) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        imports.push({
          id: `${path}:${line}:${imports.length}`,
          from: path,
          to: kind === 'dynamic-unresolved' ? null : resolveModule(specifier, path),
          specifier,
          kind,
          line,
          excerpt: node.getText(sf),
          resolution:
            kind === 'dynamic-unresolved'
              ? 'unknown'
              : resolveModule(specifier, path)
                ? 'internal'
                : specifier.startsWith('.')
                  ? 'unresolved'
                  : 'external',
        });
      }
    });
    declarations.set(path, names);
  }
  function exportsFor(path) {
    const sf = program.getSourceFile(resolve(root, path));
    if (!sf) return [];
    const symbol = checker.getSymbolAtLocation(sf);
    if (!symbol) return [];
    return checker
      .getExportsOfModule(symbol)
      .map((s) => {
        let target = s;
        const visited = new Set();
        while (target.flags & ts.SymbolFlags.Alias && !visited.has(target)) {
          visited.add(target);
          target = checker.getAliasedSymbol(target);
        }
        const d = target.declarations?.[0];
        return {
          name: s.name,
          origin: d ? rel(root, d.getSourceFile().fileName) : null,
          // TS的模块symbol.name包含绝对磁盘路径；身份由origin承担，不能带进便携摘要。
          declaredName: d && ts.isSourceFile(d) ? '<module>' : target.name,
          kind: target.flags & ts.SymbolFlags.Value ? 'value' : 'type',
          line: d ? d.getSourceFile().getLineAndCharacterOfPosition(d.getStart()).line + 1 : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return { root, program, checker, imports, declarations, sourceFiles, exportsFor };
}
function callRoot(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node))
    return callRoot(node.expression);
  return '';
}
export function testCases(sf) {
  const result = [];
  walk(sf, (node) => {
    if (ts.isCallExpression(node) && ['it', 'test'].includes(callRoot(node.expression))) {
      const title = node.arguments[0],
        callback = node.arguments[1];
      if (
        title &&
        ts.isStringLiteralLike(title) &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      )
        result.push({ title: title.text, node: callback });
    }
  });
  return result;
}
export function inspectEvidence(analysis, e) {
  if (e.relation === 'none') return e.reason ? [] : ['missing-none-reason'];
  const sf = analysis.sourceFiles.get(e.path);
  if (!sf) return ['missing-test'];
  const cases = testCases(sf).filter((c) => c.title === e.caseTitle);
  if (!cases.length) return ['missing-case'];
  const selected = cases.find((c) => {
    let matched = false;
    walk(c.node, (n) => {
      if (!ts.isCallExpression(n) || !['expect', 'assert'].includes(callRoot(n.expression))) return;
      const statement = ts.findAncestor(n, ts.isExpressionStatement);
      const raw = (statement ?? n).getText(sf),
        needle = e.assertionExcerpt ?? '\u0000';
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        false,
        ts.LanguageVariant.Standard,
        raw,
      );
      const trivia = [];
      for (
        let token = scanner.scan();
        token !== ts.SyntaxKind.EndOfFileToken;
        token = scanner.scan()
      ) {
        if (
          [
            ts.SyntaxKind.SingleLineCommentTrivia,
            ts.SyntaxKind.MultiLineCommentTrivia,
            ts.SyntaxKind.StringLiteral,
            ts.SyntaxKind.NoSubstitutionTemplateLiteral,
          ].includes(token)
        )
          trivia.push([scanner.getTokenPos(), scanner.getTextPos()]);
      }
      let start = raw.indexOf(needle);
      while (start >= 0) {
        // 断言片段必须位于真实断言调用内，不能完全藏在字符串或注释中。
        if (!trivia.some(([a, b]) => start >= a && start + needle.length <= b)) matched = true;
        start = raw.indexOf(needle, start + 1);
      }
    });
    return matched;
  });
  if (!selected) return ['assertion-outside-case'];
  let hasAssertion = false,
    hasAnchor = false,
    direct = false;
  // AST只核验断言归属与符号绑定；人工assertedBehavior仍是有界审阅，绝不生成运行结果。
  walk(selected.node, (n) => {
    if (ts.isCallExpression(n) && ['expect', 'assert'].includes(callRoot(n.expression)))
      hasAssertion = true;
    if (ts.isIdentifier(n) && n.text === e.anchorSymbol.split('.').at(-1)) hasAnchor = true;
    if (ts.isIdentifier(n)) {
      const s = analysis.checker.getSymbolAtLocation(n);
      if (!s) return;
      let target = s;
      if (s.flags & ts.SymbolFlags.Alias) target = analysis.checker.getAliasedSymbol(s);
      const declarations = target.declarations ?? [];
      const outside = declarations.some((d) => d.getSourceFile() !== sf);
      const called =
        (ts.isCallExpression(n.parent) && n.parent.expression === n) ||
        (ts.isNewExpression(n.parent) && n.parent.expression === n) ||
        (ts.isPropertyAccessExpression(n.parent) &&
          ts.isCallExpression(n.parent.parent) &&
          n.parent.parent.expression === n.parent);
      if (outside && called && [n.text, target.name].includes(e.anchorSymbol.split('.').at(-1)))
        direct = true;
      // 变量位于case或beforeEach，但实际调用的方法声明必须绑定到另一个源码文件。
      if (
        n.text === e.anchorSymbol.split('.').at(-1) &&
        ts.isPropertyAccessExpression(n.parent) &&
        n.parent.expression === n &&
        ts.isCallExpression(n.parent.parent) &&
        n.parent.parent.expression === n.parent
      ) {
        const method = analysis.checker.getSymbolAtLocation(n.parent.name);
        if (method?.declarations?.some((d) => d.getSourceFile() !== sf)) direct = true;
      }
    }
  });
  const errors = [];
  if (!hasAssertion) errors.push('no-assertion-call');
  if (e.relation === 'direct' && !direct) errors.push('no-direct-bound-call');
  // 间接链可以从文件级fixture/import接入，但必须有真实AST标识符而不是注释。
  if (e.relation === 'indirect' && !hasAnchor) {
    walk(sf, (n) => {
      if (ts.isIdentifier(n) && n.text === e.anchorSymbol.split('.').at(-1)) hasAnchor = true;
    });
    if (!hasAnchor) errors.push('missing-indirect-anchor');
  }
  return errors;
}
// 除了文件存在，还要求摘录属于所声明owner；门面再导出单独按公开绑定核对。
export function inspectSourceAnchor(analysis, anchor) {
  const sf = analysis.sourceFiles.get(anchor.path);
  if (!sf) return ['source-not-parsed'];
  if (anchor.symbol === '<module>')
    return sf.text.includes(anchor.excerpt) ? [] : ['source-excerpt'];
  let matched = false;
  walk(sf, (node) => {
    if (node.name?.getText(sf) === anchor.symbol && node.getText(sf).includes(anchor.excerpt))
      matched = true;
    if (
      ts.isExportDeclaration(node) &&
      node.getText(sf).includes(anchor.excerpt) &&
      analysis.exportsFor(anchor.path).some((e) => e.name === anchor.symbol)
    )
      matched = true;
  });
  return matched ? [] : ['source-excerpt-outside-owner'];
}
