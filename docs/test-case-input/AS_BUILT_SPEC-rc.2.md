# v0.1.0-rc.2 实际实现规格（AS-BUILT）

## 0. 基线和状态语义

- 代码基线：`f80e7b39035e0908b5192a766bf771f67b10774d`。
- 仓库没有 `v0.1.0-rc.2` Git 标签；该提交是正式版 `v0.1.0` 元数据提交的父提交，正式版提交没有修改业务实现。
- 本文只依据该提交的前后端代码、测试、`SPEC.md`、ADR、RC2 范围核对文档和实际格式实现。
- `已实现`表示有代码和测试直接证据；`部分实现`表示有代码但有明确限制；`未实现`表示代码明确不支持；`未确认`表示现有证据不足。

## 1. 页面、入口和操作

CAP-001（已实现）：`frontend/src/App.tsx` 为单页入口；导航包括仪表盘与 AI 配置、新建任务、根据导入生成、已保存任务、运行详情，URL hash 可定位区域。

CAP-002（已实现）：仪表盘显示运行统计、近期失败、诊断状态和 AI 评估摘要；点击运行项进入运行详情。

CAP-003（已实现）：新建任务支持快速/标准/自定义模式、七种场景、参考通道、判定参数、任务名称建议和文件规模校验。

CAP-004（已实现）：根据导入生成支持上传 ZIP、权限确认、校验、查看校验状态、填写名称/标签和创建导入型任务；标准转换入口固定返回开发中提示。

CAP-005（已实现）：已保存任务使用一个管理面板，支持来源、执行状态、归档状态筛选和最多 10 条分页；进入页面自动加载任务与运行摘要。

CAP-006（已实现）：任务卡显示名称、归档标记、只读说明、来源、运行次数、创建时间以及每次运行的 ID、执行序号和状态链接。

CAP-007（已实现）：从未执行任务可删除；已有运行任务可归档；归档任务显示“仅查看和导出，不能执行或删除”。

CAP-008（已实现）：运行记录可右键隐藏，隐藏 ID 存于浏览器 localStorage，可恢复显示；该操作不删除后端运行或证据。

CAP-009（已实现）：运行详情显示任务名称、任务内执行序号、运行 ID、队列位置、阶段、事件、产物、检查、时间分析、判定、人工结果、诊断和报告入口。

CAP-010（已实现）：运行详情支持取消、终态重跑、锚点复核、人工结果、诊断、JSON/HTML/ZIP、原始视频和逐帧映射 CSV。

CAP-011（已实现）：设置支持 Mock、硅基流动、DeepSeek、Kimi、模型目录、自定义模型、临时 Key、连接测试和后端配置状态，不显示 Key 原值。

## 2. 页面状态和端到端流程

### 2.1 合成任务

1. 启动请求 `/api/health` 和普通任务列表。
2. 创建任务，后端保存 `draft` 任务和配置快照。
3. 执行任务，创建新的 `queued` 运行并提交给单执行器。
4. 运行依次进入 `generating_data`、`running_checks`、`summarizing_results`，成功后为 `completed`。
5. 前端对非终态运行短轮询，终态停止轮询。
6. 完成后可以复核锚点、录入人工结果、诊断、查看报告和导出证据。

### 2.2 已保存任务

CAP-012（已实现）：进入 `saved` 页面时自动调用 `GET /api/collection-tasks/saved`，不需要手工刷新；筛选、翻页、删除、归档后重新读取当前页。

CAP-013（已实现）：列表返回任务对应的运行摘要，按任务内执行序号倒序显示；点击运行记录请求 `GET /api/runs/{run_id}`。

CAP-014（部分实现）：右键移除是前端隐藏，不是后端删除；后端没有删除单条运行记录的 API，也不删除证据。

### 2.3 队列、取消、重跑和恢复

CAP-015（已实现）：单执行器同时处理一个运行，后续运行保持 `queued` 并返回队列位置。

CAP-016（已实现）：排队或执行中可以取消；状态条件更新避免执行线程覆盖取消状态。

CAP-017（已实现）：终态可重跑；新运行复制配置快照并使用新 ID/执行序号，原记录保留。

CAP-018（已实现）：应用启动将非终态改为 `interrupted`，并记录应用重启原因。

## 3. 已实现 API

错误通常为 FastAPI JSON `{"detail": ...}`；具体字段以响应模型为准。

