import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { ProjectRegistry } from '../src/shared/ProjectRegistry.js';
import { collectAiEnv, WorkspaceSettingsStore } from '../src/shared/WorkspaceSettingsStore.js';

const ORIGINAL_ALEMBIC_HOME = process.env.ALEMBIC_HOME;
const ORIGINAL_PROJECT_DIR = process.env.ALEMBIC_PROJECT_DIR;
const ORIGINAL_PROVIDER = process.env.ALEMBIC_AI_PROVIDER;
const ORIGINAL_GOOGLE_KEY = process.env.ALEMBIC_GOOGLE_API_KEY;
const ORIGINAL_OPENAI_KEY = process.env.ALEMBIC_OPENAI_API_KEY;
const ORIGINAL_LEGACY_EMBED_PROVIDER = process.env.ALEMBIC_EMBED_PROVIDER;
const ORIGINAL_LEGACY_EMBED_MODEL = process.env.ALEMBIC_EMBED_MODEL;
const ORIGINAL_LEGACY_EMBED_BASE_URL = process.env.ALEMBIC_EMBED_BASE_URL;
const ORIGINAL_LEGACY_EMBED_KEY = process.env.ALEMBIC_EMBED_API_KEY;

function useTempAlembicHome(): void {
  process.env.ALEMBIC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-settings-home-'));
}

function makeProjectRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-settings-project-'));
}

afterEach(() => {
  if (ORIGINAL_ALEMBIC_HOME === undefined) {
    delete process.env.ALEMBIC_HOME;
  } else {
    process.env.ALEMBIC_HOME = ORIGINAL_ALEMBIC_HOME;
  }
  if (ORIGINAL_PROJECT_DIR === undefined) {
    delete process.env.ALEMBIC_PROJECT_DIR;
  } else {
    process.env.ALEMBIC_PROJECT_DIR = ORIGINAL_PROJECT_DIR;
  }
  if (ORIGINAL_PROVIDER === undefined) {
    delete process.env.ALEMBIC_AI_PROVIDER;
  } else {
    process.env.ALEMBIC_AI_PROVIDER = ORIGINAL_PROVIDER;
  }
  if (ORIGINAL_GOOGLE_KEY === undefined) {
    delete process.env.ALEMBIC_GOOGLE_API_KEY;
  } else {
    process.env.ALEMBIC_GOOGLE_API_KEY = ORIGINAL_GOOGLE_KEY;
  }
  if (ORIGINAL_OPENAI_KEY === undefined) {
    delete process.env.ALEMBIC_OPENAI_API_KEY;
  } else {
    process.env.ALEMBIC_OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  }
  if (ORIGINAL_LEGACY_EMBED_PROVIDER === undefined) {
    delete process.env.ALEMBIC_EMBED_PROVIDER;
  } else {
    process.env.ALEMBIC_EMBED_PROVIDER = ORIGINAL_LEGACY_EMBED_PROVIDER;
  }
  if (ORIGINAL_LEGACY_EMBED_MODEL === undefined) {
    delete process.env.ALEMBIC_EMBED_MODEL;
  } else {
    process.env.ALEMBIC_EMBED_MODEL = ORIGINAL_LEGACY_EMBED_MODEL;
  }
  if (ORIGINAL_LEGACY_EMBED_BASE_URL === undefined) {
    delete process.env.ALEMBIC_EMBED_BASE_URL;
  } else {
    process.env.ALEMBIC_EMBED_BASE_URL = ORIGINAL_LEGACY_EMBED_BASE_URL;
  }
  if (ORIGINAL_LEGACY_EMBED_KEY === undefined) {
    delete process.env.ALEMBIC_EMBED_API_KEY;
  } else {
    process.env.ALEMBIC_EMBED_API_KEY = ORIGINAL_LEGACY_EMBED_KEY;
  }
});

