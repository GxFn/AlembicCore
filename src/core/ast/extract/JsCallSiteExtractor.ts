import { astNodeRange } from '../nodeRange.js';
import type { CallSiteInfo } from './CallSiteExtractor.js';
import { callSiteOmissionReason } from './CallSiteNoisePolicy.js';

interface Context {
  callSites: CallSiteInfo[];
  callSiteEvidence?: CallSiteInfo[];
}

interface Owner {
  name: string;
  qualifiedName: string;
  className: string | null;
  thisType: string | null;
  node: TreeSitterNode;
}

interface Binding {
  node: TreeSitterNode;
  kind: 'function' | 'class' | 'unknown';
  qualifiedName?: string;
}

interface Scope {
  parent?: Scope;
  functionBoundary: boolean;
  bindings: Map<string, Binding[]>;
}

interface ClassScope {
  name: string | null;
  qualifiedName: string;
}

const FUNCTIONS = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'function',
  'generator_function',
  'arrow_function',
  'method_definition',
]);
const CLASSES = new Set(['class_declaration', 'abstract_class_declaration', 'class']);
const BLOCKS = new Set([
  'statement_block',
  'switch_body',
  'for_statement',
  'for_in_statement',
  'for_of_statement',
  'catch_clause',
  'class_static_block',
]);

/**
 * 单次结构遍历记录每个真实调用，随后按已收齐的lexical bindings补充证据。
 * 不跨函数沿用outer owner，不因遇到call就跳过它的callee子树；不保留Tree引用到ctx。
 */
export function extractJsCallSites(root: TreeSitterNode, context: Context): void {
  const moduleOwner: Owner = {
    name: '<module>',
    qualifiedName: '<module>',
    className: null,
    thisType: null,
    node: root,
  };
  const moduleScope: Scope = { functionBoundary: true, bindings: new Map() };
  const pending: { node: TreeSitterNode; scope: Scope; owner: Owner }[] = [];

  function visit(node: TreeSitterNode, scope: Scope, owner: Owner, classScope?: ClassScope): void {
    if (node.type === 'ERROR' || node.isMissing) {
      return;
    }

    if (CLASSES.has(node.type)) {
      const declaredName = node.childForFieldName('name')?.text;
      const name = declaredName ?? bindingName(node);
      const qualifiedName = qualify(owner.qualifiedName, name ?? '<anonymous>');
      if (declaredName && node.type !== 'class') {
        addBinding(scope, declaredName, { node, kind: 'class', qualifiedName });
      }
      const inner: Scope = { parent: scope, functionBoundary: false, bindings: new Map() };
      if (declaredName) {
        addBinding(inner, declaredName, { node, kind: 'class', qualifiedName });
      }
      const classOwner: Owner = {
        name: name ?? '<anonymous>',
        qualifiedName,
        className: null,
        thisType: name ?? null,
        node,
      };
      for (const child of node.namedChildren) {
        visit(child, inner, classOwner, { name: name ?? null, qualifiedName });
      }
      return;
    }

    if (FUNCTIONS.has(node.type)) {
      const declaredName = node.childForFieldName('name')?.text;
      const name = declaredName ?? bindingName(node) ?? '<anonymous>';
      const method = node.type === 'method_definition';
      // Tree-sitter包装对象不保证引用相等，字段归属再以真实节点位置核对。
      const fieldOwner =
        isClassField(node.parent) && sameNode(node.parent?.childForFieldName('value'), node);
      const qualifiedName = qualify(
        method || fieldOwner
          ? (classScope?.qualifiedName ?? owner.qualifiedName)
          : owner.qualifiedName,
        name
      );
      const declaration =
        node.type === 'function_declaration' || node.type === 'generator_function_declaration';
      if (declaration && declaredName) {
        addBinding(scope, declaredName, { node, kind: 'function', qualifiedName });
      }
      const inner: Scope = { parent: scope, functionBoundary: true, bindings: new Map() };
      if (!declaration && declaredName) {
        addBinding(inner, declaredName, { node, kind: 'function', qualifiedName });
      }
      const parameters =
        node.childForFieldName('parameters') ?? node.childForFieldName('parameter');
      if (parameters) {
        bindPattern(parameters, inner, { node: parameters, kind: 'unknown' });
      }
      const nextOwner: Owner = {
        name,
        qualifiedName,
        className: classScope?.name ?? null,
        thisType:
          method || fieldOwner
            ? (classScope?.name ?? null)
            : node.type === 'arrow_function'
              ? owner.thisType
              : null,
        node: fieldOwner ? node.parent! : node,
      };
      for (const child of node.namedChildren) {
        visit(child, inner, nextOwner, classScope);
      }
      return;
    }

    let activeScope = scope;
    if (BLOCKS.has(node.type)) {
      activeScope = {
        parent: scope,
        functionBoundary: node.type === 'class_static_block',
        bindings: new Map(),
      };
      const parameter = node.type === 'catch_clause' ? node.childForFieldName('parameter') : null;
      if (parameter) {
        bindPattern(parameter, activeScope, { node: parameter, kind: 'unknown' });
      }
    }
    if (node.type === 'variable_declarator') {
      const target = node.childForFieldName('name');
      const value = node.childForFieldName('value');
      const varScope =
        node.parent?.type === 'variable_declaration' ? functionScope(activeScope) : activeScope;
      const callable = value && FUNCTIONS.has(value.type);
      const knownClass = value && CLASSES.has(value.type);
      const name =
        value?.childForFieldName('name')?.text ??
        (target?.type === 'identifier' ? target.text : undefined);
      if (target) {
        bindPattern(target, varScope, {
          node,
          kind: callable ? 'function' : knownClass ? 'class' : 'unknown',
          ...(name && (callable || knownClass)
            ? { qualifiedName: qualify(owner.qualifiedName, name) }
            : {}),
        });
      }
    } else if (node.type === 'import_statement') {
      registerImports(node, activeScope);
    }
    if (
      node.type === 'call_expression' ||
      node.type === 'new_expression' ||
      node.type === 'jsx_self_closing_element' ||
      node.type === 'jsx_opening_element'
    ) {
      pending.push({ node, scope: activeScope, owner });
    }
    for (const child of node.namedChildren) {
      visit(child, activeScope, owner, classScope);
    }
  }

  visit(root, moduleScope, moduleOwner);
  for (const { node, scope, owner } of pending) {
    const evidence = createEvidence(node, owner, scope);
    if (!evidence) {
      continue;
    }
    context.callSiteEvidence?.push(evidence);
    if (evidence.omissionReason) {
      continue;
    }
    // 原AstFileSummary保持原9字段；完整定位/绑定信息仅经observer回调交给迁移适配层。
    const {
      callee,
      callerMethod,
      callerClass,
      callType,
      receiver,
      receiverType,
      argCount,
      line,
      isAwait,
    } = evidence;
    context.callSites.push({
      callee,
      callerMethod,
      callerClass,
      callType,
      receiver,
      receiverType,
      argCount,
      line,
      isAwait,
    });
  }
}

