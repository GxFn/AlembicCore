/**
 * 源引用的文件身份投影；保留大小写，剥离行/列或 GitHub 行片段后缀。
 * 与历史 SourceRefReconciler 导出使用同一函数，仓储不能反向依赖 service。
 */
export function stripSourceRangeSuffix(sourcePath: string): string {
  return sourcePath
    .replace(/:(\d+)(?:-(\d+))?(?::\d+)?$/, '')
    .replace(/#L(\d+)(?:-L?(\d+))?$/i, '')
    .replaceAll('\\', '/');
}
