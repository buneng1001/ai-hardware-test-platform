import { useState } from "react";

import {
  type CollectionTaskCommand,
  type DataMode,
  type ImuConfiguration,
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

export function CollectionTaskForm({ disabled, saving, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<DataMode>("quick");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [duration, setDuration] = useState(2);
  const [channels, setChannels] = useState(1);
  const [resolution, setResolution] =
    useState<VideoConfiguration["resolution"]>("640x360");
  const [fps, setFps] = useState<VideoConfiguration["fps"]>(15);
  const [container, setContainer] =
    useState<VideoConfiguration["container"]>("mp4");
  const [imuFormat, setImuFormat] = useState<ImuConfiguration["format"]>("csv");
  const [sampleRate, setSampleRate] =
    useState<ImuConfiguration["sample_rate_hz"]>(50);
  const [randomSeed, setRandomSeed] = useState(20260822);
  const [error, setError] = useState<string | null>(null);

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
    };
    if (mode === "custom") {
      if (
        duration < 2 ||
        duration > 300 ||
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
      command.video = { channels, resolution, fps, container };
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
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
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
          <SelectField
            label="帧率"
            id="fps"
            value={String(fps)}
            values={["15", "24", "25", "30", "60"]}
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
            ? "2 秒 · 1 路 · 640×360 · 15 FPS"
            : "5 秒 · 4 路 · 1280×720 · 30 FPS"}
        </p>
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
