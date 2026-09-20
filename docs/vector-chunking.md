# 文本分块边界

公开入口仍为 `@alembic/core/vector` 的 chunk、chunkByAST、ensureParser 和
isASTChunkerAvailable。chunk/chunkByAST 同步返回结果；需要语法感知分块时，先等待
ensureParser。IndexingPipeline 已承担这项初始化职责。

| 模块 | 职责 |
| --- | --- |
| Chunker | whole/section/fixed/ast/auto 策略选择，section 合并与输出 metadata |
| ASTChunker | 声明边界、节点分组、名称和真实行号；拥有解析树的释放责任 |
| TextChunkRanges（内部） | 按统一 token 估算计算文本跨度、重叠与向前推进，保持 Unicode 码点完整 |
| IndexingPipeline | 文件扫描、分块输入、embedding、索引写入及旧块维护 |

固定分块与 AST 的不可再拆叶子共用跨度算法。预算使用项目统一的 estimateTokens，
并非外部模型 tokenizer 的精确值。中文和混合文本不能只按“四字符一个 token”切割。
公开分块入口在策略执行前统一验证：maxChunkTokens 至少为 1，overlapTokens 不得为负或 NaN；
非法配置抛出 RangeError，避免循环不前进或跳过原文。Infinity 预算保留不限长含义。

重叠达到或超过预算时，保持按不重叠方式前进并记录诊断。已经包含原文结尾的块就是
最后一块，不能再把重叠后缀独立写成重复条目。换行也占预算，切点不会落在 UTF-16
代理对之间。空输入仍返回空数组；whole 和未知策略保持原样返回，不使用分块预算。

AST 分组使用真实源跨度，不通过插入换行重新拼装语法 token。每组的行号来自对应
AST 起止位置；超预算的叶子、注释/import 分组再按文本跨度细分。语法树在物化结束
或发生异常后由 finally 释放。AST 不可用时仍由调用方选择文本降级。

这会修正旧的尾块、中文预算和超大节点输出。已有索引可以继续读取；需要把新分块
结果应用到内容未变的文件时，使用现有的 force/fullBuild，避免增量 sourceHash
判断将其跳过。没有新增 package 出口、索引文件格式或宿主 provider 能力。

测试由 VectorPipeline.test.ts 负责：真实 overlap、混合文本/码点、非法预算、AST
叶子和原文行号，以及已有的文件索引增量与清理链路。
