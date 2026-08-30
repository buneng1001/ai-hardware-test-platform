# v0.1.0-rc.1 软件需求规格（SRS）

## 0. 基线与证据规则

- 唯一基线：Git 标签 `v0.1.0-rc.1`，提交 `25ae257e9424a21af5deeb088a260db85edd146f`。
- 本文描述该版本“应该实现什么”，不是对当前工作区的描述。
- 来源：`SPEC.md`、`.scratch/ai-hardware-test-execution-diagnosis-platform/spec.md`、`docs/adr/0001`～`0007`、`docs/v1-acceptance-checklist.md`。
- 产品形态：本机运行、单测试工程师使用、洁净重写、只使用虚构设备、公开格式和合成数据。

## 1. 产品目标与范围

GOAL-001：无真实设备和公司数据时，生成可重复的多路视频、IMU、设备状态和日志，复现典型采集质量问题。

GOAL-002：用不依赖 AI 的确定性检查器输出事实，保留故障真值、指标、异常窗口和证据引用。

GOAL-003：分别评价原始时间差异、时间对齐效果和画面内容同步，保留对齐前后结果。

GOAL-004：提供受约束、可评估的结构化 AI 诊断；模型不可用时不阻断生成、检查、汇总和原始报告。

SCOPE-001：支持 1～4 路 H.264 视频、1 路 IMU、设备资源指标和设备日志。

SCOPE-002：支持正常采集、单路掉帧、IMU 异常、存储不足、温升组合故障、固定偏移和线性漂移场景。

SCOPE-003：支持采集任务、运行记录、确定性检查、时间分析、人工结果、报告、ZIP 证据包和 AI 诊断。

### 非目标

NONTARGET-001：不复刻原公司产品、协议、界面、内部流程或任何原公司资产。

NONTARGET-002：首版不接入真实设备，不实现设备控制、刷机、串口、蓝牙、音频和真实 MCAP。

NONTARGET-003：不建设多人账户、权限、审批、团队协作或复杂用例管理。

NONTARGET-004：AI 不控制设备、不修改事实、不决定确定性检查结果、不生成验收阈值。

NONTARGET-005：不实现复杂非线性时间扭曲。

## 2. 用户角色与运行约束

ROLE-001：测试工程师。创建任务、选场景和参数、执行/取消/重跑、查看结果、录入人工结果、复核锚点、触发诊断。

ROLE-002：面试官或复核者。通过本地页面、独立 HTML 和 ZIP 证据包查看结果，不需要账户。

BR-001：应用为单用户本机应用；同一时间只执行一个测试任务，其他任务排队。

## 3. 功能需求

### 3.1 任务与数据配置

FR-001：创建、列表查询和详情查询采集任务；新任务状态为 `draft`。

FR-002：任务名称去除首尾空白后为 1～80 字符，空名称拒绝。

FR-003：支持 `quick`、`standard`、`custom`。快速预设为 2 秒/1 路/640x360/30 FPS/3000kbps/MP4/CSV/100Hz；标准预设为 5 秒/4 路/1280x720/30 FPS/6000kbps/MP4/CSV/200Hz；预设随机种子为 20260822。快速和标准的路数及详细参数固定，自定义模式可调整。

FR-004：自定义模式要求完整提供时长、视频、IMU 和随机种子。

FR-005：时长 2～300 秒；视频通道 1～4；分辨率 `640x360`、`1280x720`、`1920x1080`；自定义模式 FPS 为 24、25、30、60、120；码率为 100～50000kbps 且必须为 100 的整数倍；容器 MP4/MKV；编码固定 H.264。

FR-006：IMU 格式 CSV/JSONL，采样率 50/100/200/500Hz；随机种子为 0～2147483647。

FR-007：参考通道支持 `camera_1`～`camera_4` 和 `imu`，相机参考通道必须存在于当前视频通道数内。

FR-008：执行前拒绝预计超过安全文件规模的配置；计算使用最多 5 秒实际媒体时长和 600,000,000 像素帧上限。

### 3.2 场景、生成与检查

FR-009：每个内置场景具有固定随机种子、故障真值和预期检查结果。