| 编号    | 方法与路径                                                                | 请求                                                             | 成功响应                                         | 错误行为                                              |
| ------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| CAP-020 | GET `/api/health`                                                         | 无                                                               | `{"status":"ok","database":"ok"}`                | 数据库不可用 503                                      |
| CAP-021 | POST `/api/collection-tasks`                                              | `name,mode,scenario`；custom 还需 duration/video/imu/random_seed | 201 任务，状态 draft                             | 非法 422；重复名称 409                                |
| CAP-022 | GET `/api/collection-tasks`                                               | 无                                                               | 200 任务数组，ID 倒序                            | —                                                     |
| CAP-023 | GET `/api/collection-tasks/{task_id}`                                     | 路径 ID                                                          | 200 完整任务                                     | 不存在 404                                            |
| CAP-024 | GET `/api/collection-tasks/saved`                                         | page、page_size≤10、source、execution_status、archived           | 200 items/page/page_size/total，含 runs          | 参数 422                                              |
| CAP-025 | DELETE `/api/collection-tasks/{task_id}`                                  | 路径 ID                                                          | 204                                              | 不存在 404；有运行 409                                |
| CAP-026 | POST `/api/collection-tasks/{task_id}/archive`                            | 无                                                               | 200 已归档任务摘要                               | 不存在 404                                            |
| CAP-027 | POST `/api/collection-tasks/{task_id}/runs`                               | 合成无 body；导入需 reference_channel/evaluation                 | 201 初始 RunRecord                               | 不存在 404；导入配置缺失 422                          |
| CAP-028 | GET `/api/runs/{run_id}`                                                  | 路径 ID                                                          | 200 完整 RunRecord                               | 不存在 404                                            |
| CAP-029 | POST `/api/runs/{run_id}/cancel`                                          | 无                                                               | 200 更新运行                                     | 不存在 404；终态/竞争 409                             |
| CAP-030 | POST `/api/runs/{run_id}/rerun`                                           | 无                                                               | 201 新 RunRecord                                 | 不存在 404                                            |
| CAP-031 | POST `/api/runs/{run_id}/alignment-review`                                | anchors: anchor_id/reviewed_time_s/included                      | 200 更新运行和映射                               | 无对齐 409；未知锚点/锚点不足 422                     |
| CAP-032 | GET `/api/runs/{run_id}/frame-imu-alignment.csv`                          | 无                                                               | UTF-8 CSV 下载                                   | 运行/产物/文件不存在 404                              |
| CAP-033 | GET `/api/runs/{run_id}/videos/{channel}`                                 | `camera_1` 等                                                    | 原始 MP4/MKV 下载                                | 运行/通道/文件不存在 404                              |
| CAP-034 | GET `/api/runs/{run_id}/report`                                           | 无                                                               | ReportDocument JSON                              | 运行不存在 404                                        |
| CAP-035 | GET `/api/runs/{run_id}/report.html`                                      | 无                                                               | 独立 HTML                                        | 运行不存在 404                                        |
| CAP-036 | GET `/api/runs/{run_id}/evidence.zip`                                     | include_sample 默认 false                                        | 可验证 ZIP                                       | 运行不存在 404；未完成 409；大小/安全错误 413/422/500 |
| CAP-037 | POST `/api/runs/{run_id}/manual-check-results`                            | name/status/actual_result/notes/executed_at/attachment           | 201 人工结果                                     | 运行不存在 404；字段/附件错误 422/413                 |
| CAP-038 | PUT `/api/runs/{run_id}/manual-check-results/{result_id}`                 | 同创建                                                           | 200 人工结果                                     | 结果不存在 404；字段/附件错误 422/413                 |
| CAP-039 | GET `/api/runs/{run_id}/manual-check-results/{result_id}/attachment`      | 无                                                               | 原媒体类型文件                                   | 结果/附件/文件不存在 404                              |
| CAP-040 | POST `/api/runs/{run_id}/manual-check-results/import?filename=x.csv/xlsx` | CSV/XLSX 原始 body                                               | 201 人工结果数组                                 | >2 MiB 413；后缀/编码/表头/行错误 422                 |
| CAP-041 | POST `/api/runs/{run_id}/diagnoses`                                       | mode/provider/model/api_key 等                                   | 201 DiagnosisRun                                 | 运行不存在 404；未完成 409；模型错误保存为失败/可重试 |
| CAP-042 | GET `/api/runs/{run_id}/diagnoses`                                        | 无                                                               | 200 诊断数组                                     | 运行不存在 404                                        |
| CAP-043 | GET `/api/runs/{run_id}/ai-evaluation`                                    | 无                                                               | 200 AI 评估                                      | 无结果时返回未评估或行为未确认                        |
| CAP-044 | GET `/api/dashboard`                                                      | 无                                                               | 200 统计/近期失败/诊断/评估                      | 空库 200                                              |
| CAP-045 | GET `/api/settings/ai`                                                    | 无                                                               | provider/model/mode/api_key_configured/providers | 非法环境 mode 使用 mock                               |
| CAP-046 | POST `/api/settings/ai/test`                                              | provider/model/api_key                                           | 200 连接结果                                     | 未知模型 422；模型错误结构化返回                      |
| CAP-047 | POST `/api/imports`                                                       | multipart ZIP + permission_confirmed                             | 201 ImportRecord                                 | 权限/格式 422；>2 GiB 413；重复 SHA-256 409           |
| CAP-048 | GET `/api/imports/{import_id}`                                            | 路径 ID                                                          | 200 ImportRecord                                 | 不存在 404                                            |
| CAP-049 | POST `/api/imports/{import_id}/validate`                                  | 无                                                               | 200 校验和 manifest                              | 不存在 404；校验失败 422                              |
| CAP-050 | POST `/api/imports/{import_id}/convert`                                   | 无                                                               | 固定 409 开发中                                  | 始终 409                                              |
| CAP-051 | POST `/api/imports/{import_id}/create-task`                               | name、label                                                      | 201 导入型任务                                   | 未通过/已入库 409；不存在 404                         |
| CAP-052 | DELETE `/api/imports/{import_id}/staging`                                 | 无                                                               | 204                                              | 不存在 404；已入库 409                                |

