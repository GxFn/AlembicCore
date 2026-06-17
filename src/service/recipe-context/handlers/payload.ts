// Defensive payload readers shared by the RecipeContext handlers. Inbound
// payloads are untrusted (they originate from MCP tool calls), so each reader
// returns undefined on a type mismatch rather than throwing.

import type {
  RecipeMetadataFilter,
  RecipeSourceRefLineRange,
} from '../../../domain/recipe-context/index.js';

type Payload = Record<string, unknown>;

export function readString(payload: Payload, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readNumber(payload: Payload, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(payload: Payload, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(payload: Payload, key: string): string[] | undefined {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

const FILTER_STRING_KEYS = [
  'category',
  'dimensionId',
  'scope',
  'language',
  'knowledgeType',
  'kind',
  'lifecycle',
  'moduleName',
] as const;

export function readFilter(payload: Payload, key = 'filter'): RecipeMetadataFilter | undefined {
  const raw = payload[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const source = raw as Payload;
  const filter: RecipeMetadataFilter = {};
  for (const field of FILTER_STRING_KEYS) {
    const value = readString(source, field);
    if (value !== undefined) {
      filter[field] = value;
    }
  }
  const tags = readStringArray(source, 'tags');
  if (tags) {
    filter.tags = tags;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export function readLineRange(
  payload: Payload,
  key = 'lineRange'
): RecipeSourceRefLineRange | undefined {
  const raw = payload[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const source = raw as Payload;
  const start = readNumber(source, 'start');
  const end = readNumber(source, 'end');
  if (start === undefined && end === undefined) {
    return undefined;
  }
  return { start, end };
}

export function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  const candidate = value === undefined ? fallback : Math.floor(value);
  if (Number.isNaN(candidate)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, candidate));
}