FR-010：生成视频、IMU、设备状态、设备日志和故障真值，为产物保存相对路径、来源、大小、SHA-256；短媒体真实生成，长稳趋势可用虚拟时间。

FR-011：检查器覆盖视频、IMU、资源、日志和存储，统一输出名称、类别、通过/失败、说明、指标、异常窗口、真值对照和证据引用。

FR-012：运行记录保存配置快照、阶段事件、产物、生成元数据、检查结果、时间分析、判定结果、人工结果和错误。

FR-013：重新执行创建新的不可覆盖运行记录。

### 3.3 运行管理

FR-014：运行状态为 `queued`、`generating_data`、`running_checks`、`summarizing_results`、`completed`、`failed`、`cancelled`、`interrupted`。

FR-015：支持排队、执行中安全取消、终态重跑和运行详情查询。

FR-016：应用重启时，所有非终态运行标记为 `interrupted`，记录完成时间和中断原因。

FR-017：取消或失败不得伪装为完成；完整证据包只对已完成运行开放。

### 3.4 时间分析

FR-018：支持固定偏移校正和基于多个共同事件的线性漂移校正；默认参考时钟为第一路相机，可选择其他通道。

FR-019：视频时间码/闪烁事件与 IMU 冲击峰值作为跨模态锚点；自动识别并允许人工调整时间和是否纳入。

FR-020：报告同时保存原始时间戳、对齐前指标、方法与参数、对齐后最大/平均/P95 残差、漂移趋势和内容同步结果。

FR-021：时间戳对齐与画面内容同步独立评价，时间接近不能替代内容同步。

### 3.5 判定与人工检查

FR-022：支持 `requirements_acceptance`、`engineering_target`、`baseline_analysis`，分别对应正式规格、工程目标、版本基线。

FR-023：只有正式规格模式可输出产品验收结论；工程目标标明不是产品承诺；版本基线只展示分布和趋势。

FR-024：阈值来源和优先级进入报告；AI 不得创建、补充或修改阈值。

FR-025：支持人工检查项的新增、更新、通过/失败/阻塞/未执行、实际结果、备注、执行时间和小型附件。

FR-026：支持统一模板 CSV/XLSX 导入；人工结果与自动化检查独立存储并在报告统一展示。

### 3.6 报告、证据与 AI

FR-027：提供应用内运行详情、JSON 报告、独立 HTML 报告和 ZIP 证据包。

FR-028：ZIP 包含结构化报告、检查 CSV、人工结果 CSV、设备状态、日志、故障真值、清单和哈希；原始视频默认排除，仅显式请求时加入受限小样。

FR-029：诊断证据包包含配置、阈值、失败检查、异常窗口、资源指标、设备日志、IMU 摘要、关键帧摘要和人工结果；证据编号稳定且受字节/Token 上限约束。

FR-030：诊断输出为 Schema 校验 JSON，包含状态、现象、可能原因、证据引用、置信度、影响范围、复测建议、缺失证据、不确定性和限制。

FR-031：无证据原因标记为推测；无效证据引用拒绝；结构有效性与效果评估分开统计。

FR-032：支持 Mock 和硅基流动模式；重新诊断创建独立诊断运行并保存模型、Prompt 版本、时间、Mock 标记、证据包、输出和错误。

FR-033：仅对超时、限流和临时服务错误最多自动重试两次；模型失败不影响运行、检查和原始报告。

FR-034：仪表盘展示运行统计、近期失败、诊断状态计数和 AI 评估汇总。

FR-035：API Key 默认来自后端环境变量；前端临时 Key 仅在当前会话内存；接口只返回是否配置；报告、日志、SQLite 和 ZIP 不得含 Key。

## 4. 业务规则与状态流转

BR-002：运行正常路径为 `queued` → `generating_data` → `running_checks` → `summarizing_results` → `completed`。

BR-003：运行可从任一非终态转为 `cancelled`；应用重启可转为 `interrupted`；执行错误转为 `failed`。

BR-004：`completed`、`failed`、`cancelled`、`interrupted` 为终态；终态不能取消，重跑创建新运行。

