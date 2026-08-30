import { useState } from "react";

import {
  type CollectionTaskCommand,
  type DataMode,
  type EvaluationMode,
  type ThresholdSource,
  type ImuConfiguration,
  type ReferenceChannel,
  type Scenario,
  type VideoConfiguration,
} from "./collectionTasksApi";

type Props = {
  disabled: boolean;
  saving: boolean;
  onSubmit: (command: CollectionTaskCommand) => Promise<boolean>;
};

const MAX_VIDEO_PIXEL_FRAMES = 600_000_000;
const MAX_ACTUAL_DURATION_SECONDS = 5;
const SCENARIO_LABELS: Record<Scenario, string> = {
  normal: "正常采集",
  video_drop: "视频掉帧",
  imu_anomaly: "IMU 异常",
  storage_exhaustion: "存储不足",
  temperature_combination: "温升组合故障",
  fixed_offset: "固定偏移",
  linear_drift: "线性漂移",
};
const MODE_LABELS: Record<DataMode, string> = {
  quick: "快速",
  standard: "标准",
  custom: "自定义",
};
const EVALUATION_HELP: Record<EvaluationMode, string> = {
  requirements_acceptance:
    "按正式规格判断是否合格；这是唯一代表产品验收结论的模式。",
  engineering_target:
    "按当前工程目标观察是否达标，用于研发调优，不代表正式验收承诺。",
  baseline_analysis: "只记录和分析当前版本的指标，不输出合格/不合格结论。",
};