function createEvidence(
  node: TreeSitterNode,
  owner: Owner,
  scope: Scope
): CallSiteInfo | undefined {
  const jsx = node.type === 'jsx_self_closing_element' || node.type === 'jsx_opening_element';
  const constructorCall = node.type === 'new_expression';
  const expression = jsx
    ? (node.childForFieldName('name') ?? node.namedChild(0))
    : (node.childForFieldName(constructorCall ? 'constructor' : 'function') ?? node.namedChild(0));
  if (!expression) {
    return undefined;
  }
  const calleeExpression = expression.text;
  const actual = unwrap(expression);
  let callee = calleeExpression.slice(0, 80) || 'unknown';
  let receiver: string | null = null;
  let receiverSyntax: string | undefined;
  let receiverType: string | null = null;
  let callType: CallSiteInfo['callType'] = 'function';
  if (jsx || constructorCall) {
    callee = calleeExpression;
    callType = 'constructor';
    receiverType = calleeExpression;
  } else if (actual.type === 'member_expression') {
    const object = actual.childForFieldName('object') ?? actual.namedChild(0);
    const property = actual.childForFieldName('property');
    receiver = object?.text ?? null;
    receiverSyntax = object?.type;
    callee = property?.text ?? actual.text;
    callType = 'method';
    if (receiver === 'this' || receiver === 'self') {
      receiverType = owner.thisType;
    } else if (receiver === 'super') {
      callType = 'super';
      receiverType = owner.thisType;
    } else if (receiver && /^[A-Z]/.test(receiver)) {
      receiverType = receiver;
      callType = 'static';
    }
  } else if (actual.type === 'identifier') {
    callee = actual.text;
  } else if (actual.type === 'super') {
    callee = 'super';
    callType = 'super';
    receiverType = owner.thisType;
  }
  const args = node.childForFieldName('arguments');
  const omissionReason =
    jsx && !/^[A-Z]/.test(callee)
      ? 'intrinsic-jsx-element'
      : callSiteOmissionReason(callee, receiver);
  const evidence: CallSiteInfo = {
    callee,
    callerMethod: owner.name,
    callerClass: owner.className,
    callType,
    receiver,
    receiverType,
    argCount: jsx
      ? node.namedChildren.filter((child) => child.type === 'jsx_attribute').length
      : (args?.namedChildren.filter((child) => child.type !== 'comment').length ?? 0),
    line: node.startPosition.row + 1,
    isAwait: jsx ? false : isAwaited(node),
    matchingRange: astNodeRange(node),
    callerRange: astNodeRange(owner.node),
    callerQualifiedName: owner.qualifiedName,
    calleeExpression,
    ...(receiverSyntax ? { receiverSyntax } : {}),
    syntaxKind: jsx ? 'jsx' : constructorCall ? 'new' : 'call',
    ...(omissionReason ? { omissionReason } : {}),
  };
  const lookupName =
    actual.type === 'identifier'
      ? actual.text
      : actual.type === 'member_expression' &&
          actual.childForFieldName('object')?.type === 'identifier'
        ? actual.childForFieldName('object')!.text
        : undefined;
  if (lookupName) {
    const bindings = lookup(scope, lookupName);
    if (bindings?.length) {
      const first = bindings[0];
      const unique = bindings.every((binding) => sameNode(binding.node, first.node));
      if (unique) {
        evidence.calleeBindingRange = astNodeRange(first.node);
      }
      if (!unique || first.kind === 'unknown') {
        evidence.calleeShadowed = true;
      } else if (actual.type === 'identifier' && first.qualifiedName) {
        evidence.calleeQualifiedName = first.qualifiedName;
      }
    }
  }
  return evidence;
}

