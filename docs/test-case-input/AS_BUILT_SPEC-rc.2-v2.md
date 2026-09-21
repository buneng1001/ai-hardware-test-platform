# v0.1.0-rc.2 实际实现规格（AS-BUILT）v2

## 0. 基线和状态

- 代码基线：`f80e7b39035e0908b5192a766bf771f67b10774d`。
- 仓库没有 `v0.1.0-rc.2` Git 标签；正式版提交只更新版本元数据。
- 来源：后端/前端代码、测试、`SPEC.md`、ADR、`docs/rc2-feedback-triage.md` 和实际格式实现。
- 状态：`已实现`有代码和测试证据；`部分实现`有明确限制；`未实现/未确认`没有完整交付证据。

## 1. 页面和流程

CAP-001（已实现）：`frontend/src/App.tsx` 为单页入口，导航包含仪表盘与 AI 配置、新建任务、根据导入生成、已保存任务、运行详情；URL hash 可定位页面。

CAP-002（已实现）：仪表盘显示运行统计、近期失败、诊断状态和 AI 评估摘要，运行项可打开详情。

CAP-003（已实现）：新建任务支持快速/标准/自定义、七种场景、参数配置、参考通道、判定配置、名称建议和规模校验。

CAP-004（已实现）：导入页面支持 ZIP 上传、权限确认、校验、名称/标签和创建导入任务；标准格式转换固定提示开发中。

CAP-005（已实现）：已保存任务为一个管理面板，支持来源/执行/归档筛选、每页最多 10 条；进入页面自动加载任务和运行摘要。

CAP-006（已实现）：任务卡显示名称、归档标记、来源、运行次数、创建时间及每次运行的 ID、执行序号、状态链接。

CAP-007（已实现）：未执行任务可删除；已有运行任务可归档；归档任务显示仅查看和导出，不能执行或删除。

CAP-008（部分实现）：运行记录右键隐藏，ID 存在浏览器 localStorage，可恢复显示；只改变当前浏览器显示，不删除后端记录。

CAP-009（已实现）：运行详情显示任务名称、任务内执行序号、运行 ID、队列位置、阶段、事件、产物、检查、对齐、判定、人工结果、诊断和报告。

CAP-010（已实现）：运行详情支持取消、终态重跑、锚点复核、人工结果、诊断、JSON/HTML/ZIP、原始视频和逐帧映射 CSV。

CAP-011（已实现）：设置支持 Mock、硅基流动、DeepSeek、Kimi、模型目录、自定义模型、临时 Key 和连接测试，不显示 Key 原值。

## 2. 端到端状态

CAP-012（已实现）：合成任务流程为创建 `draft` → 执行创建 `queued` → `generating_data` → `running_checks` → `summarizing_results` → `completed`；错误、取消和重启分别进入 `failed`、`cancelled`、`interrupted`。

CAP-013（已实现）：单执行器一次处理一个运行，其他运行排队；非终态运行短轮询，终态停止轮询。

CAP-014（已实现）：终态重跑复制配置快照，产生新的运行 ID 和任务内执行序号，原记录保留。

CAP-015（已实现）：进入已保存任务页面自动请求 `/api/collection-tasks/saved`；筛选、翻页、删除、归档后重新读取当前页。

CAP-016（已实现）：运行摘要按任务内执行序号倒序展示，链接请求 `GET /api/runs/{run_id}`。

## 3. API 契约

错误通常为 FastAPI JSON `{"detail": ...}`。

