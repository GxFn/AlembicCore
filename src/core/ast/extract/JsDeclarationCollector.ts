import { astNodeRange } from '../nodeRange.js';

/**
 * JS/TS 里语言插件摘要没有承载的模块级声明：顶层变量绑定与接口的方法签名。
 *
 * 插件摘要（classes / methods / properties）的形状被既有消费者依赖，往里塞顶层变量会让
 * "属性必属于某个类"的假设失效（模式检测、指标）。这些声明因此走独立的事实通道，
 * 只由文件符号投影消费。
 */
export interface SupplementalDeclaration {
  name: string;
  kind: 'variable' | 'method';
  /** 真实绑定关键字（const / let / var），或接口方法签名的 method。 */
  declarationKind: string;
  /** 接口方法所属的接口名；顶层变量没有容器。 */
  container?: string;
  /** 声明语句自身带 export。`export { x }` 形式的导出由模块导出表另行给出。 */
  exported: boolean;
  /** 声明节点的真实位置（含列）。解构绑定取绑定标识符自身的位置。 */
  range: { startLine: number; endLine: number; startColumn: number; endColumn: number };
}

/** 值是函数的声明由语言插件按函数记录产出，这里不重复。两处必须用同一张表。 */
export const FUNCTION_VALUE_TYPES: ReadonlySet<string> = new Set([
  'arrow_function',
  'function',
  'function_expression',
  'generator_function',
]);

const VARIABLE_STATEMENTS = new Set(['lexical_declaration', 'variable_declaration']);

/** 必须在 analyzeFile 的 tree.delete 之前调用；只看模块作用域，不进入任何函数体或块。 */
export function collectJsDeclarations(root: TreeSitterNode): SupplementalDeclaration[] {
  const declarations: SupplementalDeclaration[] = [];
  for (const statement of root.namedChildren) {
    const exported = statement.type === 'export_statement';
    const declaration = exported ? statement.childForFieldName('declaration') : statement;
    if (!declaration) {
      continue;
    }
    if (VARIABLE_STATEMENTS.has(declaration.type)) {
      collectVariables(declaration, exported, declarations);
    } else if (declaration.type === 'interface_declaration') {
      collectInterfaceMethods(declaration, declarations);
    }
  }
  return declarations;
}

function collectVariables(
  statement: TreeSitterNode,
  exported: boolean,
  declarations: SupplementalDeclaration[]
): void {
  const declarationKind =
    statement.children.find((child) => ['const', 'let', 'var'].includes(child.type))?.type ?? 'var';
  for (const declarator of statement.namedChildren) {
    if (declarator.type !== 'variable_declarator') {
      continue;
    }
    const target = declarator.childForFieldName('name');
    const value = declarator.childForFieldName('value');
    if (!target || (value && FUNCTION_VALUE_TYPES.has(value.type)) || isRequireCall(value)) {
      // require() 绑定是导入，由模块语法事实记录；它不是本模块的声明。
      continue;
    }
    if (target.type === 'identifier') {
      declarations.push({
        name: target.text,
        kind: 'variable',
        declarationKind,
        exported,
        range: astNodeRange(declarator),
      });
      continue;
    }
    for (const binding of bindingIdentifiers(target)) {
      declarations.push({
        name: binding.text,
        kind: 'variable',
        declarationKind,
        exported,
        range: astNodeRange(binding),
      });
    }
  }
}

/**
 * 接口只取方法签名：它们是可被实现、可被调用的成员。属性签名描述数据形状，
 * 数量巨大（DTO 接口）而不是导航或调用的目标，不产出符号。
 */
function collectInterfaceMethods(
  declaration: TreeSitterNode,
  declarations: SupplementalDeclaration[]
): void {
  const container = declaration.childForFieldName('name')?.text;
  const body = declaration.childForFieldName('body');
  if (!container || !body) {
    return;
  }
  for (const member of body.namedChildren) {
    const name = member.childForFieldName('name');
    // 计算属性名、调用签名、索引签名没有可引用的名字。
    if (member.type !== 'method_signature' || name?.type !== 'property_identifier') {
      continue;
    }
    declarations.push({
      name: name.text,
      kind: 'method',
      declarationKind: 'method',
      container,
      // 成员的可见性跟随接口本身，与类成员的口径一致：成员自己不带 export。
      exported: false,
      range: astNodeRange(member),
    });
  }
}

function isRequireCall(value: TreeSitterNode | null | undefined): boolean {
  if (value?.type !== 'call_expression') {
    return false;
  }
  const callee = value.childForFieldName('function');
  return callee?.type === 'identifier' && callee.text === 'require';
}

/** 解构模式里真正被绑定的标识符节点。 */
function bindingIdentifiers(pattern: TreeSitterNode): TreeSitterNode[] {
  if (['identifier', 'shorthand_property_identifier_pattern'].includes(pattern.type)) {
    return [pattern];
  }
  if (pattern.type === 'pair_pattern') {
    const value = pattern.childForFieldName('value');
    return value ? bindingIdentifiers(value) : [];
  }
  if (['assignment_pattern', 'object_assignment_pattern'].includes(pattern.type)) {
    const left = pattern.childForFieldName('left') ?? pattern.namedChild(0);
    return left ? bindingIdentifiers(left) : [];
  }
  if (['object_pattern', 'array_pattern', 'rest_pattern'].includes(pattern.type)) {
    return pattern.namedChildren.flatMap(bindingIdentifiers);
  }
  return [];
}
