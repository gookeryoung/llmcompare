# 0001. 上游流式协议在服务端归一化

- 状态：已采纳
- 日期：2026-10-14
- 相关：`server/adapters.mjs`、`server/api.mjs`

## 背景

工作台要同时接入 OpenAI 兼容接口、Anthropic Messages、Google Gemini 与 Ollama。
四者的流式协议互不兼容：

| 协议 | 传输 | 分片结构 | 结束信号 |
|---|---|---|---|
| OpenAI 兼容 | SSE `data:` | `choices[0].delta.content`（推理模型另有 `reasoning_content`） | `data: [DONE]` |
| Anthropic | SSE + `event:` 行 | `content_block_delta.delta.text_delta` | `message_delta.stop_reason` |
| Gemini | SSE `alt=sse` | `candidates[0].content.parts[].text` | `candidates[0].finishReason` |
| Ollama 原生 | NDJSON（非 SSE） | `message.content` | `{done:true}` |

如果把这些差异暴露到前端，前端需要为每种协议写一套解析、一套渲染、一套指标打点，
每接一家新厂商都要动前端——这是不可接受的耦合。

## 决策

**所有协议差异都在服务端被翻译成同一种事件序列**，前端只见这一套：

```
start → (delta | reasoning | usage)* → done
                              ↘ error
```

- `delta`：正文增量；`reasoning`：思维链增量（DeepSeek / Claude thinking）；
- `usage`：token 用量，允许分多次到达（Claude 的 input/output 就是两批）；
- `done`：携带统一指标（TTFT、总耗时、tokens、字符/秒、预估成本）；
- 上游异常与 HTTP 错误都转成 `error` 事件，不中断 SSE 连接。

适配层在 `server/adapters.mjs`，通过 `resolveAdapter(provider)` 选择实现。
`usage` 采用「取最大值合并」策略，因为部分网关会重复上报。

## 备选方案

- **前端适配**：前端按 provider 分支解析。放弃——新增厂商要改前端，且指标打点逻辑会重复多份。
- **统一转成 OpenAI 格式**：把各家都转成 OpenAI 的 chunk 形状。放弃——OpenAI 的 chunk 无法表达
  reasoning 与分批 usage，最终还是要发明私有字段，不如直接定义自己的事件。
- **只在非流式场景做统一**：放弃——首字延迟是选型的核心指标之一，必须流式才有意义。

## 后果

- 正面：新增厂商只需在 `adapters.mjs` 加一个 async generator，前端零改动；
  指标打点、SSE 转发、错误处理全部只有一份实现。
- 负面：适配层成为关键路径，它的 bug 会同时影响所有厂商；需要 `adapters.test.mjs` 兜住地址归一化等纯逻辑。
- 负面：上游新增能力（如 tool_calls、图片增量）需要在事件枚举里显式扩展，不会自动透传。
- 后续关注：`stream_options.include_usage` 并非所有 OpenAI 兼容网关都支持，
  当前做法是遇到 400/422 自动去掉该参数重试一次；上游若返回 usage，则覆盖字符数估算值。