## 4. 数据对象和约束

CAP-060：`CollectionTask` 含 id、name、label、mode、scenario、duration_seconds、video、imu、random_seed、reference_channel、evaluation、status、source、archived、created_at。

CAP-061：`SavedTask` 含 id、name、source、execution_status、archived、run_count、runs、created_at；运行摘要含 id、execution_number、status、created_at、completed_at。

CAP-062：视频配置为 channels 1～4、分辨率三选一、FPS 15/24/25/30/60/120、容器 mp4/mkv、codec=h264、码率 100～50000 且为 100 倍数、bitrate_mode=cbr/vbr。

CAP-063：IMU 配置为 csv/jsonl 和 50/100/200/500 Hz；RC2 生成契约包含三轴加速度和三轴角速度。

CAP-064：`RunRecord` 含任务名称、任务内执行序号、队列位置、状态、配置快照、阶段事件、产物、生成元数据、检查、对齐、判定、人工结果、诊断、时间和错误。

CAP-065：`Artifact` 类型为 video、imu、device_status、device_log、fault_truth、frame_imu_alignment；source 为 actual_generated、virtual_time_simulated 或 imported_actual_data；含 path、size_bytes、sha256 和可选原始设备时间。

CAP-066：`BasicCheck` 含 name、category、status（passed/failed/not_run）、message、metrics、anomaly_windows、truth_comparison、evidence_refs。

CAP-067：对齐结果含参考通道、方法、参数、漂移率、锚点、对齐前后指标、趋势、锚点详情、content_sync、frame_imu_alignment 和 review_revision。

CAP-068：人工结果状态为 passed/failed/blocked/not_run；名称最多 120 字符，结果和备注各最多 2000 字符；附件最多 1 MiB，允许 TXT/PNG/JPEG/PDF。

CAP-069：诊断证据 ref 匹配 `E[0-9]{3}`，类型包含 configuration、threshold、failed_check、anomaly_window、resource_metric、device_log、imu_summary、keyframe、manual_result；上限 32 KiB/4000 estimated tokens。

CAP-070：诊断包含现象、原因、证据引用、置信度、影响范围、复测建议、缺失证据、不确定性和限制；原因含 `is_speculation`。

## 5. 文件目录、编码和示例

CAP-080：默认数据目录为 `data`；数据库 `data/platform.sqlite3`；运行目录 `data/runs/<run-id>/`；导入临时目录 `data/imports/staging/<uuid>/`；附件位于运行目录下的 `manual-attachments`。

```text
data/
├── platform.sqlite3
├── imports/staging/<uuid>/source.zip
└── runs/<run-id>/
    ├── camera_1.mp4       # 或 .mkv，每路一个
    ├── imu.csv             # 或 imu.jsonl
    ├── device_status.csv
    ├── device.log
    ├── fault_truth.json
    └── frame_imu_alignment.csv
```

