// 冻结的导出子路径 ./core/analysis：提取器在 core/ast/extract（语法层自包含），
// 导入目标解析在 core/linking。本目录不再有实现，只为保持导出键而转发。
export * from '../ast/extract/CallSiteExtractor.js';
export * from '../ast/extract/ImportRecord.js';
