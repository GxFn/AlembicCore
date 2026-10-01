/**
 * 目标项目分析基准的夹具契约。
 *
 * 夹具源码里用行尾注释 `// @标记` 标出调用点，期望关系按标记引用位置，
 * 不写行号：改夹具文本时期望不会悄悄错位。
 */

/** 期望由哪一类链接提供；基准按这一维度分别计数，各阶段只抬高自己负责的那一类。 */
export type BenchmarkLinkSource =
  /** 同文件词法解析（隐式 self、同文件函数）。 */
  | 'lexical'
  /** TS/JS 的 import 绑定跨文件解析（含 re-export、default、namespace）。 */
  | 'import-binding'
  /** 外部索引器（CodeGraph）的可信档：限定名、类型接收者、路径别名导入。 */
  | 'external'
  /** 现有两套引擎都给不出可信结果，留给"按声明类型解析成员"的后续阶段。 */
  | 'future';

export type BenchmarkRelationKind = 'calls' | 'instantiates' | 'implements';

export interface BenchmarkExpectation {
  kind: BenchmarkRelationKind;
  /** 调用点所在文件里的 `// @标记`。 */
  at: string;
  /** 目标声明所在文件（项目相对路径）。 */
  toFile: string;
  /** 目标符号；成员写作 `Type.member`，ObjC 选择器保留冒号。 */
  toSymbol: string;
  via: BenchmarkLinkSource;
}

export interface BenchmarkMustNot {
  /** 该标记所在行不允许出现任何指向项目内符号的已解析关系。 */
  at: string;
  /** 为什么这里一旦解析出项目内目标就是误报。 */
  reason: string;
}

export interface AnalysisBenchmarkFixture {
  name: string;
  language: 'swift' | 'objectivec' | 'typescript' | 'tsx';
  files: Record<string, string>;
  expected: BenchmarkExpectation[];
  mustNot: BenchmarkMustNot[];
}
