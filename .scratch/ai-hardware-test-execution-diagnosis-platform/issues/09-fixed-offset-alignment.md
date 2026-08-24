# 09 — 交付固定偏移时间对齐

**What to build:** 让测试工程师选择参考时钟，对多通道原始时间戳执行固定偏移校正，并同时看到对齐前指标、校正参数和对齐残差。

**Blocked by:** 04 — 扩展可配置的多通道合成文件生成

**Status:** resolved

- [x] 合成数据允许各通道具有不同起点、固定偏移和抖动，并保留原始时间戳。
- [x] 默认使用第 1 路相机作为参考时钟，同时允许测试工程师选择其他通道。
- [x] 系统根据共同事件估计固定偏移，保存校正方法、参数和独立的对齐后结果。
- [x] 分析视图同时展示对齐前偏移、抖动以及对齐后残差，校正结果不覆盖原始证据。
- [x] 已知偏移的契约测试与 API 主 seam 验证参数估计和可观察结果。
- [x] 更新课程映射中的时间分析和契约测试证据；工程日志记录真实对齐问题；面试案例只补充已验证的固定偏移校正能力。

## Answer

- 实现固定偏移场景、参考通道选择、共同事件锚点、对齐前后结果持久化和运行详情展示。
- 修复审查发现的替代参考通道真值比较错误：故障真值会转换到所选参考通道原点；无效的视频参考通道会在创建任务时拒绝。
- 验证证据：`backend\.venv\Scripts\python.exe -m pytest backend/tests` → 51 passed；
  `backend\.venv\Scripts\python.exe -m ruff check backend` → All checks passed；
  `pnpm --dir frontend typecheck` → passed；
  `pnpm --dir frontend test -- ConfigurableCollectionTask.test.tsx FixedOffsetCollectionTask.test.tsx` →
  5 files / 18 tests passed；`pnpm --dir frontend format:check` → all files formatted；`git diff --check` → passed。
- 额外验证：默认 camera_1 和替代 camera_3 参考均命中故障真值；camera_3 在单路视频配置下返回 422。
