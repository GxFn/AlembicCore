/**
 * @module CallSiteExtractor
 * @description Phase 5: 从 AST 中提取调用点 (Call Sites)
 *
 * 采用 Post-walk extraction（方案 B）：在 walker 的 walk() 完成后，
 * 通过二次遍历提取调用点，零修改现有 walker 逻辑。
 *
 * 职责:
 *   - 从 statement_block/block 中提取 call_expression / new_expression
 *   - 解析 callee、receiver、callType、argCount 等
 *   - 关联到所在的 className + methodName (上下文推断)
 *
 * 支持语言:
 *   - TypeScript / JavaScript / TSX (P0)
 *   - Python (P0)
 *   - Go / Java / Kotlin (P1 — via lang plugin extractCallSites)
 */

import { isNoiseCall as _isNoiseCall } from './CallSiteNoisePolicy.js';
import { extractJsCallSites } from './JsCallSiteExtractor.js';

interface WalkerContext {
  callSites: CallSiteInfo[];
  callSiteEvidence?: CallSiteInfo[];
  [key: string]: unknown;
}

export interface CallSiteInfo {
  callee: string;
  callerMethod: string;
  callerClass: string | null;
  callType: 'function' | 'method' | 'constructor' | 'super' | 'static';
  receiver: string | null;
  receiverType: string | null;
  argCount: number;
  line: number;
  isAwait: boolean;
  /** 内部observer证据；不写入旧AstFileSummary.callSites记录。 */
  matchingRange?: CallSiteRange;
  callerRange?: CallSiteRange;
  callerQualifiedName?: string;
  calleeExpression?: string;
  syntaxKind?: 'call' | 'new' | 'jsx';
  omissionReason?: string;
  calleeShadowed?: boolean;
  calleeQualifiedName?: string;
  calleeBindingRange?: CallSiteRange;
  receiverSyntax?: string;
}

interface CallSiteRange {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

type CallType = CallSiteInfo['callType'];

/** TS/JS的结构证据和旧callSites投影共用同一遍历；其他语言规则留在本模块。 */
export function extractCallSitesTS(root: TreeSitterNode, ctx: WalkerContext, _lang: string) {
  extractJsCallSites(root, ctx);
}

// ── Python ─────────────────────────────────────────────────

/**
 * 从 Python AST root 中提取所有调用点
 *
 * @param root AST root 节点
 * @param ctx walker context
 * @param lang 语言标识
 */
export function extractCallSitesPython(root: TreeSitterNode, ctx: WalkerContext, lang: string) {
  const scopes = _collectPyScopes(root);

  for (const scope of scopes) {
    _extractPyCallSitesFromBody(scope.body, scope.className, scope.methodName, ctx);
  }
}

/**
 * 收集 Python 中所有函数/方法作用域
 *
 * @returns >}
 */
function _collectPyScopes(root: TreeSitterNode) {
  const scopes: { body: TreeSitterNode; className: string | null; methodName: string }[] = [];

  function walk(node: TreeSitterNode, className: string | null) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }

      switch (child.type) {
        case 'class_definition': {
          const name =
            child.namedChildren.find((c: TreeSitterNode) => c.type === 'identifier')?.text || null;
          const body = child.namedChildren.find((c: TreeSitterNode) => c.type === 'block');
          if (body && name) {
            walk(body, name);
          }
          break;
        }

        case 'function_definition': {
          const name =
            child.namedChildren.find((c: TreeSitterNode) => c.type === 'identifier')?.text ||
            'unknown';
          const body = child.namedChildren.find((c: TreeSitterNode) => c.type === 'block');
          if (body) {
            scopes.push({ body, className, methodName: name });
          }
          break;
        }

        case 'decorated_definition': {
          // decorator 后面跟着 function_definition 或 class_definition
          const actualDef = child.namedChildren.find(
            (c: TreeSitterNode) => c.type === 'class_definition' || c.type === 'function_definition'
          );
          if (actualDef?.type === 'class_definition') {
            const name =
              actualDef.namedChildren.find((c: TreeSitterNode) => c.type === 'identifier')?.text ||
              null;
            const body = actualDef.namedChildren.find((c: TreeSitterNode) => c.type === 'block');
            if (body && name) {
              walk(body, name);
            }
          } else if (actualDef?.type === 'function_definition') {
            const name =
              actualDef.namedChildren.find((c: TreeSitterNode) => c.type === 'identifier')?.text ||
              'unknown';
            const body = actualDef.namedChildren.find((c: TreeSitterNode) => c.type === 'block');
            if (body) {
              scopes.push({ body, className, methodName: name });
            }
          }
          break;
        }

        default: {
          if (child.namedChildCount > 0 && child.type !== 'block') {
            walk(child, className);
          }
        }
      }
    }
  }

  walk(root, null);
  return scopes;
}

