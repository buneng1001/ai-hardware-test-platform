import { useState } from "react";

import {
  type CollectionTaskCommand,
  type DataMode,
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
const SCENARIO_HELP: Partial<Record<Scenario, string>> = {
  normal: "验证视频、六轴 IMU、设备状态和日志均正常，检查系统是否产生误报。",
  imu_anomaly: "在 IMU 数据中注入缺失、重复或时间戳异常，验证传感器检查能力。",
  storage_exhaustion:
    "模拟存储空间持续下降或不足，验证资源监控和存储告警是否生效。",
  temperature_combination:
    "组合模拟温升与相关资源变化，验证长时间趋势和组合故障检查。",
};

function createTimeSeed(): number {
  const now = new Date();
  const parts = [
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds(),
  ];
  return Number(
    `${String(parts[0]).padStart(2, "0")}${String(parts[1]).padStart(2, "0")}${String(parts[2]).padStart(2, "0")}${String(parts[3]).padStart(3, "0")}`,
  );
}

function formatSeed(seed: number): string {
  return seed === 20260822 ? String(seed) : String(seed).padStart(9, "0");
}

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
  const [seedCustomized, setSeedCustomized] = useState(false);
  const [referenceChannel, setReferenceChannel] =
    useState<ReferenceChannel>("camera_1");
  const [error, setError] = useState<string | null>(null);
  const suggestedName = `${MODE_LABELS[mode]}-${SCENARIO_LABELS[scenario]}`;
  const effectiveChannels =
    mode === "quick" ? 2 : mode === "standard" ? 4 : channels;
  const droppedChannel = (randomSeed % effectiveChannels) + 1;
  const delayedChannels = Array.from(
    { length: Math.max(0, effectiveChannels - 1) },
    (_, index) => `camera_${index + 2}`,
  ).join("、");
  const delayedTargets = delayedChannels ? `${delayedChannels} 和 IMU` : "IMU";

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
    } else if (seedCustomized) {
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
      <p>
        {scenario === "video_drop"
          ? `对 camera_${droppedChannel} 注入掉帧（由随机种子 ${formatSeed(randomSeed)} 选择），运行详情会显示异常时间窗。`
          : scenario === "fixed_offset"
            ? `让 ${delayedTargets} 相对 camera_1 产生固定时间偏移，运行详情会列出目标通道。`
            : scenario === "linear_drift"
              ? `让 ${delayedTargets} 相对 camera_1 产生线性时钟漂移，运行详情会列出目标通道。`
              : (SCENARIO_HELP[scenario] ??
                "请按当前场景执行对应的确定性检查。")}
      </p>
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
      <details>
        <summary>参考时钟详情</summary>
        <p>
          参考时钟是时间对齐的基准通道，不会改写原始时间戳。合成的固定偏移和线性漂移场景会用它计算对齐结果；普通采集只记录它，不额外注入故障。导入真实数据时，它用于逻辑对齐和判断，不参与数据生成。
        </p>
      </details>
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
            ? `快速是固定预设：视频格式 MP4，编码格式 H.264，2 秒 · 2 路 · 640×360 · 30 FPS · IMU 100Hz · 3000kbps CBR · 随机种子 ${formatSeed(randomSeed)}`
            : `标准是固定预设：视频格式 MP4，编码格式 H.264，时长 5 秒 · 4 路 · 1280×720 · 30 FPS · IMU 200Hz · 6000kbps CBR · 随机种子 ${formatSeed(randomSeed)}`}
        </p>
      )}
      <h4>可选操作</h4>
      <p>
        随机种子：{formatSeed(randomSeed)}（默认固定种子；刷新后格式为
        HHMMSSmmm）。它决定故障位置和噪声序列；相同种子、配置和版本可复现相同数据。点击刷新可为快速、标准或自定义任务生成新的时间种子。
        <button
          type="button"
          onClick={() => {
            setRandomSeed(createTimeSeed());
            setSeedCustomized(true);
          }}
        >
          刷新随机种子
        </button>
      </p>
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