BR-005：测试执行状态与 AI 诊断状态独立；诊断状态为 `pending`、`generating`、`completed` 或 `failed`。

BR-006：确定性检查先于诊断；故障真值在生成时确定，不由检查器或 AI 反推。

BR-007：判定模式与阈值来源匹配：需求验收→正式规格，工程目标→工程目标，摸底分析→版本基线。

BR-008：`max_failed_checks` 为非负整数；阈值名仅支持 `max_failed_checks`、`max_alignment_residual_ms`。

BR-009：证据引用必须存在于证据包；无引用原因必须 `is_speculation=true`。

BR-010：默认不导出原始视频；`include_sample=true` 时每路最多 1 秒，单文件 5MiB、总量 10MiB。

BR-011：导出文本 UTF-8；过滤认证头、Token、API Key；敏感二进制标记导致导出拒绝。

## 5. 异常与边界条件

EX-001：未知任务、运行、人工结果或附件返回 404。

EX-002：非法参数、模式/阈值不匹配、未知场景、未知锚点、无效证据引用返回 422。

EX-003：非完成运行导出完整证据包、终态运行取消、无对齐结果复核返回 409。

EX-004：CSV 必须 UTF-8/UTF-8 BOM，表头严格为 `name,status,actual_result,notes,executed_at`；XLSX 第一工作表表头同样严格。

EX-005：人工导入最大 2MiB；人工附件最大 1MiB，允许 TXT、PNG、JPEG、PDF。

EX-006：空名称、超长名称/结果/备注、非法人工状态、非法时间拒绝；导入错误指出行号、字段和原因。

EX-007：数据库不可用时健康检查 503；模型错误保存为诊断失败而非运行失败。

EX-008：锚点复核后有效共同锚点不足返回 422；复核不覆盖原始产物和检查结果。

## 6. 非功能需求

NFR-001：相同配置和随机种子应产生可比较的产物指纹与等价检查输入。

NFR-002：运行、阶段事件、产物、真值、检查、阈值、诊断和导出文件可通过 ID、路径或 SHA-256 关联。

NFR-003：HTML 可脱离应用打开；ZIP 有 `evidence-manifest.json` 和 `SHA256SUMS.txt`；Allure 结果可独立查看。

NFR-004：Key 不得进入仓库、数据库、日志、HTML 或 ZIP；导出需做敏感信息扫描。

NFR-005：模型不可用不阻断确定性测试关键路径；Mock 可离线运行并用于 CI。

NFR-006：后端 Python/FastAPI/Pytest/SQLite/FFmpeg/ffprobe，前端 React/TypeScript，前端依赖使用 pnpm。

NFR-007：执行前做单机资源保护；长稳场景用虚拟时间控制成本。

## 7. 可验证验收标准

AC-001：六个核心场景可重复执行；正常场景不误报，五类故障命中预期检查；两种对齐方法可运行。

AC-002：快速、标准、自定义模式及边界通过 API/页面验证；非法任务不入库。

AC-003：可观察排队、阶段进度、安全取消、重跑新记录和重启后 `interrupted`。

AC-004：运行含配置快照、产物 SHA-256、来源、故障真值、检查结果和阶段事件。

AC-005：时间分析含对齐前后指标、方法/参数、残差、锚点详情、复核版本和内容同步结果。

AC-006：三种判定模式的阈值来源和结论语义符合 BR-007；AI 不改变阈值。

AC-007：人工结果可创建、更新、导入、下载附件，并和自动检查独立保存、统一报告。

AC-008：Mock 诊断结构有效、引用有效，并给出命中/漏判/无证据推测/误报评估。

AC-009：模型失败时运行仍完成，诊断为失败；临时错误自动重试最多两次。

AC-010：HTML 独立打开；默认 ZIP 不含原始视频，清单和 SHA-256 可复核，产物不含敏感信息。

AC-011：后端、前端、契约测试、安全扫描和 README Mock 复现路径可执行；真实线上模型效果和远端 CI 记录不作为已验证事实。

## 8. 需求与实际实现对应

实现对应见 `AS_BUILT_SPEC.md` 的 `CAP-*` 编号。没有代码或测试证据的需求不得视为已实现。

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
