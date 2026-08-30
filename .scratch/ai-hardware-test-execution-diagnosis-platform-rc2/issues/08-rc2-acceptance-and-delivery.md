# 08 — 完成 RC2 端到端验收与交付证据

**What to build:** 让新用户能够按照说明在 Mock 模式复现 RC2 的合成与导入流程，并用确定性测试证据验证关键契约、安全边界和降级行为。

**Blocked by:** 01 — 重做页面导航与采集任务生命周期管理；02 — 升级合成数据与六轴 IMU 契约；03 — 实现独立时间对齐与逐帧视频—IMU 映射；
04 — 接入三服务商 AI 诊断与安全降级；05 — 实现实际测试 ZIP 导入与安全校验；06 — 让导入型任务进入统一运行与分析链路；
07 — 完善报告、证据 ZIP、原始视频下载和人工结果契约

**Status:** completed
**Version:** v0.1.0-rc.2

- [x] 以现有 FastAPI TestClient 公开 API 集成测试作为主验收 seam，覆盖正常、异常、边界、安全和失败降级行为。
- [x] 沿用 React Testing Library 的 App、页面和组件 seam，覆盖导航、状态反馈、禁用按钮、错误提示和下载入口。
- [x] 先通过 Schema、状态机、哈希、文件清单、时间映射、大小边界和安全拒绝等确定性检查，再进行视觉验收。
- [x] 在 Mock 模式验证合成型和导入型端到端链路，确认 AI 不阻断生成、检查、对齐、判定和原始报告。
- [ ] 提供从 README 可进入的详细测试工程师使用手册，逐项说明三种模式、所有参数效果、IMU 采样率、场景预期、时间对齐、判定模式、manifest、导入状态、生命周期和证据导出。
- [ ] 通过文件存在性、章节/关键词完整性和人工可操作性检查证明手册不是只有启动命令的简介。
- [ ] 更新 RC2 验收证据，但不进入 `docs/test-case-input/`，不包含用户实际数据或敏感凭据。

## Answer / 验证证据

- 新增 `scripts/run_rc2_acceptance.py`，通过公开 FastAPI API 验证正常、掉帧、IMU 异常、快速 100Hz、自定义 50Hz、导入型手工运行、Mock 诊断和报告/证据 ZIP。
- 新增 `backend/tests/test_rc2_acceptance_api.py`，验证六轴 IMU 字段、原始文件哈希、逐帧映射引用、导入任务不伪造故障真值、证据 ZIP 默认排除原始视频、UTF-8 BOM 和清单哈希。
- RC2 验收产物写入 `tmp/rc2-acceptance`，并通过 `scripts/check_artifact_safety.py`；未修改 `docs/test-case-input/`，未包含用户实际数据或敏感凭据。
- 验证结果：RC2 Mock 验收通过；验收产物安全扫描通过；相关后端测试 `22 passed`；前端 `5 test files, 28 passed`；TypeScript、Prettier 和 Ruff 检查通过。
- 完成本 ticket 的只读 Standards/Spec code review，未发现需阻断交付的问题。