CAP-081：文本使用 UTF-8；CSV 使用 LF 行尾，证据 CSV 使用 UTF-8 BOM；JSON 缩进 2 空格；JSONL 每行一个 JSON 对象。

CAP-082：设备状态 CSV 表头为：

```csv
timestamp_s,cpu_percent,memory_percent,temperature_c,storage_free_mb
0.000,18.0,32.0,40.0,8192
```

CAP-083：RC2 六轴 IMU 最小字段示例为：

```csv
sample_index,timestamp_s,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z
0,0.000000,0.000000,0.000000,9.806650,0.000000,0.000000,0.000000
1,0.010000,0.019999,0.000000,9.806650,0.001000,0.000000,0.000000
```

CAP-084：`fault_truth.json` 至少包含 scenario、random_seed、faults、expected_basic_result；对齐场景额外包含参考通道和校正/漂移信息。

CAP-085：人工导入 CSV/XLSX 的第一行严格为 `name,status,actual_result,notes,executed_at`；CSV 可带 UTF-8 BOM。

```csv
name,status,actual_result,notes,executed_at
外观检查,blocked,无法观察,待补充证据,2026-08-26T10:00:00+00:00
```

CAP-086：逐帧映射列名由 `FrameImuAlignmentSummary.columns` 返回，详细文件通过 `/frame-imu-alignment.csv` 下载；数值随运行配置变化，不能固定断言。

## 6. 导入、报告和证据包

CAP-090：实际 ZIP 上传时保存 SHA-256 和 staging 路径；校验通过后保存 manifest、文件安全检查结果和导入记录。重复 SHA-256、路径穿越、故障真值或重复文件会被拒绝。

CAP-091：manifest 的视频条目可包含 path、codec、container、fps、resolution、bitrate_kbps；IMU 条目可包含 path、format、sample_rate_hz。导入任务执行前仍需人工配置参考通道和判定。

CAP-092：`report.json` 包含 run_id、status、error、configuration_snapshot、stage_events、generation_metadata、artifacts、automated_checks、fault_truth、alignment_result、evaluation_result、manual_check_results、diagnosis、created_at、completed_at。

CAP-093：`report.html` 不依赖应用、数据库或外部资源，包含配置、阶段、产物、真值、检查、时间分析、判定、人工结果、诊断和原始报告数据。

CAP-094：证据 ZIP 至少包含：

```text
report.json
report.html
checks.csv
manual-check-results.csv
device_status.csv
device.log
fault_truth.json
thumbnails/<video-stem>.png
evidence-manifest.json
SHA256SUMS.txt
```

人工附件位于 `manual-attachments/<id>-<filename>`；显式 `include_sample=true` 时增加 `samples/<video-stem>.sample.<ext>`；原始视频默认排除。

CAP-095：`checks.csv` 表头为 `name,category,status,truth_comparison,message,metrics,anomaly_windows,evidence_refs`；人工结果导出表头与导入模板一致。

CAP-096：清单格式为 `verifiable-evidence-v1`，包含 run_id、status、exported_at、export_note、included_video_sample、excluded_kinds、files、hashed_files；哈希条目含 path、size_bytes、sha256。

## 7. 能力状态

### 7.1 已实现

CAP-100：七种场景、三种任务模式、六轴 IMU、码率、时间契约和可重复输入有代码及 RC2 合同测试。

CAP-101：任务保存、已保存任务筛选分页、运行摘要、执行序号、归档/删除边界和进入页面自动加载有代码及测试。

CAP-102：固定偏移、线性漂移、锚点复核、逐帧最近邻映射、对齐前后指标和内容同步有代码及测试。

CAP-103：实际 ZIP 校验、manifest、重复导入保护、路径安全、导入任务和导入型运行配置有代码及测试。

CAP-104：人工结果、附件、CSV/XLSX、JSON/HTML、可验证 ZIP、缩略图、视频小样、清单/哈希和敏感信息检查有代码及测试。

CAP-105：Mock、硅基流动、DeepSeek、Kimi 的服务商隔离、模型目录、连接测试、Schema、证据引用、真值评估和失败降级有代码及契约测试。

### 7.2 部分实现

CAP-110：请求时长超过 5 秒时最多生成 5 秒真实媒体，长时趋势使用虚拟时间表达，不是完整真实 300 秒媒体。

