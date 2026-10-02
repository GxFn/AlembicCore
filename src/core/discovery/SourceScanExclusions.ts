/**
 * 排除策略的表与判断在 shared/SourceScanExclusions：发现层、索引与协议用的是同一份。
 * 这里保留原路径，发现层内部的导入不变。
 */
export {
  COMMON_SOURCE_SCAN_EXCLUDE_DIRS,
  createSourceScanExcludeDirs,
  isSourceScanExcludedDir,
  isSourceScanExcludedPath,
} from '../../shared/SourceScanExclusions.js';
