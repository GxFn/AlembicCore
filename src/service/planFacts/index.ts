// planFacts：从 host 交付层(AlembicPlugin plan-tool.ts)下沉到 Core 的可复用
// plan 事实收集 + 精简投影能力，双宿主(host-agent + 主体 in-process)共用。
// U1a.1：先下沉 project-source-facts（工程源文件事实扫描，PlanProjectContextAnalysis
// 的 sourceFileFacts 承载类型来源）；后续刀继续迁 projectInfoTree 投影簇。

// U1a.3：统一 plan 投影纯函数簇（buildProjectInfoTree 金字塔+预算+fullTreeRef /
// buildProjectProfileFromAnalysis / collectModuleSnapshots + tree 类型 + PlanProjectContextAnalysis）。
export * from './project-info-tree.js';
export * from './project-source-facts.js';
// U1a.2：transient-transport（.asd/tmp JSON 传输原语；plan fullTreeRef 外置 +
// briefing-budget / cold-start 响应预算化共用）随 planFacts 一起下沉 Core。
export * from './transient-transport.js';
