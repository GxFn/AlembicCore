const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|password|secret|token)/i;

export function redactProjectContextData<T>(data: T): T {
  return redactValue(data) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redactValue(item),
    ])
  );
}
