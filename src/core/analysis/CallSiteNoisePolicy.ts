/** 原有共享噪声集合；TS/JS证据保留原因，Python沿用原boolean过滤。 */
export function callSiteOmissionReason(
  callee: string,
  receiver: string | null
): string | undefined {
  // 常见内置调用噪声
  const NOISE_RECEIVERS = new Set([
    'console',
    'Math',
    'JSON',
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'Date',
    'RegExp',
    'Promise',
    'Set',
    'Map',
    'WeakMap',
    'WeakSet',
    'Symbol',
    'Reflect',
    'Proxy',
    'parseInt',
    'parseFloat',
  ]);

  const NOISE_CALLEES = new Set([
    'require',
    'import',
    'console',
    'log',
    'warn',
    'error',
    'info',
    'debug',
    'setTimeout',
    'setInterval',
    'clearTimeout',
    'clearInterval',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'alert',
    'confirm',
    'prompt',
    'print',
    'len',
    'range',
    'enumerate',
    'zip',
    'map',
    'filter',
    'isinstance',
    'issubclass',
    'hasattr',
    'getattr',
    'setattr',
    'str',
    'int',
    'float',
    'bool',
    'list',
    'dict',
    'tuple',
    'set',
    'type',
    'super',
    'property',
    'staticmethod',
    'classmethod',
  ]);

  if (receiver && NOISE_RECEIVERS.has(receiver)) {
    return 'noise-receiver';
  }
  if (callee && NOISE_CALLEES.has(callee)) {
    return 'noise-callee';
  }

  return undefined;
}

export function isNoiseCall(callee: string, receiver: string | null): boolean {
  return callSiteOmissionReason(callee, receiver) !== undefined;
}
