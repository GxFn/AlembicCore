import {
  buildProjectContextPresenterInput,
  type ProjectContextEnvelope,
  type ProjectContextPresenterInput,
  type ProjectContextRef,
  type ProjectContextResult,
  type ProjectMap,
  type RelationSummary,
  type RepoContext,
  type SymbolSummary,
} from '../../../domain/project-context/index.js';
import { LanguageProfiles } from '../../../shared/LanguageProfiles.js';
import type {
  ArchitectureDomain,
  ArchitectureEvidence,
  ArchitectureEvidenceSource,
  ArchitectureGraphSnapshot,
  ArchitectureIntelligenceInput,
  ArchitectureIntelligenceReport,
  ArchitectureKnowledgeEdgeSnapshot,
  ArchitectureStyle,
  ArchitectureStyleReport,
  ComplexityReport,
  DomainSignal,
  DomainSignalReport,
  ModuleComplexityMetric,
  ModuleDomainSignal,
  ProjectInformationSupplementReport,
} from './contracts.js';

export type * from './contracts.js';

export const ARCHITECTURE_DOMAINS: readonly ArchitectureDomain[] = [
  'auth',
  'api',
  'ui',
  'database',
  'concurrency',
  'security',
  'observability',
  'error-handling',
  'testing',
] as const;

const DOMAIN_PRESENT_THRESHOLD = 0.35;
const MODULE_PRESENT_THRESHOLD = 0.28;

const CATEGORY_TO_DOMAINS: Readonly<Record<string, readonly ArchitectureDomain[]>> = {
  networking: ['api'],
  http: ['api'],
  api: ['api'],
  web: ['api'],
  server: ['api'],
  ui: ['ui'],
  image: ['ui'],
  frontend: ['ui'],
  storage: ['database'],
  database: ['database'],
  persistence: ['database'],
  orm: ['database'],
  reactive: ['concurrency'],
  queue: ['concurrency'],
  async: ['concurrency'],
  testing: ['testing'],
  test: ['testing'],
  logging: ['observability'],
  observability: ['observability'],
  telemetry: ['observability'],
  security: ['security'],
  crypto: ['security'],
  auth: ['auth'],
  authentication: ['auth'],
};

const DOMAIN_TEXT_PATTERNS: Readonly<Record<ArchitectureDomain, readonly RegExp[]>> = {
  auth: [
    /\bauth(?:entication|orization)?\b/i,
    /\blogin\b/i,
    /\bsession\b/i,
    /\btoken\b/i,
    /\bjwt\b/i,
    /\boauth\b/i,
    /\bpassport\b/i,
  ],
  api: [
    /\bapi\b/i,
    /\bhttp\b/i,
    /\brest\b/i,
    /\bgrpc\b/i,
    /\bcontroller\b/i,
    /\broute\b/i,
    /\bendpoint\b/i,
    /\bserver\b/i,
    /\brequest\b/i,
    /\bresponse\b/i,
  ],
  ui: [
    /\bui\b/i,
    /\bview\b/i,
    /\bscreen\b/i,
    /\bcomponent\b/i,
    /\bwidget\b/i,
    /\bpage\b/i,
    /\breact\b/i,
    /\bvue\b/i,
    /\bsvelte\b/i,
    /\bswiftui\b/i,
  ],
  database: [
    /\bdb\b/i,
    /\bdatabase\b/i,
    /\brepository\b/i,
    /\bentity\b/i,
    /\bschema\b/i,
    /\bmigration\b/i,
    /\bquery\b/i,
    /\bprisma\b/i,
    /\bdrizzle\b/i,
    /\bpostgres\b/i,
    /\bmysql\b/i,
  ],
  concurrency: [
    /\basync\b/i,
    /\bawait\b/i,
    /\bworker\b/i,
    /\bqueue\b/i,
    /\bjob\b/i,
    /\bthread\b/i,
    /\bmutex\b/i,
    /\bactor\b/i,
    /\bchannel\b/i,
    /\bstream\b/i,
    /\bobservable\b/i,
  ],
  security: [
    /\bsecurity\b/i,
    /\bcrypto\b/i,
    /\bcrypt\b/i,
    /\bencrypt\b/i,
    /\bdecrypt\b/i,
    /\bhash\b/i,
    /\bpermission\b/i,
    /\bpolicy\b/i,
    /\bsecret\b/i,
    /\bcsrf\b/i,
    /\bxss\b/i,
  ],
  observability: [
    /\blog(?:ger|ging)?\b/i,
    /\bmetric\b/i,
    /\btrace\b/i,
    /\bspan\b/i,
    /\btelemetry\b/i,
    /\bmonitor\b/i,
    /\baudit\b/i,
    /\bsentry\b/i,
    /\botel\b/i,
  ],
  'error-handling': [
    /error/i,
    /exception/i,
    /failure/i,
    /retry/i,
    /fallback/i,
    /circuit/i,
    /boundary/i,
  ],
  testing: [
    /\btest\b/i,
    /\bspec\b/i,
    /\bmock\b/i,
    /\bfixture\b/i,
    /\bassert\b/i,
    /\bexpect\b/i,
    /\bvitest\b/i,
    /\bjest\b/i,
    /\bxctest\b/i,
  ],
};

