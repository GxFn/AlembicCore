/**
 * config.ts — 配置文件 Zod Schemas
 *
 * 为 default.json 和 constitution.yaml 提供运行时校验，
 * 在应用启动时尽早发现配置错误。
 *
 * @module shared/schemas/config
 */

import { z } from 'zod';

// ═══ default.json (App Config) ═══════════════════

const DatabaseConfig = z.object({
  type: z.enum(['sqlite']).default('sqlite'),
  path: z.string().default('./.asd/alembic.db'),
  verbose: z.boolean().default(false),
});

const CorsConfig = z.object({
  enabled: z.boolean().default(true),
  origin: z.string().default('*'),
});

const ServerConfig = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('localhost'),
  cors: CorsConfig.optional(),
});

const CacheConfig = z.object({
  mode: z.enum(['memory', 'redis', 'none']).default('memory'),
  ttl: z.number().int().min(0).default(300),
});

const MonitoringConfig = z.object({
  enabled: z.boolean().default(true),
  slowRequestThreshold: z.number().int().min(0).default(1000),
});

const FileLogConfig = z.object({
  enabled: z.boolean().default(true),
  path: z.string().default('./.asd/logs'),
});

const LoggingConfig = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  format: z.enum(['json', 'text']).default('json'),
  console: z.boolean().default(true),
  file: FileLogConfig.optional(),
});

const ConstitutionRefConfig = z.object({
  path: z.string().default('./config/constitution.yaml'),
  strictMode: z.boolean().default(true),
});

const AiConfig = z.object({
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).default(2000),
});

const HnswConfig = z.object({
  M: z.number().int().min(1).default(16),
  efConstruct: z.number().int().min(1).default(200),
  efSearch: z.number().int().min(1).default(100),
});

const VectorPersistenceConfig = z.object({
  format: z.enum(['binary', 'json']).default('binary'),
  flushIntervalMs: z.number().int().min(0).default(2000),
  flushBatchSize: z.number().int().min(1).default(100),
});

const HybridConfig = z.object({
  enabled: z.boolean().default(true),
  rrfK: z.number().int().min(1).default(60),
  alpha: z.number().min(0).max(1).default(0.5),
});

const VectorConfig = z.object({
  enabled: z.boolean().default(true),
  adapter: z.string().default('auto'),
  dimensions: z.number().int().min(1).default(768),
  indexPath: z.string().default('./data/vector-index'),
  hnsw: HnswConfig.optional(),
  quantize: z.string().default('auto'),
  quantizeThreshold: z.number().int().min(0).default(3000),
  persistence: VectorPersistenceConfig.optional(),
  hybrid: HybridConfig.optional(),
});

const QualityGateConfig = z.object({
  maxErrors: z.number().int().min(0).default(0),
  maxWarnings: z.number().int().min(0).default(20),
  minScore: z.number().int().min(0).max(100).default(70),
});

const RuleOverrideConfig = z.union([
  z.number().int().min(0),
  z.object({
    severity: z.string().optional(),
    exclude: z.array(z.string()).optional(),
  }),
]);

const GuardConfig = z.object({
  disabledRules: z.array(z.string()).default([]),
  codeLevelThresholds: z.record(z.string(), RuleOverrideConfig).default({}),
});

const TaskDecisionConfig = z.object({
  staleDays: z.number().int().min(1).default(30),
  maxActiveInPrime: z.number().int().min(1).default(20),
  maxStaleInPrime: z.number().int().min(0).default(10),
});

const TaskGraphConfig = z.object({
  decision: TaskDecisionConfig.optional(),
});

/**
 * App 配置 schema — 对应 config/default.json 合并结果
 *
 * 所有 section 是 optional，使用 .passthrough() 允许扩展字段。
 * 用 safeParse 做非阻塞校验（warning 级别），不会阻止启动。
 */
export const AppConfigSchema = z
  .object({
    database: DatabaseConfig.optional(),
    server: ServerConfig.optional(),
    cache: CacheConfig.optional(),
    monitoring: MonitoringConfig.optional(),
    logging: LoggingConfig.optional(),
    constitution: ConstitutionRefConfig.optional(),
    features: z.record(z.string(), z.boolean()).optional(),
    ai: AiConfig.optional(),
    vector: VectorConfig.optional(),
    qualityGate: QualityGateConfig.optional(),
    guard: GuardConfig.optional(),
    taskGraph: TaskGraphConfig.optional(),
  })
  .passthrough();

export type AppConfig = z.infer<typeof AppConfigSchema>;

// ═══ .asd/config.json (Workspace Runtime Config) ════════════

const WorkspaceRuntimeCoreConfigSchema = z
  .object({
    subRepoDir: z.string().min(1),
    subRepoUrl: z.string().min(1).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if ('dir' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'core.dir is stale; use core.subRepoDir',
        path: ['dir'],
      });
    }
    if ('constitution' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'core.constitution is stale',
        path: ['constitution'],
      });
    }
  });

/**
 * Runtime workspace config schema for `.asd/config.json` v2.
 *
 * This is intentionally separate from AppConfigSchema. The runtime config owns
 * project membership and sub-repository coordinates, while AppConfigSchema
 * still describes package/default application config.
 */
export const WorkspaceRuntimeConfigSchema = z
  .object({
    version: z.literal(2),
    projectName: z.string().min(1),
    database: z.string().min(1),
    core: WorkspaceRuntimeCoreConfigSchema,
    ai: AiConfig.optional(),
    cache: CacheConfig.optional(),
    features: z.record(z.string(), z.boolean()).optional(),
    guard: GuardConfig.optional(),
    logging: LoggingConfig.optional(),
    monitoring: MonitoringConfig.optional(),
    qualityGate: QualityGateConfig.optional(),
    server: ServerConfig.optional(),
    taskGraph: TaskGraphConfig.optional(),
    vector: VectorConfig.optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if ('watch' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'watch.* is stale and unsupported in workspace runtime config v2',
        path: ['watch'],
      });
    }
  });

export type WorkspaceRuntimeConfig = z.infer<typeof WorkspaceRuntimeConfigSchema>;

// ═══ constitution.yaml ═══════════════════════════

const ConstitutionCapability = z
  .object({
    description: z.string().optional(),
    probe: z.string().optional(),
  })
  .passthrough();

const ConstitutionRuleSchema = z.object({
  id: z.string().min(1, 'rule id is required'),
  check: z.string().min(1, 'rule check is required'),
  description: z.string().optional(),
});

const ConstitutionRoleSchema = z.object({
  id: z.string().min(1, 'role id is required'),
  name: z.string().min(1, 'role name is required'),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  requires_capability: z.array(z.string()).optional(),
});

/** Constitution schema — 对应 config/constitution.yaml */
export const ConstitutionSchema = z
  .object({
    version: z.string().optional(),
    effective_date: z.string().optional(),
    capabilities: z.record(z.string(), ConstitutionCapability).default({}),
    rules: z.array(ConstitutionRuleSchema).default([]),
    roles: z.array(ConstitutionRoleSchema).default([]),
    priorities: z.array(z.object({ id: z.number().int() }).passthrough()).optional(),
  })
  .passthrough();

export type ConstitutionConfigType = z.infer<typeof ConstitutionSchema>;
