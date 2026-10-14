# Context

本文件给协作者与 AI 助手提供**领域词汇表**与关键取舍的落点，避免同一概念在不同页面/模块出现不同叫法。

## 术语表

| 术语 | 含义 | 关键实现/落点 |
|---|---|---|
| 模型配置（ModelConfig） | 一条可调用的上游模型：协议类型 + Base URL + 模型 ID + 密钥 + 默认采样参数 + 单价 | `server/store.mjs` 的 `models`；密钥只存服务端，`GET /api/models` 永不回传明文 |
| 协议适配器（Adapter） | 把某家厂商的流式协议翻译成统一事件流的实现 | `server/adapters.mjs`：`openai` / `anthropic` / `gemini` / `ollama` / `mock`，见 ADR-0001 |
| 归一化事件流 | 所有上游被统一成 `start → delta / reasoning / usage → done`，异常走 `error` | `server/api.mjs` 的 `pipeStream`；前端只需一套流式渲染逻辑 |
| 内置模拟模型（mock） | 不联网、按字符匀速吐字的假模型，用于无密钥演示与自动化测试 | `adapters.mjs` 的 `streamMock`；被当作裁判调用时会返回结构化 JSON 评分 |
| 题库（Bank） | 题目的容器，带名称/描述/标识色 | `banks` 集合；删除题库会级联删除其题目 |
| 题目（Question） | 一条评测素材：题干 + 难度 + 标签 + 参考答案 + 评分要点 | `questions` 集合；评分要点会随对比任务一起提交给 AI 裁判 |
| 对话（Conversation） | 单模型的多轮会话，独立保存模型、系统提示与采样参数 | `conversations` 集合；前端为状态源，一轮结束后整体 PUT 落库 |
| 对比任务 | 同一个问题**并行**发给 N 个模型的一次执行，不落库 | 前端 `pages/Compare.tsx`；每个模型一条独立 `AbortController` 流 |
| 评测记录（Run） | 对比任务的可持久化快照：各模型原文 + 指标 + 人工评分 + 裁判结论 | `runs` 集合；「再次运行」用同一题干重建对比任务 |
| 首字延迟（TTFT） | 从发起请求到收到第一个字符的耗时，决定交互体感 | 服务端在首个 `delta` 时打点，随 `done` 事件回传 |
| 预估成本（cost） | 按模型配置的单价 × 实际 token 估算的花费（美元） | 单价留 0 则不统计，界面显示 `—` |
| token 估算标记 | 上游未返回 usage 时按字符数粗估，界面以 `~` 提示 | `pipeStream` 的 `completionTokensEstimated` |
| AI 裁判（Judge） | 让一个模型按评分要点为各候选回答打分排序，输出严格 JSON | `POST /api/judge`；解析失败会保留原始输出供人工查看 |
| 同步滚动 | 对比视图下多列内容按比例联动滚动，便于逐段对照 | `Compare.tsx` 的 `onScrollColumn` + `syncing` 互斥标记 |
| 隔离测试实例 | 测试专用服务：独立端口 + `.tmp/e2e-data` 数据目录，绝不触碰 `data/` | `scripts/with-server.mjs` |

## 关键取舍

- **为什么要有服务端**：厂商接口普遍不允许浏览器直连（CORS），且密钥不能下发到前端。服务端是零运行时依赖的 Node 原生 http 服务。
- **为什么用 JSON 文件而不是数据库**：单机单人使用，透明度与可备份性优先；写入采用「防抖 + 原子替换」，见 `store.mjs`。
- **为什么测试要自己起服务**：`test:api` / `test:ui` 原先依赖使用者手动 `pnpm start`，既会污染真实 `data/`，也会因为端口占用而随机失败。现在由 `with-server.mjs` 拉起隔离实例。
- **为什么 lint 不拦 `set-state-in-effect`**：见 `eslint.config.js` 中的说明与 `react-hooks` 规则集差异。