/**
 * 从 Python 方法体中递归提取调用点
 *
 * @param bodyNode block 节点
 */
function _extractPyCallSitesFromBody(
  bodyNode: TreeSitterNode | null,
  className: string | null,
  methodName: string,
  ctx: WalkerContext
) {
  if (!bodyNode) {
    return;
  }

  function walk(node: TreeSitterNode, isAwaited: boolean) {
    // 跳过语法错误节点 (Issue #17: 防御性处理)
    if (!node || node.type === 'ERROR' || node.isMissing) {
      return;
    }

    if (node.type === 'await') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c) {
          walk(c, true);
        }
      }
      return;
    }

    if (node.type === 'call') {
      const callSite = _parsePyCallExpression(node, className, methodName, isAwaited);
      if (callSite) {
        ctx.callSites.push(callSite);
      }
      // 继续遍历参数中的嵌套调用
      const argList = node.namedChildren.find((c: TreeSitterNode) => c.type === 'argument_list');
      if (argList) {
        for (let i = 0; i < argList.namedChildCount; i++) {
          const c = argList.namedChild(i);
          if (c) {
            walk(c, false);
          }
        }
      }
      return;
    }

    // 递归子节点
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) {
        walk(c, false);
      }
    }
  }

  walk(bodyNode, false);
}

/**
 * 解析 Python 的 call 节点
 *
 * @param node call 节点
 */
function _parsePyCallExpression(
  node: TreeSitterNode,
  className: string | null,
  methodName: string,
  isAwaited: boolean
): CallSiteInfo | null {
  // Python call 节点: function 是第一个 named child
  const func = node.namedChildren[0];
  if (!func) {
    return null;
  }

  let callee: string;
  let receiver: string | null = null;
  let receiverType: string | null = null;
  let callType: CallType;

  if (func.type === 'attribute') {
    // obj.method() — method call
    const object = func.namedChildren.find(
      (c: TreeSitterNode) => c.type !== 'identifier' || c === func.namedChildren[0]
    );
    const prop = func.namedChildren.find(
      (c: TreeSitterNode) => c.type === 'identifier' && c !== func.namedChildren[0]
    );

    // attribute 节点结构: object.attribute — 第一个子节点是 object, 第二个是 attribute name
    const parts = func.text.split('.');
    if (parts.length >= 2) {
      receiver = parts.slice(0, -1).join('.');
      callee = parts[parts.length - 1];
    } else {
      receiver = object?.text || null;
      callee = prop?.text || func.text;
    }
    callType = 'method';

    // 推断 receiverType
    if (receiver === 'self') {
      receiverType = className;
    } else if (receiver === 'super()') {
      callType = 'super';
      receiverType = className;
    } else if (receiver && /^[A-Z]/.test(receiver)) {
      receiverType = receiver;
      callType = 'static';
    }
  } else if (func.type === 'identifier') {
    callee = func.text;
    // Python: 大写开头通常是类/构造函数
    if (/^[A-Z]/.test(callee)) {
      callType = 'constructor';
      receiverType = callee;
    } else {
      callType = 'function';
    }
  } else {
    callee = func.text?.slice(0, 80) || 'unknown';
    callType = 'function';
  }

  // 过滤噪声
  if (_isNoiseCall(callee, receiver)) {
    return null;
  }

  return {
    callee,
    callerMethod: methodName,
    callerClass: className,
    callType,
    receiver,
    receiverType,
    argCount: _countPyArgs(node),
    line: node.startPosition.row + 1,
    isAwait: isAwaited,
  };
}

// ── 通用提取器注册 ─────────────────────────────────────────

const _extractors = new Map([
  ['typescript', extractCallSitesTS],
  ['tsx', extractCallSitesTS],
  ['javascript', extractCallSitesTS],
  ['python', extractCallSitesPython],
]);

/** 获取特定语言的 CallSite 提取器 */
export function getCallSiteExtractor(lang: string) {
  return _extractors.get(lang) || null;
}

/**
 * 默认的 CallSite 提取器 — 用于无专门提取器的语言
 * 使用通用的 call_expression 匹配策略
 */
export function defaultExtractCallSites(root: TreeSitterNode, ctx: WalkerContext, lang: string) {
  // 对于未适配的语言，暂不提取（降级为空）
  // Phase 5.1 将逐步增加 Go / Rust / Java / Kotlin 等
}

// ── 工具函数 ───────────────────────────────────────────────

/** 计算参数数量 (Python) */
function _countPyArgs(node: TreeSitterNode): number {
  const args = node.namedChildren.find((c: TreeSitterNode) => c.type === 'argument_list');
  if (!args) {
    return 0;
  }
  return args.namedChildCount;
}
