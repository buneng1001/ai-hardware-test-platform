# v0.1.0-rc.1 实际实现规格（AS-BUILT）

## 0. 基线与状态语义

- 唯一实现基线：Git 标签 `v0.1.0-rc.1`，提交 `25ae257e9424a21af5deeb088a260db85edd146f`。
- 本文只依据该标签下的代码、测试、需求/ADR 和已提交格式定义；不采用 RC2 文档或当前工作区未提交改动。
- `已实现`：代码和 RC1 测试有直接证据；`部分实现`：有代码但有明确限制；`未实现`：没有对应实现证据；`未确认`：资料不能证明。

## 1. 页面、入口和操作

CAP-001（已实现）：`frontend/src/App.tsx` 是单页面入口。启动调用 `/api/health` 和任务列表，显示服务状态、仪表盘、AI 设置、新建任务、任务列表和选中运行详情。

CAP-002（已实现）：`CollectionTaskForm.tsx` 支持快速/标准/自定义模式、七种场景、三种判定模式、失败阈值、参考时钟；自定义支持时长、通道数、分辨率、FPS、容器、IMU 格式/采样率和随机种子。

CAP-003（已实现）：保存任务后显示为 `draft`；任务卡可执行任务。页面失败提示为通用错误。

CAP-004（已实现）：`RunDetail.tsx` 显示状态、阶段事件、产物、检查、时间分析、人工结果、诊断和报告/证据下载入口；非终态可取消，终态可重跑。

CAP-005（已实现）：非终态运行通过短轮询刷新；显示 queued、生成数据、执行检查、汇总、完成、失败、取消、异常中断。

CAP-006（已实现）：运行详情显示参考时钟、对齐方法/参数、漂移率、趋势、对齐前后指标、真值对照、锚点详情、复核版本和内容同步；可提交锚点时间和是否纳入。

CAP-007（已实现）：人工结果面板支持新增、更新、四种状态、实际结果、执行时间、备注、小型附件、CSV/XLSX 导入和附件下载。

CAP-008（已实现）：AI 设置在单页区域中提供 Mock/硅基流动、模型、临时 Key、连接测试和后端配置状态读取；页面不显示 Key 原值。

CAP-009（已实现）：仪表盘显示运行统计、近期失败、诊断状态计数和评估汇总，可打开运行详情。

CAP-010（部分实现）：需求所说的五个独立页面/路由未在 RC1 中实现；实际为单页区域、运行详情和外部 HTML/ZIP。

## 2. 页面状态与端到端流程

### 2.1 正常流程

1. 页面请求健康状态和采集任务。
2. POST 创建 `draft` 任务并保存配置快照。
3. POST 执行任务，立即创建 `queued` 运行并交给单执行器。
4. 运行依次进入 `generating_data`、`running_checks`、`summarizing_results`、`completed`。
5. 页面刷新运行，查看产物、检查、对齐、判定、人工结果。
6. 完成运行可触发独立诊断，并打开 JSON/HTML 报告或下载 ZIP。

### 2.2 队列、取消、重跑和恢复

CAP-011（已实现）：同一执行器只运行一个任务，后续运行保持 `queued`。

CAP-012（已实现）：排队或执行中可取消；状态条件更新避免工作线程覆盖取消。

CAP-013（已实现）：终态可重跑；复制原配置快照但创建新运行 ID，原记录保留。

CAP-014（已实现）：应用启动将所有非终态运行改为 `interrupted`，错误为“应用重启时检测到未完成运行”。

CAP-015（部分实现）：没有独立的运行历史列表；历史可由仪表盘近期失败或已选运行访问。

## 3. 已实现 API

所有错误通常为 FastAPI JSON `{"detail": ...}`。

