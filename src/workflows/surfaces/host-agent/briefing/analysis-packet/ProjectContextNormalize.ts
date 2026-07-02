import {
  buildProjectContextPresenterInput,
  type ProjectContextEnvelope,
  type ProjectContextPresenterInput,
  type ProjectContextResult,
} from '../../../../../domain/project-context/index.js';

export function normalizeProjectContextPresenterInput(
  input: ProjectContextPresenterInput | readonly ProjectContextEnvelope<ProjectContextResult>[]
): ProjectContextPresenterInput {
  return 'project' in input ? input : buildProjectContextPresenterInput(input);
}