const CONFIG_KIND_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  domains: readonly ArchitectureDomain[];
}> = [
  { pattern: /vite|webpack|rollup|next|nuxt|svelte|index\.html/i, domains: ['ui'] },
  { pattern: /jest|vitest|mocha|pytest|xctest|testing/i, domains: ['testing'] },
  { pattern: /docker|compose|k8s|kubernetes|helm/i, domains: ['api'] },
  { pattern: /openapi|swagger|routes?|nginx|server/i, domains: ['api'] },
  {
    pattern: /prisma|drizzle|sequelize|typeorm|migration|database|postgres|mysql/i,
    domains: ['database'],
  },
  { pattern: /sentry|otel|opentelemetry|prometheus|grafana|logging/i, domains: ['observability'] },
  { pattern: /auth|oauth|jwt|passport/i, domains: ['auth', 'security'] },
  { pattern: /security|snyk|cert|secret|crypto/i, domains: ['security'] },
  { pattern: /worker|queue|bull|celery|sidekiq/i, domains: ['concurrency'] },
];

interface ModuleFact {
  id: string;
  name: string;
  files: Set<string>;
  role?: string;
  roleConfidence?: number;
  configLayer?: string;
  ref?: ProjectContextRef;
}

interface NormalizedFacts {
  presenter: ProjectContextPresenterInput;
  graph: ArchitectureGraphSnapshot;
  modules: ModuleFact[];
  fileToModule: Map<string, ModuleFact>;
  projectRoot: string;
}

interface SignalBucket {
  score: number;
  evidence: ArchitectureEvidence[];
}

type SignalBuckets = Map<ArchitectureDomain, SignalBucket>;

interface ModuleEdgeMetrics {
  fanIn: number;
  fanOut: number;
}

interface ModuleEdgeMetricsReport {
  edgeCount: number;
  metricsByModule: Map<string, ModuleEdgeMetrics>;
}

export class DomainSignalDetector {
  detect(input: ArchitectureIntelligenceInput): DomainSignalReport {
    const facts = normalizeFacts(input);
    const projectBuckets: SignalBuckets = new Map();
    const moduleBuckets = new Map<string, SignalBuckets>();

    const add = (domain: ArchitectureDomain, evidence: ArchitectureEvidence) => {
      addSignal(projectBuckets, domain, evidence);
      if (evidence.moduleId) {
        const buckets = getOrCreate(moduleBuckets, evidence.moduleId, () => new Map());
        addSignal(buckets, domain, evidence);
      }
    };

    collectImportEvidence(facts, add);
    collectSymbolEvidence(facts, add);
    collectConfigEvidence(facts, add);
    collectManifestEvidence(facts, add);
    collectGraphEvidence(facts, add);

    const domains = ARCHITECTURE_DOMAINS.map((domain): DomainSignal => {
      const bucket = projectBuckets.get(domain) ?? { score: 0, evidence: [] };
      const moduleSignals: ModuleDomainSignal[] = facts.modules
        .map((module): ModuleDomainSignal => {
          const moduleBucket = moduleBuckets.get(module.id)?.get(domain) ?? {
            score: 0,
            evidence: [],
          };
          return {
            moduleId: module.id,
            moduleName: module.name,
            domain,
            present: moduleBucket.score >= MODULE_PRESENT_THRESHOLD,
            confidence: clampConfidence(moduleBucket.score),
            evidence: sortEvidence(moduleBucket.evidence),
          };
        })
        .filter((signal) => signal.present || signal.evidence.length > 0);

      return {
        domain,
        present: bucket.score >= DOMAIN_PRESENT_THRESHOLD,
        confidence: clampConfidence(bucket.score),
        evidence: sortEvidence(bucket.evidence),
        moduleSignals,
      };
    });

    return {
      domains,
      projectPresentDomains: domains
        .filter((signal) => signal.present)
        .map((signal) => signal.domain),
      evidenceCount: domains.reduce((sum, signal) => sum + signal.evidence.length, 0),
    };
  }
}

