// 文件事实层（L2）：一份源码文本 → 符号 + 导入导出 + 调用点。纯函数，只依赖语法层。
// 索引、链接器与 ProjectContext 协议都从这里取同一份事实，彼此之间不再互相借用内部实现。
export * from './contracts.js';
export * from './fileAst.js';
export * from './fileFlow.js';
export * from './fileSymbols.js';
export * from './fileSyntaxEvidence.js';
export * from './parserLanguage.js';
export * from './sourceLineRange.js';
