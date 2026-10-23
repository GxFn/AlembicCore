# Atlas 局部维护规则

本目录是独立、private 的架构阅读工具。遵守 Core 与父 workspace AGENTS。

- 正式叙述在 maps，节点/边/证据只在同页 frontmatter 维护。生成区域、data 与索引可重建，不能独立手工维护另一份事实。
- 功能单元维护于 moduleDetails，失败状态与恢复责任维护于 failureModes；入口和失败分支均需精确源码锚点。自动动作、调用者显式恢复与停止条件分别填写，不能将错误提示或引用字符串画成已经执行的恢复。
- 产品源码、exports、package scripts/dependencies、tsconfig、发布白名单不因图谱而变更。静态提取不启动 Core runtime。
- 原始审阅/验收/截图归 workspace `wakeflow-ledger/AlembicCore/architecture-atlas`。仓内只留可移植派生摘要；不要加入个人绝对路径、真实会话 ID 或凭据。
- sourceFingerprint 必须对应实际逐边复核的精确输入。先理解差异，再修图和证据，最后更新指纹；禁止只刷新 hash 消除 drift。
- 运行 `npm run inventory:check` 和 `npm run check`；原 ledger 可用时运行 `npm run check:provenance`。所有写入仅允许显式的 `inventory:write` 或浏览器渲染验证操作。
- 普通阅读与 build 不写输入、数据库或回执。render:verify 是独立服务，回执只能写固定 Atlas 路径，不接收任意文件名。
- 修改 UI/渲染器后重新做对应实际浏览器验证。旧 Mermaid 回执不能证明新 Cytoscape 或新 UI 通过。
- 历史记录、未覆盖、无法解析及原材料缺失均保留，不得用绿色状态替代实际证据。
- 模块ID、failure ID、journey step ID不得因重排或改标题重编号；旧slug保留alias。图/模块/失败关联需明确阅读关系，不能按同一步笛卡尔积推断故障归属。
- journeys/和objects/是独立正典类型；生成Markdown区域和data/book-index.json不可单独改事实。示例保持illustrative，真实运行由独立回执证明。
- `evidence:run`才执行受控测试；build、inventory及页面不得制造pass。`check:evidence`重验原始材料、case集合、来源与harness。P3只升级选定场景，不升级整专题L4。
- 新复核使用`review:append`追加已读spec；不要编辑旧ledger或重置records manifest。遗留append锁须先检查原进程及当前manifest，不自动抢占。
