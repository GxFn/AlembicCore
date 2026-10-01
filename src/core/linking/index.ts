// 链接层（L3）：把文件事实里的出现点连到声明。这里的链接器都是纯函数，
// 通过 ModuleGraphAccess 取其他模块的事实，自己不读磁盘、不查索引。
export * from './exportTable.js';
export * from './importBindingLinker.js';
export * from './lexicalLinker.js';
export * from './moduleTargets.js';
