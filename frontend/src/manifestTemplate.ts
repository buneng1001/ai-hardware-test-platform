export const MANIFEST_TEMPLATE = `{
  "_说明": "manifest.json 必须放在 ZIP 根目录。普通用户通常只需修改视频和 IMU 的文件路径；其他技术字段使用平台默认值即可。",
  "schema_version": "1.0",
  "time_source": "device_clock",
  "videos": [
    {
      "_说明": "每路视频填写一个对象；通常只需修改 channel 和 path。可增加 camera_2～camera_4。",
      "channel": "camera_1",
      "path": "videos/camera_1.mp4",
      "codec": "h264",
      "container": "mp4",
      "fps": 30,
      "resolution": "1280x720",
      "bitrate_kbps": 2500,
      "_时间字段说明": "没有设备采集元数据时无需修改：默认使用视频自身时间轴，0 表示暂未提供设备原始时间戳。",
      "time_source": "container_pts",
      "start_raw_device_timestamp_ns": 0
    }
  ],
  "imu": {
    "_说明": "通常只需修改 path；format 只支持 csv 或 jsonl，sample_rate_hz 可填写采集设备标称值。CSV 常见列名可使用 time、accel_x、accel_y、accel_z、gyro_x、gyro_y、gyro_z。",
    "path": "imu.csv",
    "format": "csv",
    "sample_rate_hz": 100,
    "_时间字段说明": "没有设备采集元数据时无需修改，使用平台默认值即可。",
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