| 编号 | 方法与路径 | 请求 | 成功响应 | 已观察错误行为 |
| --- | --- | --- | --- | --- |
| CAP-020 | GET `/api/health` | 无 | `{"status":"ok","database":"ok"}` | 数据库不可用 503 |
| CAP-021 | POST `/api/collection-tasks` | JSON：`name,mode,scenario`；custom 还需时长、video、imu、seed；可选参考通道/evaluation | 201 任务对象，状态 draft | 非法输入 422；保存失败 500 |
| CAP-022 | GET `/api/collection-tasks` | 无 | 200，ID 倒序任务数组 | — |
| CAP-023 | GET `/api/collection-tasks/{task_id}` | 路径 ID | 200 任务对象 | 不存在 404 |
| CAP-024 | POST `/api/collection-tasks/{task_id}/runs` | 无 body | 201 初始运行记录，通常 queued | 任务不存在 404 |
| CAP-025 | GET `/api/runs/{run_id}` | 路径 ID | 200 完整 RunRecord | 不存在 404 |
| CAP-026 | POST `/api/runs/{run_id}/cancel` | 无 body | 200 更新运行记录 | 不存在 404；终态/状态竞争 409 |
| CAP-027 | POST `/api/runs/{run_id}/rerun` | 无 body | 201 新运行记录 | 不存在 404 |
| CAP-028 | POST `/api/runs/{run_id}/alignment-review` | `{"anchors":[{"anchor_id":string,"reviewed_time_s":number|null,"included":boolean}]}` | 200 更新运行记录 | 无结果 409；未知锚点或无效复核 422 |
| CAP-029 | GET `/api/runs/{run_id}/report` | 无 | 200 ReportDocument JSON | 不存在 404 |
| CAP-030 | GET `/api/runs/{run_id}/report.html` | 无 | 200 独立 HTML | 不存在 404 |
| CAP-031 | GET `/api/runs/{run_id}/evidence.zip` | `include_sample=false`（默认） | 200 application/zip，`run-{id}-evidence.zip` | 不存在 404；未完成 409；导出问题 413/422/500 |
| CAP-032 | GET `/api/runs/{run_id}/evidence.zip?include_sample=true` | 显式小样 | 200，含视频小样 | 小样超限 413 |
| CAP-033 | POST `/api/runs/{run_id}/diagnoses` | JSON：`mode`（默认 mock）、可选 model、api_key | 201 DiagnosisRun | 不存在 404；未完成 409；错误保存为 failed |
| CAP-034 | GET `/api/runs/{run_id}/diagnoses` | 无 | 200 诊断数组 | 运行不存在 404 |
| CAP-035 | GET `/api/runs/{run_id}/ai-evaluation` | 无 | 200 AiEvaluationResult | 无可评估结果时具体行为未确认 |
| CAP-036 | GET `/api/dashboard` | 无 | 200 统计、近期失败、诊断计数、评估汇总 | 空库仍 200 |
| CAP-037 | GET `/api/settings/ai` | 无 | 200 provider/model/mode/api_key_configured | 非法 mode 降为 mock |
| CAP-038 | POST `/api/settings/ai/test` | JSON：model、api_key | 200 ok/provider/model/error_kind/message | 模型错误仍 200 且 ok=false；Schema 错误 422 |
| CAP-039 | POST `/api/runs/{run_id}/manual-check-results` | JSON：name/status/actual_result/notes/executed_at/attachment | 201 人工结果 | 不存在 404；字段/附件限制 422/413 |
| CAP-040 | PUT `/api/runs/{run_id}/manual-check-results/{result_id}` | 同创建 | 200 人工结果 | 不存在 404；字段/附件限制 422/413 |
| CAP-041 | GET `/api/runs/{run_id}/manual-check-results/{result_id}/attachment` | 无 | 200 原媒体类型和文件名 | 结果/附件/文件不存在 404 |
| CAP-042 | POST `/api/runs/{run_id}/manual-check-results/import?filename=...` | 原始 CSV/XLSX body；后缀决定解析 | 201 人工结果数组 | >2MiB 413；格式/编码/表头/行错误 422 |

## 4. 数据对象、字段、类型和约束

CAP-050：`CollectionTask`：`id:int`、`name:string`、`mode`、`scenario`、`duration_seconds:int`、`video`、`imu`、`random_seed:int`、`reference_channel`、`evaluation`、`status:draft`、`created_at:datetime`。

CAP-051：视频：`channels:int[1,4]`、`resolution` 为 640x360/1280x720/1920x1080、`fps` 为 15/24/25/30/60、`container` 为 mp4/mkv、`codec=h264`。

CAP-052：IMU：`format=csv|jsonl`、`sample_rate_hz=50|100|200|500`。

CAP-053：判定：`mode` 为 requirements_acceptance/engineering_target/baseline_analysis；来源必须分别为 formal_specification/engineering_target/version_baseline；阈值名支持 max_failed_checks、max_alignment_residual_ms；优先级三种来源各一次。

CAP-054：`RunRecord` 含 id、collection_task_id、status、configuration_snapshot、events、artifacts、generation_metadata、checks、alignment_result、evaluation_result、manual_check_results、diagnosis_runs、created_at、completed_at、error。

CAP-055：`Artifact` 的 kind 为 video/imu/device_status/device_log/fault_truth，source 为 actual_generated/virtual_time_simulated，另有 path、size_bytes、sha256 和可空 h264 codec。

CAP-056：`BasicCheck` 含 name、category、status、message、metrics、anomaly_windows、truth_comparison、evidence_refs；类别 video/imu/resource/log/storage，状态 passed/failed。

CAP-057：`TimeAlignmentResult` 含参考通道、方法 fixed_offset_anchor/linear_drift_regression、参数、漂移率、锚点、对齐前后指标、趋势、锚点详情、content_sync、review_revision 和真值对照。