function isAwaited(node: TreeSitterNode): boolean {
  let current = node;
  for (let parent = current.parent; parent; current = parent, parent = parent.parent) {
    if (parent.type === 'await_expression') {
      return true;
    }
    if (
      [
        'parenthesized_expression',
        'as_expression',
        'satisfies_expression',
        'non_null_expression',
        'type_assertion',
      ].includes(parent.type)
    ) {
      continue;
    }
    // 序列的最终结果才被await；参数/callee内调用不能继承外层await。
    if (parent.type === 'sequence_expression' && sameNode(parent.lastNamedChild, current)) {
      continue;
    }
    return false;
  }
  return false;
}

function unwrap(node: TreeSitterNode): TreeSitterNode {
  let current = node;
  while (current.type === 'parenthesized_expression' && current.namedChildCount === 1) {
    current = current.namedChild(0)!;
  }
  return current;
}

function bindingName(node: TreeSitterNode): string | undefined {
  const parent = node.parent;
  if (parent && (parent.type === 'variable_declarator' || isClassField(parent))) {
    return parent.childForFieldName('name')?.text;
  }
  return undefined;
}

function isClassField(node: TreeSitterNode | null): boolean {
  return (
    !!node &&
    ['public_field_definition', 'field_definition', 'property_definition'].includes(node.type)
  );
}

function sameNode(left: TreeSitterNode | null | undefined, right: TreeSitterNode): boolean {
  return (
    !!left &&
    left.type === right.type &&
    left.startIndex === right.startIndex &&
    left.endIndex === right.endIndex
  );
}

function qualify(prefix: string, name: string): string {
  return prefix === '<module>' ? name : `${prefix}.${name}`;
}

function functionScope(scope: Scope): Scope {
  let current = scope;
  while (!current.functionBoundary && current.parent) {
    current = current.parent;
  }
  return current;
}

function addBinding(scope: Scope, name: string, binding: Binding): void {
  const existing = scope.bindings.get(name) ?? [];
  existing.push(binding);
  scope.bindings.set(name, existing);
}

function lookup(scope: Scope, name: string): Binding[] | undefined {
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    const bindings = current.bindings.get(name);
    if (bindings) {
      return bindings;
    }
  }
  return undefined;
}

function bindPattern(pattern: TreeSitterNode, scope: Scope, binding: Binding): void {
  if (pattern.type === 'identifier' || pattern.type === 'shorthand_property_identifier_pattern') {
    addBinding(scope, pattern.text, binding);
    return;
  }
  if (['required_parameter', 'optional_parameter'].includes(pattern.type)) {
    const target = pattern.childForFieldName('pattern') ?? pattern.childForFieldName('name');
    if (target) {
      bindPattern(target, scope, { ...binding, node: pattern });
    }
    return;
  }
  if (['assignment_pattern', 'object_assignment_pattern'].includes(pattern.type)) {
    const target = pattern.childForFieldName('left') ?? pattern.namedChild(0);
    if (target) {
      bindPattern(target, scope, binding);
    }
    return;
  }
  if (pattern.type === 'pair_pattern') {
    const target = pattern.childForFieldName('value');
    if (target) {
      bindPattern(target, scope, binding);
    }
    return;
  }
  if (
    ['formal_parameters', 'object_pattern', 'array_pattern', 'rest_pattern'].includes(pattern.type)
  ) {
    for (const child of pattern.namedChildren) {
      bindPattern(child, scope, {
        ...binding,
        node: pattern.type === 'formal_parameters' ? child : binding.node,
      });
    }
  }
}

function registerImports(node: TreeSitterNode, scope: Scope): void {
  function visit(part: TreeSitterNode): void {
    if (part.type === 'import_specifier') {
      const name = part.childForFieldName('alias') ?? part.childForFieldName('name');
      if (name) {
        addBinding(scope, name.text, { node: part, kind: 'unknown' });
      }
      return;
    }
    if (part.type === 'identifier') {
      addBinding(scope, part.text, { node: part, kind: 'unknown' });
      return;
    }
    if (
      ['import_clause', 'named_imports', 'namespace_import', 'import_require_clause'].includes(
        part.type
      )
    ) {
      for (const child of part.namedChildren) {
        visit(child);
      }
    }
  }
  for (const child of node.namedChildren) {
    visit(child);
  }
}
