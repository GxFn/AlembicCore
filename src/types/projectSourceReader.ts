/** 分析所需的只读项目输入；实现可来自本机、记录会话或完全离线重放。 */
export interface ProjectSourceDirectoryEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface ProjectSourceStat {
  mode: number;
  size: number;
  /** 展示用时间不是内容身份；可移植重放可以没有此值。 */
  mtimeMs?: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export type ProjectSourceConfigurationKind =
  | 'scope-for-folder'
  | 'scope-for-control-root'
  | 'discoverer-preference';

export interface ProjectSourceReadOptions {
  signal?: AbortSignal;
}

export interface ProjectSourceReader {
  readonly mode: 'live' | 'record' | 'replay';
  readFile(absolutePath: string, options?: ProjectSourceReadOptions): Promise<Uint8Array>;
  readDirectory(
    absolutePath: string,
    options?: ProjectSourceReadOptions
  ): Promise<ProjectSourceDirectoryEntry[]>;
  stat(absolutePath: string, options?: ProjectSourceReadOptions): Promise<ProjectSourceStat>;
  realpath(absolutePath: string, options?: ProjectSourceReadOptions): Promise<string>;
  /** 显式接受的环境输入；重放时绝不调用 load 访问全局 registry/preference。 */
  readConfiguration<T>(
    kind: ProjectSourceConfigurationKind,
    absolutePath: string,
    load: () => T | Promise<T>
  ): Promise<T>;
  /** 缺失的重放读取不能被业务层已有 catch/fallback 吞掉。 */
  assertComplete(): void;
  /** 明确不支持捕获的生产方/控制错误也必须跨越旧fallback锁存。 */
  invalidate(error: Error): void;
}