| 编号    | 方法和路径                                                       | 请求                                                   | 成功响应                                 | 主要错误                              |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- | ------------------------------------- |
| CAP-020 | GET `/api/health`                                                | 无                                                     | status/database 均为 ok                  | 数据库不可用 503                      |
| CAP-021 | POST `/api/collection-tasks`                                     | name、mode、scenario；custom 需完整配置                | 201 任务，状态 draft                     | 非法 422；重名 409                    |
| CAP-022 | GET `/api/collection-tasks`                                      | 无                                                     | 200 任务数组                             | —                                     |
| CAP-023 | GET `/api/collection-tasks/{id}`                                 | 路径 ID                                                | 200 完整任务                             | 不存在 404                            |
| CAP-024 | GET `/api/collection-tasks/saved`                                | page、page_size≤10、source、execution_status、archived | 200 items/page/page_size/total，含 runs  | 参数 422                              |
| CAP-025 | DELETE `/api/collection-tasks/{id}`                              | 路径 ID                                                | 204                                      | 不存在 404；有运行 409                |
| CAP-026 | POST `/api/collection-tasks/{id}/archive`                        | 无                                                     | 200 已归档摘要                           | 不存在 404                            |
| CAP-027 | POST `/api/collection-tasks/{id}/runs`                           | 导入任务需 reference_channel/evaluation                | 201 初始 RunRecord                       | 不存在 404；配置缺失 422              |
| CAP-028 | GET `/api/runs/{id}`                                             | 路径 ID                                                | 200 完整 RunRecord                       | 不存在 404                            |
| CAP-029 | POST `/api/runs/{id}/cancel`                                     | 无                                                     | 200 更新运行                             | 终态/状态竞争 409                     |
| CAP-030 | POST `/api/runs/{id}/rerun`                                      | 无                                                     | 201 新运行                               | 不存在 404                            |
| CAP-031 | POST `/api/runs/{id}/alignment-review`                           | anchors：anchor_id/reviewed_time_s/included            | 200 更新运行和映射                       | 无对齐 409；锚点问题 422              |
| CAP-032 | GET `/api/runs/{id}/frame-imu-alignment.csv`                     | 无                                                     | CSV 文件下载                             | 运行/产物/文件不存在 404              |
| CAP-033 | GET `/api/runs/{id}/videos/{channel}`                            | 如 camera_1                                            | 原始 MP4/MKV 下载                        | 运行/通道/文件不存在 404              |
| CAP-034 | GET `/api/runs/{id}/report`                                      | 无                                                     | ReportDocument JSON                      | 运行不存在 404                        |
| CAP-035 | GET `/api/runs/{id}/report.html`                                 | 无                                                     | 独立 HTML                                | 运行不存在 404                        |
| CAP-036 | GET `/api/runs/{id}/evidence.zip`                                | include_sample 默认 false                              | 可验证 ZIP                               | 未完成 409；大小/安全错误 413/422/500 |
| CAP-037 | POST `/api/runs/{id}/manual-check-results`                       | 检查名称、状态、结果、备注、时间、附件                 | 201 人工结果                             | 字段/附件错误 422/413                 |
| CAP-038 | PUT `/api/runs/{id}/manual-check-results/{result_id}`            | 同创建                                                 | 200 人工结果                             | 结果不存在 404                        |
| CAP-039 | GET `/api/runs/{id}/manual-check-results/{result_id}/attachment` | 无                                                     | 原媒体类型文件                           | 结果/附件不存在 404                   |
| CAP-040 | POST `/api/runs/{id}/manual-check-results/import`                | filename 查询参数 + CSV/XLSX body                      | 201 结果数组                             | >2 MiB/格式/表头/行错误 413/422       |
| CAP-041 | POST `/api/runs/{id}/diagnoses`                                  | mode/provider/model/api_key 等                         | 201 DiagnosisRun                         | 未完成 409；模型错误保存失败/可重试   |
| CAP-042 | GET `/api/runs/{id}/diagnoses`                                   | 无                                                     | 200 诊断数组                             | 运行不存在 404                        |
| CAP-043 | GET `/api/runs/{id}/ai-evaluation`                               | 无                                                     | 200 AI 评估                              | 无结果行为部分未确认                  |
| CAP-044 | GET `/api/dashboard`                                             | 无                                                     | 200 统计、失败、诊断、评估               | 空库 200                              |
| CAP-045 | GET `/api/settings/ai`                                           | 无                                                     | provider/model/mode/configured/providers | 非法 mode 使用 mock                   |
| CAP-046 | POST `/api/settings/ai/test`                                     | provider/model/api_key                                 | 200 连接结果                             | 未知模型 422；服务错误结构化返回      |
| CAP-047 | POST `/api/imports`                                              | multipart ZIP + permission_confirmed                   | 201 ImportRecord                         | 权限/格式 422；>2 GiB 413；重复 409   |
| CAP-048 | GET `/api/imports/{id}`                                          | 路径 ID                                                | 200 ImportRecord                         | 不存在 404                            |
| CAP-049 | POST `/api/imports/{id}/validate`                                | 无                                                     | 200 校验和 manifest                      | 校验失败 422                          |
| CAP-050 | POST `/api/imports/{id}/convert`                                 | 无                                                     | 固定 409 开发中                          | 始终 409                              |
| CAP-051 | POST `/api/imports/{id}/create-task`                             | name、label                                            | 201 导入型任务                           | 未通过/已入库 409                     |
| CAP-052 | DELETE `/api/imports/{id}/staging`                               | 无                                                     | 204                                      | 已入库 409                            |

## 4. 数据对象

CAP-060：`CollectionTask` 含 id、name、label、mode、scenario、duration_seconds、video、imu、random_seed、reference_channel、evaluation、status、source、archived、created_at。

CAP-061：`SavedTask` 含 id、name、source、execution_status、archived、run_count、runs、created_at；运行摘要含 id、execution_number、status、created_at、completed_at。

CAP-062：视频为 1～4 路，分辨率 `640x360|1280x720|1920x1080`，FPS `15|24|25|30|60|120`，容器 `mp4|mkv`，codec=h264，码率 100～50000 且为 100 倍数，码率模式 cbr/vbr。

