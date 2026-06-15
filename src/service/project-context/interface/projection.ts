import type { ProjectContextResult } from '../../../domain/project-context/index.js';
import { redactProjectContextData } from './redaction.js';

export function projectCompactProjectContextData<T extends ProjectContextResult>(data: T): T {
  return redactProjectContextData(data);
}