CAP-111：右键移除只保存浏览器隐藏状态，不删除后端数据、运行记录或证据。

CAP-112：多个功能仍是单页区域，不是多个独立 HTML 页面或后端页面路由。

CAP-113：`keyframe` 诊断证据是文字摘要，不是视觉模型生成的图像关键帧；证据 ZIP 另生成 PNG 缩略图。

CAP-114：真实模型适配器存在且可由替身验证，但真实线上模型效果没有 rc2 证据；Mock 可离线运行。

### 7.3 未实现或未确认

CAP-120（未实现/未确认）：真实硬件、设备控制、刷机、串口、蓝牙、音频、真实 MCAP 和复杂非线性时间扭曲。

CAP-121（未实现）：实际测试 ZIP 的标准格式转换接口固定返回 409“开发中”。

CAP-122（未实现/未确认）：多人账户、权限、审批、团队协作、复杂用例管理、回归选择和覆盖率治理。

CAP-123（未确认）：真实线上 AI 效果、远端 GitHub Actions 运行记录和外部设备媒体兼容性。

CAP-124（未确认）：`device.log` 没有独立公开的逐行 Schema，只能依据生成代码和场景测试验证存在及相关内容。

## 8. 已知需求与实际行为差异

| 差异编号 | 相关需求      | rc2 实际行为                                       | 测试影响                                            |
| -------- | ------------- | -------------------------------------------------- | --------------------------------------------------- |
| GAP-001  | FR-012/FR-029 | 长时真实媒体最多 5 秒，ZIP 默认排除原始视频        | 不按请求时长断言真实视频，不期待默认 ZIP 含原始视频 |
| GAP-002  | FR-030        | keyframe 为文字摘要，不能当图像证据                | 摘要与 PNG 缩略图分开验证                           |
| GAP-003  | FR-016/FR-020 | 运行记录可从任务卡追溯，右键移除只是浏览器隐藏     | 不把隐藏解释为后端删除，不丢失运行详情              |
| GAP-004  | FR-027        | 标准格式转换未实现                                 | 预期 409 和开发中提示                               |
| GAP-005  | FR-031/FR-032 | 适配器和降级有契约证据，线上模型效果未确认         | 分开验证契约、Mock 和线上效果                       |
| GAP-006  | FR-027        | 导入任务从 manifest 推导部分配置，执行前需人工配置 | 不期待导入后立即执行                                |
| GAP-007  | NFR-008       | 证据 CSV 使用 UTF-8 BOM，普通日志无独立 Schema     | 验证编码/表头；日志只验证已知生成内容               |

## 9. 事实来源索引

| 内容                   | 来源                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 产品目标、范围、非目标 | `SPEC.md`、`CONTEXT.md`、`docs/adr/0001-clean-room-reimplementation.md`、`0002-full-stack-technology-route.md`                                                                                                                                                                                   |
| RC2 范围和服务商边界   | `docs/rc2-feedback-triage.md`、`docs/adr/0003-siliconflow-as-primary-model-provider.md`、`0004-preserve-pre-and-post-alignment-results.md`、`0005-separate-specification-target-and-baseline.md`、`0006-ai-is-not-on-the-test-critical-path.md`、`0007-structured-and-evaluable-ai-diagnosis.md` |
| 任务、保存任务、运行   | `backend/app/collection_tasks.py`、`run_models.py`、`run_routes.py`、`frontend/src/SavedTasksPanel.tsx`、`useAppController.ts`、相关任务生命周期测试                                                                                                                                             |
| 生成、检查、对齐       | `backend/app/normal_generator.py`、`video_generation.py`、`video_checks.py`、`imu_checks.py`、`time_alignment*.py`、RC2 合同和场景测试                                                                                                                                                           |
| 导入、报告、证据       | `backend/app/import_zip.py`、`import_validation.py`、`report.py`、`evidence_package.py`、相关 API 测试                                                                                                                                                                                           |
| 人工结果和 AI          | `manual_check_results.py`、`manual_result_import.py`、`settings.py`、`siliconflow.py`、`diagnosis.py`、`ai_evaluation.py`、相关契约测试                                                                                                                                                          |
| 页面行为               | `frontend/src/App.tsx`、`Navigation.tsx`、`CollectionTaskForm.tsx`、`ImportTaskPanel.tsx`、`RunDetail.tsx`、`DashboardPanel.tsx`、`ManualCheckResultsPanel.tsx`、`styles.css`                                                                                                                    |