CAP-063：IMU 为 csv/jsonl 和 50/100/200/500 Hz；RC2 生成契约含 accel_x/y/z 与 gyro_x/y/z。

CAP-064：`RunRecord` 含任务信息、状态、配置快照、事件、产物、生成元数据、检查、对齐、判定、人工结果、诊断、时间和错误。

CAP-065：产物类型为 video、imu、device_status、device_log、fault_truth、frame_imu_alignment；含 path、source、size_bytes、sha256 和可选原始设备时间。

CAP-066：检查含 name、category、status、message、metrics、anomaly_windows、truth_comparison、evidence_refs。

CAP-067：对齐含参考通道、方法、参数、漂移率、锚点、对齐前后指标、趋势、内容同步、逐帧映射和复核版本。

CAP-068：人工结果状态为 passed/failed/blocked/not_run；名称最多 120，结果和备注各最多 2000；附件最多 1 MiB，允许 TXT/PNG/JPEG/PDF。

CAP-069：诊断引用格式为 `E[0-9]{3}`，证据包上限 32 KiB/4000 estimated tokens；原因包含 confidence 和 is_speculation。

## 5. 文件和证据格式

CAP-080：默认数据目录为 `data`，数据库为 `data/platform.sqlite3`，运行目录为 `data/runs/<run-id>/`，导入 staging 为 `data/imports/staging/<uuid>/`。

```text
data/runs/<run-id>/
├── camera_1.mp4       # 或 .mkv，每路一个
├── imu.csv             # 或 imu.jsonl
├── device_status.csv
├── device.log
├── fault_truth.json
└── frame_imu_alignment.csv
```

CAP-081：文本使用 UTF-8；CSV 使用 LF 行尾，证据 CSV 使用 UTF-8 BOM；JSON 缩进 2 空格；JSONL 每行一个对象。

CAP-082：设备状态表头：`timestamp_s,cpu_percent,memory_percent,temperature_c,storage_free_mb`。

CAP-083：六轴 IMU 表头：`sample_index,timestamp_s,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z`。

CAP-084：人工文件表头：`name,status,actual_result,notes,executed_at`；CSV 可带 BOM，XLSX 使用第一工作表。

CAP-085：证据 ZIP 含 `report.json`、`report.html`、`checks.csv`、`manual-check-results.csv`、设备状态、日志、真值、视频 PNG 缩略图、`evidence-manifest.json`、`SHA256SUMS.txt`。

CAP-086：原始视频默认排除；`include_sample=true` 时加入每路最多 1 秒小样。清单格式为 `verifiable-evidence-v1`，含导出时间、文件列表和 path/size_bytes/sha256。

## 6. 能力状态和差异

CAP-090（已实现）：七种场景、任务模式、六轴 IMU、码率、任务生命周期、运行追溯、对齐、人工结果、导入、报告、证据包和多服务商 AI 均有代码及测试证据。

CAP-091（部分实现）：超过 5 秒的请求最多生成 5 秒真实媒体，长时趋势使用虚拟时间。

CAP-092（部分实现）：右键移除只隐藏浏览器列表，不删除后端运行或证据。

CAP-093（部分实现）：keyframe 诊断证据是文字摘要，证据包的 PNG 缩略图是独立人工复查产物。

CAP-094（部分实现）：多个页面是单页区域，标准格式转换仍返回 409 开发中。

CAP-095（未确认）：真实线上模型效果、远端 CI 运行记录和外部设备媒体兼容性没有 rc2 证据。

CAP-096（未确认）：`device.log` 没有独立公开的逐行 Schema。

NONTARGET-001：真实硬件、设备控制、刷机、串口、蓝牙、音频、真实 MCAP、多人权限和复杂用例管理不在 rc2 交付范围。

## 7. 来源索引

| 主题               | 主要来源                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 需求、目标、非目标 | `SPEC.md`、`CONTEXT.md`、`docs/adr/`                                                                                      |
| RC2 范围           | `docs/rc2-feedback-triage.md`                                                                                             |
| 任务和运行         | `backend/app/collection_tasks.py`、`run_models.py`、`run_routes.py`、`frontend/src/SavedTasksPanel.tsx`、相关测试         |
| 生成和检查         | `normal_generator.py`、`video_generation.py`、`video_checks.py`、`imu_checks.py`、`time_alignment*.py`、RC2 合同测试      |
| 导入、报告和证据   | `import_zip.py`、`import_validation.py`、`report.py`、`evidence_package.py`、对应 API 测试                                |
| 人工结果和 AI      | `manual_check_results.py`、`manual_result_import.py`、`settings.py`、`siliconflow.py`、`diagnosis.py`、`ai_evaluation.py` |