export class ProjectInformationSupplementAnalyzer {
  analyze(
    _input: ArchitectureIntelligenceInput,
    _domains?: DomainSignalReport
  ): ProjectInformationSupplementReport {
    return {
      panoramaServiceFree: true,
    };
  }
}

export class ArchitectureStyleClassifier {
  classify(
    input: ArchitectureIntelligenceInput,
    domains?: DomainSignalReport,
    _supplements?: ProjectInformationSupplementReport
  ): ArchitectureStyleReport {
    const facts = normalizeFacts(input);
    const effectiveDomains = domains ?? new DomainSignalDetector().detect(input);
    const styleBuckets = new Map<ArchitectureStyle, SignalBucket>();
    const addStyle = (style: ArchitectureStyle, label: string, weight: number) => {
      addStyleEvidence(styleBuckets, style, evidence('derived', label, weight));
    };
    const map = facts.presenter.map;
    const repo = facts.presenter.repo;
    const edgeMetrics = collectModuleEdgeMetrics(facts);
    const moduleCount =
      map?.modules.length ?? facts.modules.length ?? facts.graph.modules?.length ?? 0;
    const edgeCount = map?.dependencySummary.edgeCount ?? edgeMetrics.edgeCount;
    const cycleCount = map?.cycles.length ?? 0;
    const layerCount = map?.layers.length ?? 0;
    const density =
      moduleCount > 1 ? edgeCount / Math.max(1, moduleCount * Math.max(1, moduleCount - 1)) : 0;

    for (const entrypoint of repo?.entrypoints ?? []) {
      const text = `${entrypoint.name} ${entrypoint.kind}`.toLowerCase();
      if (/cli|command/.test(text)) {
        addStyleEvidence(
          styleBuckets,
          'cli',
          evidence(
            'project-context-map',
            `entrypoint:${entrypoint.name}:${entrypoint.kind}`,
            0.75,
            {
              ref: entrypoint.refs[0],
            }
          )
        );
      }
      if (/library|package|sdk/.test(text)) {
        addStyleEvidence(
          styleBuckets,
          'library',
          evidence(
            'project-context-map',
            `entrypoint:${entrypoint.name}:${entrypoint.kind}`,
            0.65,
            {
              ref: entrypoint.refs[0],
            }
          )
        );
      }
      if (/plugin|extension/.test(text)) {
        addStyleEvidence(
          styleBuckets,
          'plugin',
          evidence(
            'project-context-map',
            `entrypoint:${entrypoint.name}:${entrypoint.kind}`,
            0.65,
            {
              ref: entrypoint.refs[0],
            }
          )
        );
      }
      if (/server|http|api/.test(text)) {
        addStyleEvidence(
          styleBuckets,
          'backend',
          evidence('project-context-map', `entrypoint:${entrypoint.name}:${entrypoint.kind}`, 0.7, {
            ref: entrypoint.refs[0],
          })
        );
      }
    }

    for (const command of repo?.commands ?? []) {
      if (/cli|command|start|dev|serve/.test(`${command.name} ${command.command}`.toLowerCase())) {
        addStyleEvidence(
          styleBuckets,
          'cli',
          evidence('project-context-config', `command:${command.name}`, 0.35, {
            ref: command.sourceRef,
          })
        );
      }
    }

    const presentDomains = new Set(effectiveDomains.projectPresentDomains);
    if (presentDomains.has('ui')) {
      addStyle('frontend', 'ui-domain-signal', 0.45);
    }
    if (presentDomains.has('api')) {
      addStyle('backend', 'api-domain-signal', 0.45);
    }
    if (layerCount >= 2 && cycleCount === 0) {
      addStyle('layered', `layers:${layerCount}:acyclic`, 0.55);
    }
    if (moduleCount <= 2 && moduleCount > 0 && edgeCount > 0) {
      addStyle('monolith', `small-module-count:${moduleCount}`, 0.45);
    }
    if (cycleCount > 0 || density >= 0.45) {
      addStyle(
        'monolith',
        `dense-dependency-signals:density=${density.toFixed(2)} cycles=${cycleCount}`,
        0.45
      );
    }
    if (
      moduleCount >= 6 &&
      density <= 0.25 &&
      hasConfig(facts.presenter.repo, /docker|k8s|kubernetes|helm|compose/i)
    ) {
      addStyle('microservices', `module-count:${moduleCount}:deployment-config`, 0.55);
    }
    if (
      countEdgesByRelation(facts.graph, 'data_flow') > countEdgesByRelation(facts.graph, 'calls')
    ) {
      addStyle('event-driven', 'data-flow-dominates-call-flow', 0.55);
    }
    if (
      facts.modules.some((module) =>
        /plugin|extension/i.test(`${module.name} ${module.role ?? ''}`)
      ) ||
      (moduleCount <= 3 &&
        Math.max(...[...edgeMetrics.metricsByModule.values()].map((metric) => metric.fanIn), 0) >=
          3)
    ) {
      addStyle('plugin', 'plugin-module-or-core-fanin', 0.45);
    }
    if ((repo?.packageSystems.length ?? 0) > 0 && (repo?.entrypoints.length ?? 0) === 0) {
      addStyle('library', 'package-system-without-runtime-entrypoint', 0.35);
    }

    const knownStyleIds = [
      'monolith',
      'layered',
      'microservices',
      'event-driven',
      'cli',
      'library',
      'plugin',
      'frontend',
      'backend',
    ] as const;
    const styles = knownStyleIds.map((style) => {
      const bucket = styleBuckets.get(style) ?? { score: 0, evidence: [] };
      return {
        style,
        present: bucket.score >= 0.35,
        confidence: clampConfidence(bucket.score),
        evidence: sortEvidence(bucket.evidence),
      };
    });
    const presentStyles = styles.filter((style) => style.present);
    const primary = [...presentStyles].sort((a, b) => b.confidence - a.confidence)[0];
    const unknown = {
      style: 'unknown' as const,
      present: primary === undefined,
      confidence: 0,
      evidence: [],
    };

    return {
      primary: primary?.style ?? 'unknown',
      confidence: primary?.confidence ?? 0,
      styles: [unknown, ...styles],
    };
  }
}

