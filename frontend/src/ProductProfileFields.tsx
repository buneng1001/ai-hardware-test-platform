import type { ProductProfile } from "./projectsApi";

export const interfacePresets = [
  {
    category: "常用接口",
    items: [
      "USB Type-C",
      "USB-A",
      "Micro-USB",
      "Wi-Fi",
      "Bluetooth",
      "BLE",
      "HDMI",
      "RJ45 以太网",
      "3.5mm 音频",
    ],
  },
  {
    category: "有线/物理连接",
    items: [
      "Lightning",
      "DC 电源接口",
      "PoE",
      "Pogo Pin",
      "SIM 卡槽",
      "SD 卡槽",
      "MicroSD/TF 卡槽",
      "FPC/FFC",
    ],
  },
  {
    category: "无线通信",
    items: [
      "NFC",
      "RFID",
      "红外 IR",
      "Zigbee",
      "Thread",
      "UWB",
      "4G LTE",
      "5G",
      "NB-IoT",
      "LoRa/LoRaWAN",
      "GNSS/GPS",
    ],
  },
  {
    category: "调试/控制与板级总线",
    items: [
      "UART/TTL 串口",
      "RS-232",
      "RS-485",
      "I2C",
      "SPI",
      "CAN",
      "GPIO",
      "JTAG/SWD",
      "ADB 调试",
      "MIPI CSI/DSI",
      "I2S",
      "PCIe",
    ],
  },
];

export function appendInterface(current: string, label: string): string {
  if (current.split("、").some((item) => item.trim() === label)) return current;
  const separator = current.trim()
    ? current.trimEnd().endsWith("、")
      ? ""
      : "、"
    : "";
  const combined = current + separator + label;
  return combined.length <= 300 ? combined : current;
}

export function ProductProfileFields({
  profile,
  onChange,
}: {
  profile: ProductProfile;
  onChange: (profile: ProductProfile) => void;
}) {
  const update = <K extends keyof ProductProfile>(
    key: K,
    value: ProductProfile[K],
  ) => onChange({ ...profile, [key]: value });
  return (
    <fieldset className="prototype-project-profile">
      <legend>被测产品画像（决定 AI 判断与报告内容）</legend>
      <div className="prototype-filter-row">
        {(
          [
            ["physical_keys", "实体按键数量", "实体按键"],
            ["indicator_lights", "指示灯数量", "指示灯"],
            ["cameras", "摄像头数量", "摄像头"],
          ] as const
        ).map(([key, aria, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={aria}
              type="number"
              min={0}
              max={999}
              step={1}
              required
              value={profile[key]}
              onChange={(event) =>
                update(
                  key,
                  event.target.value === "" ? NaN : Number(event.target.value),
                )
              }
            />
          </label>
        ))}
        <label className="prototype-inline-check">
          <input
            aria-label="有麦克风"
            type="checkbox"
            checked={profile.microphone}
            onChange={(event) => update("microphone", event.target.checked)}
          />
          麦克风
        </label>
        <label className="prototype-inline-check">
          <input
            aria-label="有提示音"
            type="checkbox"
            checked={profile.buzzer}
            onChange={(event) => update("buzzer", event.target.checked)}
          />
          提示音
        </label>
      </div>
      <label>
        通信接口
        <input
          aria-label="通信接口"
          maxLength={300}
          value={profile.interfaces}
          onChange={(event) => update("interfaces", event.target.value)}
          placeholder="可自由填写接口、连接方式和总线"
        />
      </label>
      <div
        className="prototype-interface-presets"
        aria-label="通信接口快捷输入"
      >
        {interfacePresets.map(({ category, items }) => (
          <details key={category}>
            <summary>{category}</summary>
            <div className="prototype-interface-tags">
              {items.map((item) => (
                <button
                  type="button"
                  key={item}
                  className="prototype-secondary"
                  disabled={
                    appendInterface(profile.interfaces, item) ===
                    profile.interfaces
                  }
                  onClick={() =>
                    update(
                      "interfaces",
                      appendInterface(profile.interfaces, item),
                    )
                  }
                >
                  {item}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
      <label>
        测试环境
        <input
          aria-label="测试环境"
          maxLength={300}
          value={profile.test_environment}
          onChange={(event) => update("test_environment", event.target.value)}
        />
      </label>
      <label>
        测试平台
        <select
          aria-label="测试平台"
          value={profile.platform}
          onChange={(event) =>
            update("platform", event.target.value as ProductProfile["platform"])
          }
        >
          <option value="none">无（纯硬件）</option>
          <option value="web">网页 / 后台</option>
          <option value="app">手机 App</option>
        </select>
      </label>
      {profile.platform === "web" && (
        <label>
          网站地址
          <input
            aria-label="网站地址"
            maxLength={300}
            value={profile.web_url}
            onChange={(event) => update("web_url", event.target.value)}
            placeholder="例如：https://example.com"
          />
        </label>
      )}
      {profile.platform === "app" && (
        <label>
          App 安装包名称
          <input
            aria-label="App 安装包"
            maxLength={300}
            value={profile.app_package}
            onChange={(event) => update("app_package", event.target.value)}
            placeholder="填写安装包文件名"
          />
        </label>
      )}
    </fieldset>
  );
}