export function CollectionTaskForm({ disabled, saving, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<DataMode>("quick");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [duration, setDuration] = useState(2);
  const [channels, setChannels] = useState(1);
  const [resolution, setResolution] =
    useState<VideoConfiguration["resolution"]>("640x360");
  const [fps, setFps] = useState<VideoConfiguration["fps"]>(30);
  const [container, setContainer] =
    useState<VideoConfiguration["container"]>("mp4");
  const [bitrateKbps, setBitrateKbps] = useState(3500);
  const [bitrateMode, setBitrateMode] = useState<"cbr" | "vbr">("cbr");
  const [imuFormat, setImuFormat] = useState<ImuConfiguration["format"]>("csv");
  const [sampleRate, setSampleRate] =
    useState<ImuConfiguration["sample_rate_hz"]>(50);
  const [randomSeed, setRandomSeed] = useState(20260822);
  const [referenceChannel, setReferenceChannel] =
    useState<ReferenceChannel>("camera_1");
  const [evaluationMode, setEvaluationMode] = useState<EvaluationMode>(
    "requirements_acceptance",
  );
  const [maxFailedChecks, setMaxFailedChecks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const suggestedName = `${MODE_LABELS[mode]}-${SCENARIO_LABELS[scenario]}`;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("请输入任务名称");
      return;
    }

    const command: CollectionTaskCommand = {
      name: normalizedName,
      mode,
      scenario,
      reference_channel: referenceChannel,
    };
    if (evaluationMode !== "requirements_acceptance" || maxFailedChecks !== 0) {
      command.evaluation = {
        mode: evaluationMode,
        threshold_source: (
          {
            requirements_acceptance: "formal_specification",
            engineering_target: "engineering_target",
            baseline_analysis: "version_baseline",
          } as Record<EvaluationMode, ThresholdSource>
        )[evaluationMode],
        thresholds:
          evaluationMode === "baseline_analysis"
            ? {}
            : { max_failed_checks: maxFailedChecks },
        priority: [
          "formal_specification",
          "engineering_target",
          "version_baseline",
        ],
      };
    }
    if (mode === "custom") {
      if (
        duration < 2 ||
        duration > 300 ||
        bitrateKbps < 100 ||
        bitrateKbps > 50000 ||
        bitrateKbps % 100 !== 0 ||
        randomSeed < 0 ||
        randomSeed > 2147483647
      ) {
        setError("时长须为 2～300 秒，随机种子须为 0～2147483647");
        return;
      }
      const [width, height] = resolution.split("x").map(Number);
      const actualDuration = Math.min(duration, MAX_ACTUAL_DURATION_SECONDS);
      if (
        width * height * fps * channels * actualDuration >
        MAX_VIDEO_PIXEL_FRAMES
      ) {
        setError("预计文件规模超过安全上限，请降低分辨率、帧率或通道数");
        return;
      }
      command.duration_seconds = duration;
      command.video = {
        channels,
        resolution,
        fps,
        container,
        bitrate_kbps: bitrateKbps,
        bitrate_mode: bitrateMode,
      };
      command.imu = { format: imuFormat, sample_rate_hz: sampleRate };
      command.random_seed = randomSeed;
    }

    setError(null);
    if (await onSubmit(command)) {
      setName("");
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="task-name">任务名称</label>
      <input
        id="task-name"
        maxLength={80}
        placeholder={`例如：${suggestedName}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <p>
        可使用系统建议名称，也可以直接改成便于检索的名称。
        <button type="button" onClick={() => setName(suggestedName)}>
          使用建议名称
        </button>
      </p>
      <label htmlFor="data-mode">数据模式</label>
      <select
        id="data-mode"
        value={mode}
        onChange={(event) => setMode(event.target.value as DataMode)}
      >
        <option value="quick">快速</option>
        <option value="standard">标准</option>
        <option value="custom">自定义</option>
      </select>
      <label htmlFor="evaluation-mode">判定模式</label>
      <select
        id="evaluation-mode"
        value={evaluationMode}
        onChange={(event) =>
          setEvaluationMode(event.target.value as EvaluationMode)
        }
      >
        <option value="requirements_acceptance">需求验收</option>
        <option value="engineering_target">工程目标</option>
        <option value="baseline_analysis">摸底分析</option>
      </select>
      <p>{EVALUATION_HELP[evaluationMode]}</p>
      <p>
        当前判定依据：
        {
          {
            requirements_acceptance: "正式规格",
            engineering_target: "工程目标",
            baseline_analysis: "版本基线",
          }[evaluationMode]
        }
        。这里是判定语义标记；正式规格、工程目标和版本基线需要由项目配置或测试输入提供，系统不会自动编造。
      </p>
      {evaluationMode !== "baseline_analysis" && (
        <NumberField
          label="允许失败检查数"
          id="max-failed-checks"
          min={0}
          max={100}
          value={maxFailedChecks}
          onChange={setMaxFailedChecks}
        />
      )}
      <label htmlFor="scenario">场景</label>
      <select
        id="scenario"
        value={scenario}
        onChange={(event) => setScenario(event.target.value as Scenario)}
      >
        <option value="normal">正常采集</option>
        <option value="video_drop">单路视频掉帧</option>
        <option value="imu_anomaly">IMU 异常</option>
        <option value="storage_exhaustion">存储不足</option>
        <option value="temperature_combination">温升组合故障</option>
        <option value="fixed_offset">固定偏移</option>
        <option value="linear_drift">线性漂移</option>
      </select>
      <label htmlFor="reference-channel">参考时钟</label>
      <select
        id="reference-channel"
        value={referenceChannel}
        onChange={(event) =>
          setReferenceChannel(event.target.value as ReferenceChannel)
        }
      >
        <option value="camera_1">相机 1</option>
        <option value="camera_2">相机 2</option>
        <option value="camera_3">相机 3</option>
        <option value="camera_4">相机 4</option>
        <option value="imu">IMU</option>
      </select>
      {mode === "custom" ? (
        <div className="configuration-grid">
          <NumberField
            label="时长（秒）"
            id="duration"
            min={2}
            max={300}
            value={duration}
            onChange={setDuration}
          />
          <NumberField
            label="视频通道数"
            id="channels"
            min={1}
            max={4}
            value={channels}
            onChange={setChannels}
          />
          <SelectField
            label="分辨率"
            id="resolution"
            value={resolution}
            values={["640x360", "1280x720", "1920x1080"]}
            onChange={(value) =>
              setResolution(value as VideoConfiguration["resolution"])
            }
          />
          <NumberField
            label="视频码率（kbps）"
            id="bitrate-kbps"
            min={100}
            max={50000}
            step={100}
            value={bitrateKbps}
            onChange={setBitrateKbps}
          />
          <SelectField
            label="码率模式"
            id="bitrate-mode"
            value={bitrateMode}
            values={["cbr", "vbr"]}
            onChange={(value) => setBitrateMode(value as "cbr" | "vbr")}
          />
          <SelectField
            label="帧率"
            id="fps"
            value={String(fps)}
            values={["24", "25", "30", "60", "120"]}
            onChange={(value) =>
              setFps(Number(value) as VideoConfiguration["fps"])
            }
          />
          <SelectField
            label="视频容器"
            id="container"
            value={container}
            values={["mp4", "mkv"]}
            onChange={(value) =>
              setContainer(value as VideoConfiguration["container"])
            }
          />
          <SelectField
            label="IMU 格式"
            id="imu-format"
            value={imuFormat}
            values={["csv", "jsonl"]}
            onChange={(value) =>
              setImuFormat(value as ImuConfiguration["format"])
            }
          />
          <SelectField
            label="IMU 采样率"
            id="sample-rate"
            value={String(sampleRate)}
            values={["50", "100", "200", "500"]}
            onChange={(value) =>
              setSampleRate(Number(value) as ImuConfiguration["sample_rate_hz"])
            }
          />
          <NumberField
            label="随机种子"
            id="random-seed"
            min={0}
            max={2147483647}
            value={randomSeed}
            onChange={setRandomSeed}
          />
        </div>
      ) : (
        <p>
          {mode === "quick"
            ? "快速是固定预设：2 秒 · 1 路 · 640×360 · 30 FPS · IMU 100Hz · 3000kbps CBR"
            : "标准是固定预设：5 秒 · 4 路 · 1280×720 · 30 FPS · IMU 200Hz · 6000kbps CBR"}
        </p>
      )}
      {mode !== "custom" && (
        <p>快速和标准的路数及详细参数固定，若需调整请切换到自定义模式。</p>
      )}
      <p>视频编码固定 H.264；故障场景使用配置中的固定随机种子。</p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={saving || disabled}>
        {saving ? "正在保存…" : "保存采集任务"}
      </button>
    </form>
  );
}

function NumberField(props: {
  label: string;
  id: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label htmlFor={props.id}>
      {props.label}
      <input
        id={props.id}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  id: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={props.id}>
      {props.label}
      <select
        id={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.values.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}
