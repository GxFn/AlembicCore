import path from 'node:path';
import type {
  DimensionDef,
  MissionBriefingResult,
  ProjectSnapshot,
} from '../../../../types/ProjectSnapshot.js';
import { toSessionCache } from '../../../../types/SnapshotViews.js';
import { buildLanguageExtension } from '../../presentation/LanguageExtensionBuilder.js';
import { buildMissionBriefing } from '../briefing/MissionBriefingBuilder.js';
import type { BriefingProfile, RescanBriefingInput } from '../briefing/MissionBriefingSupport.js';
import { getOrCreateSessionManager } from './SessionSupport.js';

export type HostAgentSessionContainer = Parameters<typeof getOrCreateSessionManager>[0];
export type HostAgentWorkflowSession = ReturnType<
  ReturnType<typeof getOrCreateSessionManager>['createSession']
>;
export type HostAgentMissionBriefingInput = Parameters<typeof buildMissionBriefing>[0];
export type HostAgentMissionBriefingResult = MissionBriefingResult;

export function createHostAgentWorkflowSession(opts: {
  container: HostAgentSessionContainer;
  projectRoot: string;
  dimensions: DimensionDef[];
  snapshot: ProjectSnapshot;
  primaryLang: string | null;
  fileCount: number;
  moduleCount: number;
}): HostAgentWorkflowSession {
  const sessionManager = getOrCreateSessionManager(opts.container);
  const session = sessionManager.createSession({
    projectRoot: opts.projectRoot,
    dimensions: opts.dimensions,
    projectContext: {
      projectName: path.basename(opts.projectRoot),
      primaryLang: opts.primaryLang,
      fileCount: opts.fileCount,
      modules: opts.moduleCount,
    },
  });
  session.setSnapshotCache(toSessionCache(opts.snapshot));
  return session;
}

export function buildHostAgentMissionBriefing(opts: {
  projectRoot: string;
  primaryLang: string | null;
  secondaryLanguages?: string[];
  isMultiLang?: boolean;
  fileCount: number;
  projectType: string;
  profile?: BriefingProfile;
  rescan?: RescanBriefingInput;
  briefing: Omit<
    HostAgentMissionBriefingInput,
    'projectMeta' | 'languageExtension' | 'profile' | 'rescan'
  >;
}): MissionBriefingResult {
  const projectMeta = {
    name: path.basename(opts.projectRoot),
    primaryLanguage: opts.primaryLang,
    secondaryLanguages: opts.secondaryLanguages || [],
    isMultiLang: opts.isMultiLang || false,
    fileCount: opts.fileCount,
    projectType: opts.projectType,
    projectRoot: opts.projectRoot,
  };

  return buildMissionBriefing({
    ...opts.briefing,
    profile: opts.profile,
    rescan: opts.rescan,
    projectMeta,
    languageExtension: buildLanguageExtension(opts.primaryLang),
  }) as MissionBriefingResult;
}

export function getActiveHostAgentWorkflowSession(
  container: HostAgentSessionContainer,
  sessionId?: string
): HostAgentWorkflowSession | null {
  const sessionManager = getOrCreateSessionManager(container);
  const session = sessionManager.getSession(sessionId);
  if (session) {
    return session;
  }

  if (sessionId) {
    const anySession = sessionManager.getAnySession();
    if (anySession && anySession.id === sessionId) {
      return anySession;
    }
  }

  return null;
}
