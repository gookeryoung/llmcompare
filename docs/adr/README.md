# 架构决策记录（ADR）

沿用 [Michael Nygard 的轻量 ADR 格式](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)：
每条记录只写**当时面对的问题、做出的选择、以及被放弃的选项与代价**。

新增一条：复制 `template.md`，编号顺延，文件名 `NNNN-短横线标题.md`。

| 编号 | 标题 | 状态 |
|---|---|---|
| [0001](0001-normalize-upstream-streams.md) | 上游流式协议在服务端归一化 | 已采纳 |
| [0002](0002-frontend-state-ownership.md) | 前端持有会话与对比任务的状态 | 已采纳 |
| [0003](0003-json-file-storage.md) | 用 JSON 文件而非数据库做持久化 | 已采纳 |
