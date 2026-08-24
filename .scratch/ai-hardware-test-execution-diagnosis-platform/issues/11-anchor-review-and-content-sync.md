# 11 — 支持锚点复核与内容同步独立评价

**What to build:** 让测试工程师查看和调整跨模态锚点，并分别审查时间戳对齐和画面内容同步，避免把时间接近误判为内容同步。

**Blocked by:** 10 — 交付线性漂移时间对齐

**Status:** resolved

- [x] 系统自动识别合成视频闪光事件以及 IMU 冲击峰值，并建立稳定锚点引用。
- [x] 测试工程师可查看、调整或排除锚点，重新计算后保留使用的锚点与参数。
- [x] 分析视图分别展示时间戳对齐结果和画面内容同步结果。
- [x] 锚点误识别、缺失和人工调整具有可理解的错误或降级行为。
- [x] API 主 seam 和关键 UI 流程验证锚点调整会产生新的可观察分析结果且不覆盖原始证据。
- [x] 更新课程映射中的 UI 流程与同步分析证据；工程日志记录真实锚点问题；面试案例只补充已验证的复核与双重评价能力。

## Answer

- 新增稳定的 `channel:event-N` 锚点明细，区分自动检测时间、复核时间、使用状态和视频闪光/IMU 峰值来源。
- 新增 `POST /api/runs/{run_id}/alignment-review`，支持调整、排除和 revision；原始 artifact、检测结果与自动锚点值不被覆盖。
- 运行详情支持查看/编辑/排除锚点，分别展示时间戳对齐和内容事件同步；错误原因与共同锚点不足的降级行为可观察。
- 内容同步按视频闪光和 IMU 冲击峰值的事件顺序独立评价，不以时间接近替代同步结论。
- 验证证据：`backend\\.venv\\Scripts\\python.exe -m pytest backend\\tests -q` → 54 passed；
  `backend\\.venv\\Scripts\\python.exe -m ruff check backend` → All checks passed；
  `pnpm --dir frontend test` → 5 files / 19 tests passed；
  `pnpm --dir frontend typecheck` → passed；
  `pnpm --dir frontend format:check` → all files formatted；
  `pnpm --dir frontend build` → Vite production build passed；`git diff --check` → passed。
- Code review：Standards 发现的原始锚点保留问题已修复；Spec 发现的复核后残差回退、UI 新结果断言和错误信息问题已修复。
- 已知限制：当前内容同步验证合成白帧闪光与 IMU 峰值的事件身份/顺序，不宣称通用视觉语义识别；未实现复杂非线性时间扭曲。
