// 冻结的导出子路径 ./core/analysis：提取器已搬入 core/ast/extract（语法层自包含，
// 不再反向依赖本目录），这里只为保持导出键而转发。导入目标解析仍在本目录，后续并入链接层。
export * from '../ast/extract/CallSiteExtractor.js';
export * from '../ast/extract/ImportRecord.js';
export * from './ImportPathResolver.js';
