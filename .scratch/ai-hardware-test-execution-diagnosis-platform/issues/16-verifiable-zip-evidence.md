# 16 — 交付可校验的 ZIP 证据包

**What to build:** 让测试工程师导出可独立核验的 ZIP 证据包，并确认内容与运行记录一致、文件未被篡改且默认不携带大体积或敏感数据。

**Blocked by:** 15 — 交付应用内报告与独立 HTML

**Status:** resolved

- [x] ZIP 包含报告、结构化数据、CSV、人工结果、日志、关键帧或可选小样、文件清单和哈希。
- [x] 文件清单与实际内容一致，哈希可重复验证，导出失败不会留下被误认为完整的证据包。
- [x] 原始视频默认不进入 ZIP，只有明确选择且满足大小保护时才允许小样。
- [x] ZIP、清单、日志和报告不包含 API Key、认证头或其他敏感字段。
- [x] API 主 seam 验证导出、解包、清单、哈希、默认排除项和敏感信息扫描。
- [x] 更新课程映射中的文件处理和可验证产物证据；工程日志记录真实打包或完整性问题；面试案例只补充已验证的证据交付能力。

## Answer

- 新增 `GET /api/runs/{run_id}/evidence.zip` 和运行详情“下载 ZIP 证据包”入口。ZIP 包含 `report.json`、独立 HTML、检查 CSV、人工结果 CSV、设备状态、日志、故障真值、人工附件、完整文件清单和 `SHA256SUMS.txt`。
- 默认排除 MP4/MKV；`include_sample=true` 时通过 FFmpeg 提取前 1 秒无音频小样，并限制单个 5 MiB、总计 10 MiB。未完成运行返回 409，缺失产物、提取失败或敏感二进制字段不会生成落盘 ZIP。
- 报告/CSV/文本附件脱敏认证头、API Key 和常见 `sk-` 字段；平台生成文本产物或二进制交付物命中敏感标记时拒绝导出，保持运行哈希可信。
- 验证证据：Ticket 16 API 定向测试 9 项；后端完整 Pytest 75 项；前端完整 Vitest 22 项；TypeScript、Ruff、Prettier、Vite 构建和 `git diff --check` 通过。Windows 受限沙箱首次出现 `spawn EPERM`，提升权限重跑通过。
- 代码审查：以 `main` 为 fixed point 完成 Standards/Spec 双轴审查，修复清单覆盖、敏感扫描、真实小样、失败清理和大小保护问题；最终仅剩 Feature Envy 判断性建议，无硬性问题。
- 已知限制：小样是受保护的 1 秒视频片段，不是通用关键帧语义抽取；结构化 AI 诊断仍属于后续 ticket。
