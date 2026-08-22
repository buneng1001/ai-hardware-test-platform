# 07 — 交付 IMU 异常场景

**What to build:** 让测试工程师从界面运行固定种子的 IMU 异常场景，并查看丢样、重复、时间戳倒退和间隔分布的确定性检测及故障真值对照。

**Blocked by:** 04 — 扩展可配置的多通道合成文件生成

**Status:** resolved

- [x] 场景在生成前记录 IMU 丢样、重复、时间戳倒退的故障真值与预期检测结果。
- [x] IMU 检查覆盖采样率、丢样、重复、倒退和采样间隔分布，并输出统一检测结果。
- [x] 运行详情或分析视图展示每类异常的指标、位置和故障真值对照。
- [x] CSV 与 JSONL 均有契约测试，固定种子可重复，正常场景不误报。
- [x] API 主 seam 验证场景执行、检测命中和结果展示。
- [x] 更新课程映射中的 IMU 检查、数据驱动和参数化测试证据；工程日志记录真实传感器数据问题；面试案例只补充已验证的 IMU 检测能力。

## Answer

已从页面和公开 API 主 seam 交付固定种子的 IMU 异常场景。生成器在写入 CSV/JSONL 前记录丢样、
重复、时间戳倒退及预期间隔异常位置；检查器从真实产物分别计算采样率、样本编号连续性、时间戳单调性
和采样间隔分布。快速 50 Hz 场景各检出 1 处丢样、重复和倒退，并检出 4 个异常间隔；指标、全部位置
及故障真值 `matched` 对照均通过 API 返回并在运行详情展示。同一固定种子重复运行得到相同 IMU、故障真值
SHA-256 和检测结果，CSV/JSONL 正常场景五项检查全部通过。

### 验证证据（2026-08-23）

- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q -p no:cacheprovider
  --basetemp=.test-runs/ticket07-review-full`：45 passed。
- `backend/.venv/Scripts/python.exe -m ruff check backend/app backend/tests`：All checks passed。
- `backend/.venv/Scripts/python.exe -m ruff format --check backend/app backend/tests`：20 files already formatted。
- `pnpm --dir frontend test`：4 test files、16 tests passed。
- `pnpm --dir frontend typecheck`：通过，无 TypeScript 错误。
- `pnpm --dir frontend format:check`：所有文件符合 Prettier 格式。
- `pnpm --dir frontend build`：Vite 生产构建成功，22 modules transformed。
- `backend/.venv/Scripts/python.exe scripts/check_repository_safety.py`：安全扫描通过。
- `git diff --check`：通过，无空白错误。
- `$code-review` 以 `a1c1499...96d8798` 完成 Standards/Spec 双轴并行审查；间隔异常位置与真值对照
  缺失及重复读取逻辑已修复，两个审查轴复核均无阻塞项。

已知限制：当前 IMU 合成格式增加 `sample_index` 作为样本身份，尚未接入真实设备格式适配；存储耗尽、
时间对齐和温升组合故障属于后续 ticket。故障真值仍使用局部字典结构，后续场景增多时再评估统一类型，
避免本 ticket 扩大重构范围。