describe('WorkspaceSettingsStore', () => {
  test('stores non-secret AI settings separately from credentials in the ghost data root', () => {
    useTempAlembicHome();
    const projectRoot = makeProjectRoot();
    ProjectRegistry.register(projectRoot, true);
    const store = WorkspaceSettingsStore.fromProject(projectRoot);

    const result = store.writeAiConfig({
      ALEMBIC_AI_PROVIDER: 'google',
      ALEMBIC_AI_MODEL: 'gemini-3-flash-preview',
      ALEMBIC_GOOGLE_API_KEY: 'secret-google-key',
    });

    expect(result.env).toMatchObject({
      ALEMBIC_AI_PROVIDER: 'google',
      ALEMBIC_AI_MODEL: 'gemini-3-flash-preview',
      ALEMBIC_GOOGLE_API_KEY: 'secret-google-key',
    });
    expect(store.settingsPath).toContain(path.join('.asd', 'workspaces'));
    expect(store.settingsPath).not.toContain(projectRoot);
    expect(fs.existsSync(path.join(projectRoot, '.env'))).toBe(false);

    const settings = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8')) as {
      ai: Record<string, string>;
    };
    const secrets = JSON.parse(fs.readFileSync(store.secretsPath, 'utf8')) as {
      ai: { providerKeys: Record<string, string> };
    };

    expect(settings.ai).toMatchObject({
      provider: 'google',
      model: 'gemini-3-flash-preview',
    });
    expect(JSON.stringify(settings)).not.toContain('secret-google-key');
    expect(secrets.ai.providerKeys.google).toBe('secret-google-key');
  });

  test('follows registry mode without ordinary register changing settings data root', () => {
    useTempAlembicHome();
    const projectRoot = makeProjectRoot();
    const entry = ProjectRegistry.register(projectRoot, false);

    expect(WorkspaceSettingsStore.fromProject(projectRoot).settingsPath).toBe(
      path.join(projectRoot, '.asd', 'settings.json')
    );

    ProjectRegistry.register(projectRoot, true);
    expect(WorkspaceSettingsStore.fromProject(projectRoot).settingsPath).toBe(
      path.join(projectRoot, '.asd', 'settings.json')
    );

    ProjectRegistry.setWorkspaceMode(projectRoot, 'ghost');
    const ghostSettingsPath = WorkspaceSettingsStore.fromProject(projectRoot).settingsPath;
    expect(ghostSettingsPath).toContain(path.join('.asd', 'workspaces', entry.id));
    expect(ghostSettingsPath).not.toContain(projectRoot);
  });

  test('applies workspace settings without overriding explicit process env by default', () => {
    useTempAlembicHome();
    const projectRoot = makeProjectRoot();
    ProjectRegistry.register(projectRoot, true);
    const store = WorkspaceSettingsStore.fromProject(projectRoot);
    store.writeAiConfig({
      ALEMBIC_AI_PROVIDER: 'google',
      ALEMBIC_GOOGLE_API_KEY: 'secret-google-key',
    });
    process.env.ALEMBIC_AI_PROVIDER = 'openai';
    delete process.env.ALEMBIC_GOOGLE_API_KEY;

    store.applyToProcessEnv();

    expect(process.env.ALEMBIC_AI_PROVIDER).toBe('openai');
    expect(process.env.ALEMBIC_GOOGLE_API_KEY).toBe('secret-google-key');
  });

  test('applies workspace settings without reading project env files', () => {
    useTempAlembicHome();
    const projectRoot = makeProjectRoot();
    ProjectRegistry.register(projectRoot, true);
    fs.writeFileSync(
      path.join(projectRoot, '.env'),
      'ALEMBIC_AI_PROVIDER=openai\nALEMBIC_OPENAI_API_KEY=ignored-openai-key\n'
    );
    WorkspaceSettingsStore.fromProject(projectRoot).writeAiConfig({
      ALEMBIC_AI_PROVIDER: 'google',
      ALEMBIC_GOOGLE_API_KEY: 'secret-google-key',
    });
    process.env.ALEMBIC_PROJECT_DIR = projectRoot;
    delete process.env.ALEMBIC_AI_PROVIDER;
    delete process.env.ALEMBIC_GOOGLE_API_KEY;

    WorkspaceSettingsStore.fromProject(projectRoot).applyToProcessEnv();

    expect(process.env.ALEMBIC_AI_PROVIDER).toBe('google');
    expect(process.env.ALEMBIC_GOOGLE_API_KEY).toBe('secret-google-key');
    expect(process.env.ALEMBIC_OPENAI_API_KEY).toBeUndefined();
  });

  test('ignores legacy embedding settings while preserving normal AI provider settings', () => {
    useTempAlembicHome();
    const projectRoot = makeProjectRoot();
    ProjectRegistry.register(projectRoot, true);
    const store = WorkspaceSettingsStore.fromProject(projectRoot);

    fs.mkdirSync(path.dirname(store.settingsPath), { recursive: true });
    fs.writeFileSync(
      store.settingsPath,
      JSON.stringify(
        {
          ai: {
            provider: 'google',
            model: 'gemini-3-flash-preview',
            embedProvider: 'legacy-provider',
            embedModel: 'legacy-model',
            embedBaseUrl: 'http://legacy-embed.invalid',
          },
          version: 1,
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      store.secretsPath,
      JSON.stringify(
        {
          ai: {
            providerKeys: {
              google: 'secret-google-key',
            },
            embedApiKey: 'legacy-embed-secret',
          },
          version: 1,
        },
        null,
        2
      )
    );
    delete process.env.ALEMBIC_AI_PROVIDER;
    delete process.env.ALEMBIC_GOOGLE_API_KEY;
    delete process.env.ALEMBIC_EMBED_PROVIDER;
    delete process.env.ALEMBIC_EMBED_MODEL;
    delete process.env.ALEMBIC_EMBED_BASE_URL;
    delete process.env.ALEMBIC_EMBED_API_KEY;

    const readResult = store.readAiConfig();
    expect(readResult.env).toMatchObject({
      ALEMBIC_AI_PROVIDER: 'google',
      ALEMBIC_AI_MODEL: 'gemini-3-flash-preview',
      ALEMBIC_GOOGLE_API_KEY: 'secret-google-key',
    });
    expect(Object.keys(readResult.env).filter((key) => key.startsWith('ALEMBIC_EMBED_'))).toEqual(
      []
    );

    store.applyToProcessEnv({ override: true });
    expect(process.env.ALEMBIC_AI_PROVIDER).toBe('google');
    expect(process.env.ALEMBIC_GOOGLE_API_KEY).toBe('secret-google-key');
    expect(process.env.ALEMBIC_EMBED_PROVIDER).toBeUndefined();
    expect(process.env.ALEMBIC_EMBED_MODEL).toBeUndefined();
    expect(process.env.ALEMBIC_EMBED_BASE_URL).toBeUndefined();
    expect(process.env.ALEMBIC_EMBED_API_KEY).toBeUndefined();

    const processEnv = collectAiEnv({
      ALEMBIC_AI_PROVIDER: 'openai',
      ALEMBIC_EMBED_PROVIDER: 'legacy-provider',
      ALEMBIC_EMBED_MODEL: 'legacy-model',
      ALEMBIC_EMBED_BASE_URL: 'http://legacy-embed.invalid',
      ALEMBIC_EMBED_API_KEY: 'legacy-embed-secret',
    });
    expect(processEnv).toEqual({ ALEMBIC_AI_PROVIDER: 'openai' });

    const writeResult = store.writeAiConfig({
      ALEMBIC_AI_PROVIDER: 'openai',
      ALEMBIC_OPENAI_API_KEY: 'secret-openai-key',
      ALEMBIC_EMBED_PROVIDER: 'legacy-provider',
      ALEMBIC_EMBED_MODEL: 'legacy-model',
      ALEMBIC_EMBED_BASE_URL: 'http://legacy-embed.invalid',
      ALEMBIC_EMBED_API_KEY: 'legacy-embed-secret',
    });

    expect(Object.keys(writeResult.env).filter((key) => key.startsWith('ALEMBIC_EMBED_'))).toEqual(
      []
    );
    expect(JSON.stringify(JSON.parse(fs.readFileSync(store.settingsPath, 'utf8')))).not.toContain(
      'legacy-'
    );
    expect(JSON.stringify(JSON.parse(fs.readFileSync(store.secretsPath, 'utf8')))).not.toContain(
      'legacy-'
    );
  });
});
