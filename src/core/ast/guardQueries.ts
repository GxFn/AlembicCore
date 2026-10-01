/**
 * @module ast/guardQueries
 * @description Guard 的 AST 规则使用的三个树查询：调用表达式、上下文内的模式、协议遵循。
 *
 * 这些查询每次自行解析源码并释放 Tree，不依赖也不修改单文件摘要的形态。
 */

import { analyzeFile } from './analyzeFile.js';
import { getLanguageParser } from './languageRegistry.js';

interface ContextFilter {
  forbiddenContext?: string;
  requiredContext?: string;
}

function _findIdentifier(node: TreeSitterNode): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    if (
      child.type === 'identifier' ||
      child.type === 'simple_identifier' ||
      child.type === 'type_identifier'
    ) {
      return child.text;
    }
  }
  return null;
}

/**
 * 在 AST 中搜索特定调用表达式
 * @param source 源代码
 * @param lang 'objectivec' | 'swift'
 * @param targetCallee 目标调用，如 'URLSession.shared', 'dispatch_sync'
 * @returns >}
 */
export function findCallExpressions(source: string, lang: string, targetCallee: string) {
  const parser = getLanguageParser(lang);
  if (!parser) {
    return [];
  }
  const tree = parser.parse(source);
  if (!tree) {
    return [];
  }
  try {
    const results: { line: number; snippet: string; enclosingClass: string | null }[] = [];
    const lines = source.split(/\r?\n/);

    function walk(node: TreeSitterNode, enclosingClass: string | null) {
      // 更新当前所处的类
      let currentClass = enclosingClass;
      if (
        [
          'class_declaration',
          'class_definition',
          'struct_declaration',
          'class_interface',
          'class_implementation',
        ].includes(node.type)
      ) {
        currentClass = _findIdentifier(node) || enclosingClass;
      }

      // 检查调用表达式
      const isCallLike = [
        'call_expression',
        'message_expression',
        'function_call_expression',
        'method_invocation',
      ].includes(node.type);
      if (isCallLike) {
        if (readDirectCalleeNames(node).some((name) => matchesCallTarget(name, targetCallee))) {
          results.push({
            line: node.startPosition.row + 1,
            snippet: lines[node.startPosition.row]?.trim().slice(0, 120) || '',
            enclosingClass: currentClass,
          });
        }
      }

      if (lang === 'dart') {
        // Dart 把 callee 与调用参数表示为兄弟 selector，不能按正文包含关系推断。
        for (const call of readDartDirectCalls(node)) {
          if (call.names.some((name) => matchesCallTarget(name, targetCallee))) {
            results.push({
              line: call.node.startPosition.row + 1,
              snippet: lines[call.node.startPosition.row]?.trim().slice(0, 120) || '',
              enclosingClass: currentClass,
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!, currentClass);
      }
    }

    walk(tree.rootNode, null);
    return results;
  } finally {
    tree.delete();
  }
}

function readDirectCalleeNames(node: TreeSitterNode): string[] {
  if (node.type === 'method_invocation') {
    const method = readDirectCallableName(node.childForFieldName('name'));
    const receiver = readDirectCallableName(node.childForFieldName('object'));
    return method ? (receiver ? [method, `${receiver}.${method}`] : [method]) : [];
  }
  if (node.type === 'message_expression') {
    const method = node.childForFieldName('method');
    if (!method) {
      return [];
    }
    // ObjC selector 的参数名/值不是方法名；只读取 method 后紧邻冒号的 selector 段。
    const parts = node.children.filter(
      (child) =>
        child.type === 'identifier' &&
        child.startIndex >= method.startIndex &&
        child.nextSibling?.type === ':'
    );
    const selector =
      parts.length > 0 ? `${parts.map((part) => part.text).join(':')}:` : method.text;
    const names = [selector, method.text];
    const receiver = readDirectCallableName(node.childForFieldName('receiver'));
    return receiver ? [...names, ...names.map((name) => `${receiver}.${name}`)] : names;
  }
  // TS/JS/Go/Rust 使用 function 字段；Swift/Kotlin 的第一个命名子节点是 callee。
  const callable = unwrapDirectCallableNode(
    node.childForFieldName('function') ?? node.namedChild(0)
  );
  const name = readDirectCallableName(callable);
  if (name) {
    return [name, name.split(/\.|::/).at(-1)!];
  }
  // 接收者可以是动态表达式，但callee节点上的selector仍是确切方法名。
  // 这里只读语法字段，不从接收者调用的参数正文猜测目标API。
  const suffix =
    callable?.childForFieldName('suffix') ??
    callable?.namedChildren.find((child) => child.type === 'navigation_suffix');
  let selector =
    callable?.childForFieldName('property') ??
    callable?.childForFieldName('field') ??
    suffix?.childForFieldName('suffix') ??
    suffix?.namedChildren.find((child) => child.type === 'simple_identifier') ??
    null;
  if (callable?.type === 'subscript_expression') {
    const index = callable.childForFieldName('index');
    selector =
      index?.type === 'string' &&
      index.namedChildCount === 1 &&
      index.namedChild(0)?.type === 'string_fragment'
        ? index.namedChild(0)
        : null;
  }
  const member = selector?.text ?? '';
  if (!/^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(member)) {
    return [];
  }
  const receiver = readDirectCallableName(
    callable?.childForFieldName('object') ??
      callable?.childForFieldName('operand') ??
      callable?.childForFieldName('value') ??
      callable?.childForFieldName('target') ??
      callable?.namedChild(0) ??
      null
  );
  return receiver ? [member, `${receiver}.${member}`] : [member];
}

function readDartDirectCalls(node: TreeSitterNode) {
  const calls: { node: TreeSitterNode; names: string[] }[] = [];
  let callee: string | null = null;
  let start: TreeSitterNode | null = null;
  for (const child of node.namedChildren) {
    if (child.type === 'cascade_selector' && node.type === 'cascade_section') {
      const method = child.namedChild(0);
      const name = method?.type === 'identifier' ? readDirectCallableName(method) : null;
      const siblings = node.parent?.namedChildren ?? [];
      // 只给单一明确 receiver 添加限定名，复杂表达式保留实际 selector 的方法名。
      const receiver =
        siblings.findIndex((item) => item.type === 'cascade_section') === 1
          ? readDirectCallableName(siblings[0])
          : null;
      callee = name ? (receiver ? `${receiver}.${name}` : name) : null;
      start = method ?? null;
      continue;
    }
    if (['identifier', 'type_identifier', 'this', 'super'].includes(child.type)) {
      callee = readDirectCallableName(child);
      start = child;
      continue;
    }
    if (
      ![
        'selector',
        'argument_part',
        'unconditional_assignable_selector',
        'conditional_assignable_selector',
      ].includes(child.type)
    ) {
      callee = null;
      start = null;
      continue;
    }
    const part = child.type === 'selector' ? child.namedChild(0) : child;
    if (part?.type === 'argument_part') {
      if (callee && start && part.namedChildren.some((item) => item.type === 'arguments')) {
        calls.push({ node: start, names: [callee, callee.split('.').at(-1)!] });
      }
      // 调用结果后的 .method 只保留其方法名，不虚构动态 receiver 的限定路径。
      callee = null;
      start = null;
    } else if (
      part &&
      ['unconditional_assignable_selector', 'conditional_assignable_selector'].includes(part.type)
    ) {
      const member = part.namedChild(0);
      const name = member?.type === 'identifier' ? readDirectCallableName(member) : null;
      callee = name ? (callee ? `${callee}.${name}` : name) : null;
      start ??= member;
    } else {
      callee = null;
      start = null;
    }
  }
  return calls;
}

function unwrapDirectCallableNode(node: TreeSitterNode | null): TreeSitterNode | null {
  // Rust泛型调用的function字段保留实际callee，类型实参不属于调用名。
  while (node) {
    if (node.type === 'parenthesized_expression' && node.namedChildCount === 1) {
      node = node.namedChild(0);
    } else if (node.type === 'generic_function') {
      node = node.childForFieldName('function');
    } else {
      break;
    }
  }
  return node;
}
function readDirectCallableName(node: TreeSitterNode | null): string | null {
  node = unwrapDirectCallableNode(node);
  const name = node?.text.replace(/\s+/g, '').replace(/\?\./g, '.') ?? '';
  // 限定为标识符/限定名。getFactory("target")() 这类动态callee不从参数正文推断API名。
  return /^[\p{ID_Start}_$][\p{ID_Continue}$]*(?:(?:\.|::)[\p{ID_Start}_$][\p{ID_Continue}$]*)*$/u.test(
    name
  )
    ? name
    : null;
}

function matchesCallTarget(name: string, target: string): boolean {
  return name === target || name.startsWith(`${target}.`) || name.startsWith(`${target}::`);
}

/**
 * 搜索特定模式在特定上下文中的出现
 * @param source 源代码
 * @param lang 'objectivec' | 'swift'
 * @param pattern 要查找的文本模式（普通字符串匹配）
 * @param contextFilter
 *   forbiddenContext: 如果在此上下文中出现则报告 (如 'dealloc')
 *   requiredContext: 如果不在此上下文中出现则报告
 * @returns >}
 */
export function findPatternInContext(
  source: string,
  lang: string,
  pattern: string,
  contextFilter: ContextFilter = {}
) {
  const parser = getLanguageParser(lang);
  if (!parser) {
    return [];
  }

  const tree = parser.parse(source);
  if (!tree) {
    return [];
  }
  try {
    const results: { line: number; snippet: string; context: string | null }[] = [];
    const lines = source.split(/\r?\n/);

    function getEnclosingMethodName(node: TreeSitterNode): string | null {
      let current = node.parent;
      while (current) {
        if (
          [
            'method_definition',
            'method_declaration',
            'function_declaration',
            'function_definition',
          ].includes(current.type)
        ) {
          return _findIdentifier(current) || null;
        }
        current = current.parent;
      }
      return null;
    }

    function getEnclosingClassName(node: TreeSitterNode): string | null {
      let current = node.parent;
      while (current) {
        if (
          [
            'class_declaration',
            'struct_declaration',
            'class_interface',
            'class_implementation',
          ].includes(current.type)
        ) {
          return _findIdentifier(current) || null;
        }
        current = current.parent;
      }
      return null;
    }

    function walk(node: TreeSitterNode) {
      const nodeText = node.text || '';
      if (nodeText.includes(pattern) && node.childCount === 0) {
        // 叶节点匹配
        const methodName = getEnclosingMethodName(node);
        const className = getEnclosingClassName(node);

        if (contextFilter.forbiddenContext) {
          // 在禁止上下文中出现 → 报告
          if (
            methodName === contextFilter.forbiddenContext ||
            className === contextFilter.forbiddenContext
          ) {
            results.push({
              line: node.startPosition.row + 1,
              snippet: lines[node.startPosition.row]?.trim().slice(0, 120) || '',
              context: methodName || className,
            });
          }
        } else if (contextFilter.requiredContext) {
          // 不在要求的上下文中 → 报告
          if (
            className !== contextFilter.requiredContext &&
            methodName !== contextFilter.requiredContext
          ) {
            results.push({
              line: node.startPosition.row + 1,
              snippet: lines[node.startPosition.row]?.trim().slice(0, 120) || '',
              context: className || methodName,
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!);
      }
    }

    walk(tree.rootNode);
    return results;
  } finally {
    tree.delete();
  }
}

/**
 * 检查类是否遵循指定协议
 * @param source 源代码
 * @param lang 'objectivec' | 'swift'
 * @param className 类名
 * @param protocolName 协议名
 * @returns }
 */
export function checkProtocolConformance(
  source: string,
  lang: string,
  className: string,
  protocolName: string
) {
  const summary = analyzeFile(source, lang);
  if (!summary) {
    return { conforms: false, classFound: false, classDeclLine: null };
  }

  // 在 classes 中查找
  const cls = summary.classes.find((c) => c.name === className);
  if (!cls) {
    return { conforms: false, classFound: false, classDeclLine: null };
  }

  // 直接遵循
  if (cls.protocols?.includes(protocolName)) {
    return { conforms: true, classFound: true, classDeclLine: cls.line };
  }

  // 通过 extension/category 遵循
  const catConforms = summary.categories.some(
    (cat) => cat.className === className && cat.protocols?.includes(protocolName)
  );
  if (catConforms) {
    return { conforms: true, classFound: true, classDeclLine: cls.line };
  }

  return { conforms: false, classFound: true, classDeclLine: cls.line };
}