export class ComplexityAnalyzer {
  analyze(
    input: ArchitectureIntelligenceInput,
    _supplements?: ProjectInformationSupplementReport
  ): ComplexityReport {
    const facts = normalizeFacts(input);
    const edgeMetrics = collectModuleEdgeMetrics(facts);
    const cycleCounts = new Map<string, number>();
    const hotspotScores = collectHotspotScores(facts.presenter.map);
    const moduleMetrics = facts.modules.map((module): ModuleComplexityMetric => {
      const fileCount =
        module.files.size ||
        facts.presenter.modules.find((candidate) => candidate.module.id === module.id)?.ownedFiles
          .length ||
        0;
      const lineCount = sumModuleLines(facts.presenter, module);
      const fan = edgeMetrics.metricsByModule.get(module.id) ?? { fanIn: 0, fanOut: 0 };
      const cycleCount = cycleCounts.get(module.id) ?? 0;
      const hotspotScore = hotspotScores.get(module.id) ?? hotspotScores.get(module.name) ?? 0;
      const complexityScore =
        lineCount / 180 +
        fileCount * 0.35 +
        fan.fanIn * 0.7 +
        fan.fanOut * 0.55 +
        cycleCount * 2 +
        hotspotScore / 20;
      return {
        moduleId: module.id,
        moduleName: module.name,
        fileCount,
        lineCount,
        fanIn: fan.fanIn,
        fanOut: fan.fanOut,
        cycleCount,
        hotspotScore,
        complexityScore: round(complexityScore),
        severity: severityFor(complexityScore, 4, 8),
        evidence: moduleComplexityEvidence(
          module,
          lineCount,
          fileCount,
          fan,
          cycleCount,
          hotspotScore
        ),
      };
    });

    const fileCount = new Set([
      ...facts.presenter.files.map((file) => file.filePath),
      ...facts.presenter.modules.flatMap((module) =>
        module.ownedFiles.map((file) => file.filePath)
      ),
    ]).size;
    const lineCount = facts.presenter.files.reduce((sum, file) => sum + (file.lineCount ?? 0), 0);
    const dependencyEdgeCount =
      facts.presenter.map?.dependencySummary.edgeCount ?? edgeMetrics.edgeCount;
    const cycleCount = facts.presenter.map?.cycles.length ?? 0;
    const hotspotCount = Math.max(
      facts.presenter.map?.hotspots.length ?? 0,
      moduleMetrics.filter((metric) => metric.severity === 'high').length
    );
    const projectScore =
      moduleMetrics.reduce((sum, metric) => sum + metric.complexityScore, 0) /
        Math.max(1, moduleMetrics.length) +
      cycleCount * 2 +
      hotspotCount * 0.7 +
      dependencyEdgeCount / Math.max(1, facts.modules.length);

    return {
      project: {
        moduleCount: facts.modules.length,
        fileCount,
        lineCount,
        dependencyEdgeCount,
        cycleCount,
        hotspotCount,
        complexityScore: round(projectScore),
        severity: severityFor(projectScore, 5, 10),
      },
      modules: moduleMetrics,
      hotspots: [...moduleMetrics]
        .filter(
          (metric) => metric.severity !== 'low' || metric.hotspotScore > 0 || metric.cycleCount > 0
        )
        .sort((a, b) => b.complexityScore - a.complexityScore),
    };
  }
}