CAP-058：锚点含 id、channel、非负 event_index、detected_time_s、可空 reviewed_time_s、included、source(video_flash/imu_peak)；内容同步含状态、事件数、匹配索引和消息。

CAP-059：人工结果含 id、run_id、name、status(passed/failed/blocked/not_run)、可空 actual_result/notes/executed_at/attachment、created_at、updated_at；名称最多 120，结果和备注各最多 2000 字符。

CAP-060：附件元数据含 filename、content_type、size_bytes、sha256；允许 text/plain、image/png、image/jpeg、application/pdf，最大 1MiB。

CAP-061：诊断证据 `ref` 匹配 `E[0-9]{3}`；类型包括 configuration、threshold、failed_check、anomaly_window、resource_metric、device_log、imu_summary、keyframe、manual_result。

CAP-062：诊断证据包最大 32KiB/4000 estimated tokens；固定顺序加入，超限停止并 `truncated=true`。

CAP-063：结构化诊断含 diagnosis_status、phenomena、possible_causes（含 confidence/is_speculation）、impact_scope、retest_recommendations、missing_evidence、uncertainties、limitations。

CAP-064：AI 评估分开记录 structure_valid、期望/诊断/命中/漏判故障类型、无依据推测、误报、原因和汇总。

## 5. 文件目录、编码与示例

CAP-070：`APP_DATA_DIR` 默认 `data`；数据库 `<data-dir>/platform.sqlite3`；运行产物 `runs/<run-id>/`；人工附件 `runs/<run-id>/manual-attachments/<result-id>-<filename>`。

```text
data/
├── platform.sqlite3
└── runs/<run-id>/
    ├── camera_1.mp4       # 或 .mkv；按 channels 生成；H.264
    ├── imu.csv            # 或 imu.jsonl
    ├── device_status.csv
    ├── device.log
    └── fault_truth.json
```

CAP-071：文本产物 UTF-8，CSV LF 行尾；普通 JSON 缩进 2 空格；IMU JSONL 每行一个紧凑 JSON 对象。

CAP-072：设备状态 CSV 表头为 `timestamp_s,cpu_percent,memory_percent,temperature_c,storage_free_mb`。

```csv
timestamp_s,cpu_percent,memory_percent,temperature_c,storage_free_mb
0.000,18.0,32.0,40.0,8192
1.000,20.0,35.0,40.3,8190
```

CAP-073：IMU CSV/JSONL 字段为 `sample_index,timestamp_s,accel_x,accel_y,accel_z`，通常时间和加速度保留 6 位小数。

```csv
sample_index,timestamp_s,accel_x,accel_y,accel_z
0,0.000000,0.000000,0.000000,9.806650
1,0.020000,0.019999,0.000000,9.806650
```

```json
{"sample_index":0,"timestamp_s":"0.000000","accel_x":"0.000000","accel_y":"0.000000","accel_z":"9.806650"}
```

CAP-074：`fault_truth.json` 至少包含 scenario、random_seed、faults、expected_basic_result；IMU 场景可含异常样本索引，对齐场景可含 reference_channel、alignment_corrections_s 和漂移率。

```json
{
  "scenario": "video_drop",
  "random_seed": 20260822,
  "faults": [{"type":"video_frame_drop","channel":1,"start_s":0.8,"end_s":1.2,"dropped_frames":6}],
  "expected_basic_result": "video_frame_drop"
}
```

CAP-075（未确认格式）：`device.log` 为 UTF-8 场景日志，代码生成温升、掉帧、IMU、存储相关事件；RC1 未定义统一逐行 Schema。

CAP-076：人工 CSV 表头严格为 `name,status,actual_result,notes,executed_at`；XLSX 第一工作表第一行同样严格，支持 datetime 转 ISO。

```csv
name,status,actual_result,notes,executed_at
外观检查,blocked,无法观察,待补充证据,2026-08-26T10:00:00+00:00
```

## 6. 报告和证据包格式

CAP-080：`report.json` 对应 ReportDocument，含 run_id、status、error、configuration_snapshot、stage_events、generation_metadata、artifacts、automated_checks、fault_truth、alignment_result、evaluation_result、manual_check_results、diagnosis、created_at、completed_at。

CAP-081：独立 `report.html` 不依赖应用、数据库或外部资源，包含配置、阶段、产物、真值、检查表、时间分析、判定、人工结果、诊断和原始报告数据。

CAP-082：默认 ZIP 至少包含：

```text
report.json
report.html
checks.csv
manual-check-results.csv
device_status.csv
device.log
fault_truth.json
evidence-manifest.json
SHA256SUMS.txt
```

人工附件进入 `manual-attachments/<id>-<filename>`；显式 include_sample=true 时增加 `samples/<video-stem>.sample.<ext>`；默认不含原始视频。

