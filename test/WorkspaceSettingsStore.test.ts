import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ProjectRegistry } from '../src/shared/ProjectRegistry.js';
import {
  AI_ENV_KEYS,
  collectAiEnv,
  maskAiEnvConfig,
  WorkspaceSettingsStore,
} from '../src/shared/WorkspaceSettingsStore.js';

const originalEnvironment = new Map(
  ['ALEMBIC_HOME', 'ALEMBIC_PROJECT_DIR', ...AI_ENV_KEYS].map((key) => [key, process.env[key]])
);
const temporaryRoots: string[] = [];

function createTemporaryRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function useTempAlembicHome(): void {
  process.env.ALEMBIC_HOME = createTemporaryRoot('alembic-settings-home-');
}

function makeProjectRoot(): string {
  return createTemporaryRoot('alembic-settings-project-');
}

beforeEach(() => {
  // 测试只使用显式夹具配置，避免继承或泄露运行测试者的真实凭据。
  for (const key of AI_ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('WorkspaceSettingsStore', () => {
  test.each([
    'settingsPath',
    'secretsPath',
  ] as const)('does not overwrite unreadable %s during an unrelated update', (field) => {
    useTempAlembicHome();
    const store = WorkspaceSettingsStore.fromProject(makeProjectRoot());
    store.writeAiConfig({
      ALEMBIC_AI_PROVIDER: 'google',
      ALEMBIC_GOOGLE_API_KEY: 'fixture-only-key',
    });
    fs.writeFileSync(store[field], '{ invalid json');
    const before = [store.settingsPath, store.secretsPath].map((file) =>
      fs.readFileSync(file, 'utf8')
    );
    expect(() => store.readAiConfig()).not.toThrow();
    expect(() => store.writeAiConfig({ ALEMBIC_AI_MODEL: 'new-model' })).toThrow(
      'Cannot update workspace configuration'
    );
    expect(
      [store.settingsPath, store.secretsPath].map((file) => fs.readFileSync(file, 'utf8'))
    ).toEqual(before);
  });

  test('ignores unknown config keys even when they name inherited object members', () => {
    useTempAlembicHome();
    const store = WorkspaceSettingsStore.fromProject(makeProjectRoot());
    store.writeAiConfig(
      JSON.parse('{"constructor":"ignored","__proto__":"ignored","toString":"ignored"}')
    );
    expect(JSON.parse(fs.readFileSync(store.settingsPath, 'utf8')).ai).toEqual({});
    expect(fs.existsSync(store.secretsPath)).toBe(false);
  });

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

  test('persists embedding settings alongside main AI settings (single config source)', () => {
    useTempAlembicHome();
    const projectRoot = makeProjectRoot();
    ProjectRegistry.register(projectRoot, true);
    const store = WorkspaceSettingsStore.fromProject(projectRoot);
    delete process.env.ALEMBIC_AI_PROVIDER;
    delete process.env.ALEMBIC_GOOGLE_API_KEY;
    delete process.env.ALEMBIC_EMBED_PROVIDER;
    delete process.env.ALEMBIC_EMBED_MODEL;
    delete process.env.ALEMBIC_EMBED_BASE_URL;
    delete process.env.ALEMBIC_EMBED_API_KEY;

    const writeResult = store.writeAiConfig({
      ALEMBIC_AI_PROVIDER: 'deepseek',
      ALEMBIC_DEEPSEEK_API_KEY: 'secret-deepseek-key',
      ALEMBIC_EMBED_PROVIDER: 'ollama',
      ALEMBIC_EMBED_MODEL: 'qwen3-embedding:0.6b',
      ALEMBIC_EMBED_BASE_URL: 'http://127.0.0.1:11434',
      ALEMBIC_EMBED_API_KEY: 'secret-embed-key',
    });

    expect(writeResult.env).toMatchObject({
      ALEMBIC_AI_PROVIDER: 'deepseek',
      ALEMBIC_DEEPSEEK_API_KEY: 'secret-deepseek-key',
      ALEMBIC_EMBED_PROVIDER: 'ollama',
      ALEMBIC_EMBED_MODEL: 'qwen3-embedding:0.6b',
      ALEMBIC_EMBED_BASE_URL: 'http://127.0.0.1:11434',
      ALEMBIC_EMBED_API_KEY: 'secret-embed-key',
    });

    // 持久化分家：非密钥入 settings.json，embedding 密钥只入 secrets.json
    const settings = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8')) as {
      ai: Record<string, string>;
    };
    expect(settings.ai).toMatchObject({
      provider: 'deepseek',
      embedProvider: 'ollama',
      embedModel: 'qwen3-embedding:0.6b',
      embedBaseUrl: 'http://127.0.0.1:11434',
    });
    expect(JSON.stringify(settings)).not.toContain('secret-');
    const secrets = JSON.parse(fs.readFileSync(store.secretsPath, 'utf8')) as {
      ai: { providerKeys: Record<string, string>; embedApiKey?: string };
    };
    expect(secrets.ai.providerKeys.deepseek).toBe('secret-deepseek-key');
    expect(secrets.ai.embedApiKey).toBe('secret-embed-key');

    // 重启等价：新实例重读仍在（长期记录）
    const reread = WorkspaceSettingsStore.fromProject(projectRoot).readAiConfig();
    expect(reread.env.ALEMBIC_EMBED_PROVIDER).toBe('ollama');
    expect(reread.env.ALEMBIC_EMBED_API_KEY).toBe('secret-embed-key');

    // 启动链：applyToProcessEnv 与主 AI 同链带入 embed
    WorkspaceSettingsStore.fromProject(projectRoot).applyToProcessEnv();
    expect(process.env.ALEMBIC_EMBED_PROVIDER).toBe('ollama');
    expect(process.env.ALEMBIC_EMBED_MODEL).toBe('qwen3-embedding:0.6b');
    expect(process.env.ALEMBIC_EMBED_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(process.env.ALEMBIC_EMBED_API_KEY).toBe('secret-embed-key');

    // collectAiEnv 认 embed 键（import-env / env override 同链）
    expect(collectAiEnv({ ALEMBIC_EMBED_PROVIDER: 'ollama' })).toEqual({
      ALEMBIC_EMBED_PROVIDER: 'ollama',
    });

    // embedding 密钥按密钥打码
    expect(maskAiEnvConfig({ ALEMBIC_EMBED_API_KEY: 'secret-embed-key' })).toEqual({
      ALEMBIC_EMBED_API_KEY: 'se...-key',
    });
  });

  test('revives embed fields already present in persisted files and no longer strips them', () => {
    useTempAlembicHome();
    const projectRoot = makeProjectRoot();
    ProjectRegistry.register(projectRoot, true);
    const store = WorkspaceSettingsStore.fromProject(projectRoot);

    // 预置早期版本落盘的 embed 字段（形状与现行一致）：现在作为一等配置直接读出
    fs.mkdirSync(path.dirname(store.settingsPath), { recursive: true });
    fs.writeFileSync(
      store.settingsPath,
      JSON.stringify(
        {
          ai: {
            provider: 'google',
            model: 'gemini-3-flash-preview',
            embedProvider: 'ollama',
            embedModel: 'qwen3-embedding:0.6b',
            embedBaseUrl: 'http://127.0.0.1:11434',
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
            embedApiKey: 'persisted-embed-secret',
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
      ALEMBIC_GOOGLE_API_KEY: 'secret-google-key',
      ALEMBIC_EMBED_PROVIDER: 'ollama',
      ALEMBIC_EMBED_MODEL: 'qwen3-embedding:0.6b',
      ALEMBIC_EMBED_BASE_URL: 'http://127.0.0.1:11434',
      ALEMBIC_EMBED_API_KEY: 'persisted-embed-secret',
    });

    // 无关字段的普通写入不得剥离既有 embed 配置
    store.writeAiConfig({ ALEMBIC_AI_MODEL: 'gemini-3-pro' });
    const settings = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8')) as {
      ai: Record<string, string>;
    };
    expect(settings.ai.embedProvider).toBe('ollama');
    expect(settings.ai.embedModel).toBe('qwen3-embedding:0.6b');
    expect(settings.ai.embedBaseUrl).toBe('http://127.0.0.1:11434');
    const secrets = JSON.parse(fs.readFileSync(store.secretsPath, 'utf8')) as {
      ai: { embedApiKey?: string };
    };
    expect(secrets.ai.embedApiKey).toBe('persisted-embed-secret');
  });
});