export function analyzeArchitectureIntelligence(
  input: ArchitectureIntelligenceInput
): ArchitectureIntelligenceReport {
  const domainDetector = new DomainSignalDetector();
  const supplementsAnalyzer = new ProjectInformationSupplementAnalyzer();
  const styleClassifier = new ArchitectureStyleClassifier();
  const complexityAnalyzer = new ComplexityAnalyzer();
  const domains = domainDetector.detect(input);
  const supplements = supplementsAnalyzer.analyze(input, domains);
  const styles = styleClassifier.classify(input, domains, supplements);
  const complexity = complexityAnalyzer.analyze(input, supplements);

  return {
    domains,
    styles,
    complexity,
    supplements,
  };
}

export function analyzeArchitectureIntelligenceFromProjectContext(
  projectContext:
    | ProjectContextPresenterInput
    | readonly ProjectContextEnvelope<ProjectContextResult>[],
  options: Omit<ArchitectureIntelligenceInput, 'projectContext'> = {}
): ArchitectureIntelligenceReport {
  return analyzeArchitectureIntelligence({ ...options, projectContext });
}

function normalizeFacts(input: ArchitectureIntelligenceInput): NormalizedFacts {
  const presenter = normalizePresenter(input.projectContext, input.projectRoot);
  const graph = input.graph ?? {};
  const modules = collectModules(presenter, graph);
  const fileToModule = buildFileToModule(modules);
  return {
    presenter,
    graph,
    modules,
    fileToModule,
    projectRoot: input.projectRoot ?? presenter.project.projectRoot,
  };
}

function normalizePresenter(
  input: ArchitectureIntelligenceInput['projectContext'],
  projectRoot = ''
): ProjectContextPresenterInput {
  if (!input) {
    return emptyPresenter(projectRoot);
  }
  if (isProjectContextEnvelopeList(input)) {
    return buildProjectContextPresenterInput(input);
  }
  return input;
}

function isProjectContextEnvelopeList(
  input: ArchitectureIntelligenceInput['projectContext']
): input is readonly ProjectContextEnvelope<ProjectContextResult>[] {
  return Array.isArray(input);
}

function emptyPresenter(projectRoot: string): ProjectContextPresenterInput {
  return {
    project: { projectRoot },
    envelopes: [],
    refs: [],
    files: [],
    warnings: [],
    unavailable: [],
    modules: [],
    moduleLayers: [],
    fileFlows: [],
    fileSymbols: [],
    sourceSlices: [],
    anchorRanges: [],
  };
}