CAP-083：`checks.csv` 表头为 `name,category,status,truth_comparison,message,metrics,anomaly_windows,evidence_refs`；人工结果 CSV 表头为 `id,name,status,actual_result,notes,executed_at,attachment`。

CAP-084：清单 `format=verifiable-evidence-v1`，含 run_id、included_video_sample、excluded_kinds、files、hashed_files；哈希条目含 path、size_bytes、sha256。`SHA256SUMS.txt` 每行 `<sha256>  <path>`。

## 7. 能力状态

### 已实现

CAP-090：七种场景、短视频/IMU/设备状态/日志/真值生成、确定性视频/IMU/资源/存储/日志检查、真值对照和可重复指纹有代码及 RC1 测试证据。

CAP-091：固定偏移/线性漂移对齐、锚点复核、对齐前后指标和内容同步独立结果有代码及测试证据。

CAP-092：三种判定模式、阈值来源校验、人工结果、CSV/XLSX 导入、附件、JSON/HTML 报告和 ZIP 清单/哈希有代码及测试证据。

CAP-093：Mock 诊断、硅基流动适配器契约、Schema、证据引用校验、故障真值评估和模型失败降级有代码及测试证据。

### 部分实现

CAP-094：请求时长超过 5 秒时只生成最多 5 秒真实媒体，长时趋势通过虚拟时间表示；不是完整真实 300 秒媒体。

CAP-095：关键帧证据是“未生成可供 Mock 分析的画面关键帧”的文字摘要，不是图像关键帧或视觉分析。

CAP-096：AI 设置、任务、运行详情和报告集中在单页；需求中的五个独立页面/路由没有完整体现。

CAP-097：真实模型调用支持适配器契约和失败降级，但 RC1 没有真实 Key，因此线上模型效果未验证。

### 未实现或未确认

CAP-098（未实现/未确认）：真实硬件、音频、蓝牙、MCAP、设备控制、刷机、串口、复杂非线性时间扭曲。

CAP-099（未实现/未确认）：多人账户、权限、审批、团队协作、复杂用例管理、回归选择和覆盖率治理。

CAP-100（未确认）：`device.log` 逐行公开格式、远端 GitHub Actions 实际运行记录；RC1 验收清单明确二者未验证，真实硅基流动线上效果也未验证。

## 8. 已知需求与实际行为差异

| 差异编号 | 相关需求 | RC1 实际行为 | 测试影响 |
| --- | --- | --- | --- |
| GAP-001 | FR-010/FR-028 | 长请求只产生最多 5 秒真实媒体；ZIP 默认排除视频 | 不按请求时长断言视频实际时长，不期待默认 ZIP 有视频 |
| GAP-002 | FR-029 | keyframe 条目是文字摘要，没有实际画面关键帧 | 不能把 keyframe 条目当图像证据 |
| GAP-003 | FR-034 | 仪表盘存在但为单页区域，不是独立路由 | 按单页区域验证 |
| GAP-004 | FR-032/FR-033 | Mock/契约/降级有证据，线上模型效果未验证 | 分开验证契约与线上效果，后者标未确认 |
| GAP-005 | FR-026 | 人工批量导入只有 CSV/XLSX，导入行不携带附件 | 不期待批量导入附件 |
| GAP-006 | FR-075 | `device.log` 没有统一行格式定义 | 只验证文件存在和场景相关内容，具体行 Schema 标未确认 |

## 9. RC1 来源索引

| 内容 | 文件 |
| --- | --- |
| 需求与范围 | `SPEC.md`、`.scratch/ai-hardware-test-execution-diagnosis-platform/spec.md` |
| ADR 与边界 | `docs/adr/0001-clean-room-reimplementation.md`、`0002-full-stack-technology-route.md`、`0004-preserve-pre-and-post-alignment-results.md`、`0005-separate-specification-target-and-baseline.md`、`0006-ai-is-not-on-the-test-critical-path.md`、`0007-structured-and-evaluable-ai-diagnosis.md` |
| 验收状态 | `docs/v1-acceptance-checklist.md` |
| API/模型 | `backend/app/main.py`、`collection_tasks.py`、`run_models.py`、`runs.py`、`diagnosis.py`、`report.py`、`evidence_package.py`、`manual_check_results.py`、`manual_result_import.py`、`settings.py` |
| 文件生成/检查 | `backend/app/normal_generator.py`、`video_generation.py`、`video_checks.py`、`imu_checks.py`、`resource_checks.py`、`storage_checks.py`、`time_alignment.py` |
| 页面/调用 | `frontend/src/App.tsx`、`CollectionTaskForm.tsx`、`RunDetail.tsx`、`DashboardPanel.tsx`、`ManualCheckResultsPanel.tsx`、各 `*Api.ts` |
| 测试 | `backend/tests/test_*_api.py`、`backend/tests/test_siliconflow_contract.py` |
