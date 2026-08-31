export const MANIFEST_TEMPLATE = `{
  "_说明": "请删除或保留本说明字段，并按实际测试文件修改带有“请填写”的内容。manifest.json 必须放在 ZIP 根目录。",
  "schema_version": "1.0",
  "time_source": "device_clock",
  "videos": [
    {
      "_说明": "每路视频填写一个对象；可增加 camera_2～camera_4。path 必须与 ZIP 内文件路径一致。",
      "channel": "camera_1",
      "path": "videos/camera_1.mp4",
      "codec": "h264",
      "container": "mp4",
      "fps": 30,
      "resolution": "1280x720",
      "bitrate_kbps": 2500,
      "time_source": "container_pts_plus_device_start",
      "start_raw_device_timestamp_ns": 1000000000
    }
  ],
  "imu": {
    "_说明": "path 必须与 ZIP 内文件路径一致；format 只支持 csv 或 jsonl，采样率建议填写实际值。",
    "path": "imu.csv",
    "format": "csv",
    "sample_rate_hz": 100,
    "time_source": "device_clock"
  }
}`;

export function downloadManifestTemplate(): void {
  const blob = new Blob([MANIFEST_TEMPLATE], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "manifest.json";
  link.click();
  URL.revokeObjectURL(url);
}