function collectModules(
  presenter: ProjectContextPresenterInput,
  graph: ArchitectureGraphSnapshot
): ModuleFact[] {
  const modules = new Map<string, ModuleFact>();
  const upsert = (
    module: Partial<Omit<ModuleFact, 'files'>> & {
      id: string;
      name: string;
      files?: readonly string[];
    }
  ) => {
    const existing = modules.get(module.id) ?? {
      id: module.id,
      name: module.name,
      files: new Set<string>(),
    };
    existing.name = module.name || existing.name;
    existing.role = module.role ?? existing.role;
    existing.roleConfidence = module.roleConfidence ?? existing.roleConfidence;
    existing.configLayer = module.configLayer ?? existing.configLayer;
    existing.ref = module.ref ?? existing.ref;
    for (const file of module.files ?? []) {
      existing.files.add(file);
    }
    modules.set(existing.id, existing);
  };

  for (const module of presenter.map?.modules ?? []) {
    upsert({
      id: module.id,
      name: module.name,
      role: module.role,
      roleConfidence: module.roleConfidence,
      configLayer: module.configLayer,
      ref: module.ref,
    });
  }
  for (const moduleContext of presenter.modules) {
    upsert({
      id: moduleContext.module.id,
      name: moduleContext.module.name,
      role: moduleContext.module.role,
      roleConfidence: moduleContext.module.roleConfidence,
      configLayer: moduleContext.module.configLayer,
      ref: moduleContext.module.ref,
      files: moduleContext.ownedFiles.map((file) => file.filePath),
    });
  }
  for (const module of graph.modules ?? []) {
    upsert({
      id: module.moduleId,
      name: module.name,
      role: module.role,
      configLayer: module.configLayer,
      files: [...(module.files ?? [])],
    });
  }
  for (const entity of graph.entities ?? []) {
    if (entity.entityType !== 'module') {
      continue;
    }
    upsert({
      id: entity.entityId,
      name: entity.name,
      role: stringMetadata(entity.metadata, 'role'),
      configLayer: stringMetadata(entity.metadata, 'configLayer'),
    });
  }

  return [...modules.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildFileToModule(modules: readonly ModuleFact[]): Map<string, ModuleFact> {
  const map = new Map<string, ModuleFact>();
  for (const module of modules) {
    for (const file of module.files) {
      map.set(file, module);
    }
  }
  return map;
}

function collectImportEvidence(
  facts: NormalizedFacts,
  add: (domain: ArchitectureDomain, evidence: ArchitectureEvidence) => void
): void {
  for (const flow of facts.presenter.fileFlows) {
    const module = facts.fileToModule.get(flow.file.filePath);
    for (const relation of flow.imports) {
      const label = relationText(relation);
      const domains = domainsFromLibraryOrText(label);
      for (const domain of domains) {
        add(
          domain,
          evidence('project-context-import', `import:${label}`, 0.45, {
            moduleId: module?.id,
            filePath: flow.file.filePath,
            ref: relation.ref ?? relation.toRef ?? relation.sourceRef,
          })
        );
      }
    }
  }
}

function collectSymbolEvidence(
  facts: NormalizedFacts,
  add: (domain: ArchitectureDomain, evidence: ArchitectureEvidence) => void
): void {
  const visit = (symbol: SymbolSummary, filePath?: string) => {
    const module = filePath ? facts.fileToModule.get(filePath) : undefined;
    const label = [symbol.name, symbol.kind, symbol.signature, symbol.container, filePath]
      .filter(Boolean)
      .join(' ');
    for (const domain of domainsFromText(label)) {
      add(
        domain,
        evidence('project-context-symbol', `symbol:${symbol.name}`, 0.24, {
          moduleId: module?.id,
          filePath: filePath ?? symbol.filePath,
          ref: symbol.ref,
        })
      );
    }
  };

  for (const symbols of facts.presenter.fileSymbols) {
    for (const symbol of symbols.symbols) {
      visit(symbol, symbols.file.filePath);
    }
  }
  for (const module of facts.presenter.modules) {
    for (const symbol of module.publicSurfaces) {
      visit(symbol, symbol.filePath);
    }
  }
}

function collectConfigEvidence(
  facts: NormalizedFacts,
  add: (domain: ArchitectureDomain, evidence: ArchitectureEvidence) => void
): void {
  for (const config of facts.presenter.repo?.configFiles ?? []) {
    const text = `${config.kind} ${config.path}`;
    for (const item of CONFIG_KIND_PATTERNS) {
      if (!item.pattern.test(text)) {
        continue;
      }
      for (const domain of item.domains) {
        add(
          domain,
          evidence('project-context-config', `config:${config.kind}:${config.path}`, 0.32, {
            ref: config.ref,
            filePath: config.path,
          })
        );
      }
    }
  }
}

function collectManifestEvidence(
  facts: NormalizedFacts,
  add: (domain: ArchitectureDomain, evidence: ArchitectureEvidence) => void
): void {
  for (const dependency of facts.graph.manifestDependencies ?? []) {
    for (const domain of domainsFromLibraryOrText(dependency.name)) {
      add(
        domain,
        evidence('project-context-manifest', `manifest:${dependency.name}`, 0.42, {
          moduleId: dependency.moduleId,
          ref: dependency.ref,
        })
      );
    }
  }
}

function collectGraphEvidence(
  facts: NormalizedFacts,
  add: (domain: ArchitectureDomain, evidence: ArchitectureEvidence) => void
): void {
  for (const entity of facts.graph.entities ?? []) {
    const module = resolveEntityModule(facts, entity.entityId, entity.entityType, entity.filePath);
    const text = `${entity.entityType} ${entity.name} ${entity.superclass ?? ''} ${(entity.protocols ?? []).join(' ')} ${metadataText(entity.metadata)}`;
    for (const domain of domainsFromText(text)) {
      add(
        domain,
        evidence('shared-graph-entity', `entity:${entity.entityType}:${entity.name}`, 0.22, {
          moduleId: module?.id,
          filePath: entity.filePath ?? undefined,
        })
      );
    }
  }
  for (const edge of facts.graph.edges ?? []) {
    const module = resolveGraphEdgeModule(facts, edge);
    const text = `${edge.relation} ${edge.fromId} ${edge.toId} ${metadataText(edge.metadata)}`;
    for (const domain of domainsFromText(text)) {
      add(
        domain,
        evidence('shared-graph-edge', `edge:${edge.relation}:${edge.fromId}->${edge.toId}`, 0.2, {
          moduleId: module?.id,
        })
      );
    }
  }
}

function domainsFromLibraryOrText(text: string): ArchitectureDomain[] {
  const normalized = text.toLowerCase();
  const domains = new Set<ArchitectureDomain>();
  const knownLibraries = LanguageProfiles.knownLibraries;
  for (const [library, category] of Object.entries(knownLibraries)) {
    const lib = library.toLowerCase();
    if (!normalized.includes(lib)) {
      continue;
    }
    for (const domain of domainsFromCategory(category)) {
      domains.add(domain);
    }
  }
  for (const domain of domainsFromText(text)) {
    domains.add(domain);
  }
  return [...domains];
}

function domainsFromCategory(category: string): ArchitectureDomain[] {
  return [...(CATEGORY_TO_DOMAINS[category.toLowerCase()] ?? [])];
}

function domainsFromText(text: string): ArchitectureDomain[] {
  const result: ArchitectureDomain[] = [];
  for (const domain of ARCHITECTURE_DOMAINS) {
    if (DOMAIN_TEXT_PATTERNS[domain].some((pattern) => pattern.test(text))) {
      result.push(domain);
    }
  }
  return result;
}

function addSignal(
  buckets: SignalBuckets,
  domain: ArchitectureDomain,
  item: ArchitectureEvidence
): void {
  const bucket = getOrCreate(buckets, domain, () => ({ score: 0, evidence: [] }));
  bucket.score += item.weight;
  bucket.evidence.push(item);
}

function addStyleEvidence(
  buckets: Map<ArchitectureStyle, SignalBucket>,
  style: ArchitectureStyle,
  item: ArchitectureEvidence
): void {
  const bucket = getOrCreate(buckets, style, () => ({ score: 0, evidence: [] }));
  bucket.score += item.weight;
  bucket.evidence.push(item);
}

function evidence(
  source: ArchitectureEvidenceSource,
  label: string,
  weight: number,
  options: Partial<Omit<ArchitectureEvidence, 'source' | 'label' | 'weight'>> = {}
): ArchitectureEvidence {
  return {
    source,
    label,
    weight,
    ...options,
  };
}

function relationText(relation: RelationSummary): string {
  return [
    relation.kind,
    relation.label,
    relation.from?.label,
    relation.from?.symbol,
    relation.from?.qualifiedName,
    relation.to?.label,
    relation.to?.symbol,
    relation.to?.qualifiedName,
    relation.filePath,
  ]
    .filter(Boolean)
    .join(' ');
}

function resolveRelationEndpointModule(
  facts: NormalizedFacts,
  endpoint: RelationSummary['from'],
  ref?: ProjectContextRef
): ModuleFact | undefined {
  if (endpoint?.filePath) {
    return facts.fileToModule.get(endpoint.filePath);
  }
  if (ref?.scope.filePath) {
    return facts.fileToModule.get(ref.scope.filePath);
  }
  const label = endpoint?.label ?? ref?.label ?? ref?.id ?? '';
  return facts.modules.find((module) => label === module.id || label === module.name);
}

function resolveGraphEndpointModule(
  facts: NormalizedFacts,
  id: string,
  type: string
): ModuleFact | undefined {
  if (type === 'module') {
    return facts.modules.find((module) => module.id === id || module.name === id);
  }
  const entity = facts.graph.entities?.find(
    (candidate) => candidate.entityId === id && candidate.entityType === type
  );
  return resolveEntityModule(facts, id, type, entity?.filePath);
}

function resolveGraphEdgeModule(
  facts: NormalizedFacts,
  edge: ArchitectureKnowledgeEdgeSnapshot
): ModuleFact | undefined {
  return (
    resolveGraphEndpointModule(facts, edge.fromId, edge.fromType) ??
    resolveGraphEndpointModule(facts, edge.toId, edge.toType)
  );
}

function resolveEntityModule(
  facts: NormalizedFacts,
  entityId: string,
  entityType: string,
  filePath?: string | null
): ModuleFact | undefined {
  if (entityType === 'module') {
    return facts.modules.find((module) => module.id === entityId || module.name === entityId);
  }
  if (filePath) {
    return facts.fileToModule.get(filePath);
  }
  const entity = facts.graph.entities?.find((candidate) => candidate.entityId === entityId);
  if (entity?.filePath) {
    return facts.fileToModule.get(entity.filePath);
  }
  return undefined;
}

function collectModuleEdgeMetrics(facts: NormalizedFacts): ModuleEdgeMetricsReport {
  const metrics = new Map<string, ModuleEdgeMetrics>();
  const seenEdges = new Set<string>();
  for (const module of facts.modules) {
    metrics.set(module.id, { fanIn: 0, fanOut: 0 });
  }

  const add = (from: ModuleFact | undefined, to: ModuleFact | undefined, relation: string) => {
    if (!from || !to || from.id === to.id) {
      return;
    }
    const key = `${from.id}\u0000${to.id}\u0000${relation}`;
    if (seenEdges.has(key)) {
      return;
    }
    seenEdges.add(key);
    const fromMetric = metrics.get(from.id);
    const toMetric = metrics.get(to.id);
    if (fromMetric) {
      fromMetric.fanOut += 1;
    }
    if (toMetric) {
      toMetric.fanIn += 1;
    }
  };

  for (const edge of facts.graph.edges ?? []) {
    add(
      resolveGraphEndpointModule(facts, edge.fromId, edge.fromType),
      resolveGraphEndpointModule(facts, edge.toId, edge.toType),
      edge.relation
    );
  }
  for (const module of facts.presenter.modules) {
    for (const relation of [...module.outflow, ...module.inflow]) {
      add(
        resolveRelationEndpointModule(facts, relation.from, relation.fromRef),
        resolveRelationEndpointModule(facts, relation.to, relation.toRef),
        relation.kind
      );
    }
  }

  return {
    edgeCount: seenEdges.size,
    metricsByModule: metrics,
  };
}

function sumModuleLines(presenter: ProjectContextPresenterInput, module: ModuleFact): number {
  const owned = new Set(module.files);
  const moduleContext = presenter.modules.find((candidate) => candidate.module.id === module.id);
  for (const file of moduleContext?.ownedFiles ?? []) {
    owned.add(file.filePath);
  }
  const lines = new Map(presenter.files.map((file) => [file.filePath, file.lineCount ?? 0]));
  for (const file of moduleContext?.ownedFiles ?? []) {
    lines.set(file.filePath, file.lineCount ?? lines.get(file.filePath) ?? 0);
  }
  let total = 0;
  for (const file of owned) {
    total += lines.get(file) ?? 0;
  }
  return total;
}

function moduleComplexityEvidence(
  module: ModuleFact,
  lineCount: number,
  fileCount: number,
  fan: { fanIn: number; fanOut: number },
  cycleCount: number,
  hotspotScore: number
): ArchitectureEvidence[] {
  const items: ArchitectureEvidence[] = [
    evidence('derived', `files:${fileCount}`, 0.2, { moduleId: module.id, ref: module.ref }),
    evidence('derived', `loc:${lineCount}`, 0.2, { moduleId: module.id, ref: module.ref }),
  ];
  if (fan.fanIn || fan.fanOut) {
    items.push(
      evidence('shared-graph-edge', `fan-in:${fan.fanIn}:fan-out:${fan.fanOut}`, 0.3, {
        moduleId: module.id,
      })
    );
  }
  if (cycleCount) {
    items.push(evidence('shared-graph-edge', `cycles:${cycleCount}`, 0.4, { moduleId: module.id }));
  }
  if (hotspotScore) {
    items.push(
      evidence('project-context-map', `hotspot:${hotspotScore}`, 0.3, { moduleId: module.id })
    );
  }
  return items;
}

function collectHotspotScores(map: ProjectMap | undefined): Map<string, number> {
  const scores = new Map<string, number>();
  for (const hotspot of map?.hotspots ?? []) {
    const key = hotspot.ref.scope.filePath ?? hotspot.ref.id ?? hotspot.ref.label;
    if (key) {
      scores.set(key, Math.max(scores.get(key) ?? 0, hotspot.score));
    }
    if (hotspot.ref.kind === 'module' && hotspot.ref.label) {
      scores.set(hotspot.ref.label, Math.max(scores.get(hotspot.ref.label) ?? 0, hotspot.score));
    }
  }
  return scores;
}

function countEdgesByRelation(graph: ArchitectureGraphSnapshot, relation: string): number {
  return (graph.edges ?? []).filter((edge) => edge.relation === relation).length;
}

function hasConfig(repo: RepoContext | undefined, pattern: RegExp): boolean {
  return (repo?.configFiles ?? []).some((config) => pattern.test(`${config.kind} ${config.path}`));
}

function metadataText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) {
    return '';
  }
  return Object.entries(metadata)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(' ');
}

function stringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function sortEvidence(items: readonly ArchitectureEvidence[]): ArchitectureEvidence[] {
  return [...items].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const next = create();
  map.set(key, next);
  return next;
}

function severityFor(score: number, medium: number, high: number): 'low' | 'medium' | 'high' {
  if (score >= high) {
    return 'high';
  }
  if (score >= medium) {
    return 'medium';
  }
  return 'low';
}

function clampConfidence(score: number): number {
  return round(Math.max(0, Math.min(1, score)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
