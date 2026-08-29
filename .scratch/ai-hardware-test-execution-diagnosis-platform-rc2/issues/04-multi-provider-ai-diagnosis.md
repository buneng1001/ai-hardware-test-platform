# 04 — 接入三服务商 AI 诊断与安全降级

**What to build:** 让测试工程师安全选择硅基流动、DeepSeek 或 Kimi 进行独立 AI 诊断，同时在服务不可用时不影响测试执行和原始报告。

**Blocked by:** 01 — 重做页面导航与采集任务生命周期管理

**Status:** resolved
**Version:** v0.1.0-rc.2

- [x] 三个服务商分别隔离凭据、端点、推荐模型目录和自定义模型，错误不得静默换模型或跨服务商发送密钥。
- [x] 设置页和连接测试显示服务商、模型、请求中、成功、失败和可重试状态，并防止重复提交。
- [x] AI Key 只保留在当前会话内存；接口、数据库、日志、报告和证据包不返回或保存 Key。
- [x] 诊断接受明确允许的结构化包装，内部异常转换为用户可读错误码和摘要，真实响应回放纳入回归测试。
- [x] 仅对超时、限流和临时服务错误自动重试且最多两次；模型失败不改变运行状态，并允许人工重试。
- [x] 前后端公开行为测试覆盖三服务商隔离、Mock、凭据安全、失败降级和诊断归属。

## Answer

- 实现硅基流动、DeepSeek、Kimi 的独立适配器、endpoint/API Key 环境配置、推荐模型目录和明确的自定义模型前缀。
- 设置接口仅返回 provider、模型目录和是否已配置；诊断记录新增 provider，API Key 不进入数据库、响应或证据内容。
- 连接测试和诊断支持成功、失败、retryable 状态；仅 timeout、rate limit、temporary service 自动最多重试两次。
- 诊断支持限定的 `diagnosis`/`result`/`data` 结构化包装，保留证据引用校验和运行完成状态；前端 provider 选择、模型 datalist、请求中禁用和运行切换清空/重载已覆盖。
- 验证证据：后端 `112 passed`；前端 `27 passed`；TypeScript typecheck、Prettier format check、Ruff check 全部通过。
