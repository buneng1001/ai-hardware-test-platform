export const prototypeAiProviders = {
  deepseek: {
    label: "DeepSeek",
    models: [
      {
        id: "deepseek-flash",
        label: "DeepSeek-V4.1-Flash",
        availability: "verified",
      },
      {
        id: "deepseek-v4-pro",
        label: "DeepSeek-V4-Pro",
        availability: "verified",
      },
    ],
    preset: "已配置预设 API Key，无需填写",
  },
  siliconflow: {
    label: "SiliconFlow",
    models: [
      {
        id: "deepseek-ai/DeepSeek-V4.1-Flash",
        label: "DeepSeek-V4.1-Flash",
        availability: "verified",
      },
      {
        id: "deepseek-ai/DeepSeek-V4-Pro",
        label: "DeepSeek-V4-Pro",
        availability: "verified",
      },
      {
        id: "MiniMaxAI/MiniMax-M3.1-Flash",
        label: "MiniMax-M3.1-Flash",
        availability: "candidate",
      },
      {
        id: "MiniMaxAI/MiniMax-M3",
        label: "MiniMax-M3",
        availability: "candidate",
      },
      {
        id: "Pro/moonshotai/Kimi-K3",
        label: "Kimi-K3",
        availability: "candidate",
      },
      {
        id: "Pro/moonshotai/Kimi-K2.8-Preview",
        label: "Kimi-K2.8-Preview",
        availability: "candidate",
      },
      {
        id: "Pro/moonshotai/Kimi-K2.7",
        label: "Kimi-K2.7",
        availability: "candidate",
      },
      {
        id: "zai-org/GLM-5.2",
        label: "GLM-5.2",
        availability: "verified",
      },
      {
        id: "Pro/zai-org/GLM-5.1",
        label: "GLM-5.1",
        availability: "verified",
      },
      {
        id: "zai-org/GLM-5V-Turbo",
        label: "GLM-5V-Turbo",
        availability: "candidate",
      },
      {
        id: "Qwen/Qwen3.6-27B",
        label: "Qwen3.6-27B",
        availability: "verified",
      },
      {
        id: "Qwen/Qwen3.5-27B",
        label: "Qwen3.5-27B",
        availability: "candidate",
      },
      {
        id: "Qwen/Qwen3-8B",
        label: "Qwen3-8B",
        availability: "candidate",
      },
    ],
    preset: "可使用预设 API Key，也可临时覆盖",
  },
  local: {
    label: "本地服务",
    models: [
      {
        id: "openai/gpt-4o",
        label: "OpenAI / gpt-4o",
        availability: "local",
      },
      {
        id: "ollama/qwen2.5:72b",
        label: "Ollama / qwen2.5:72b",
        availability: "local",
      },
    ],
    preset: "由本地服务提供连接凭据",
  },
} as const;

export type PrototypeAiProviderKey = keyof typeof prototypeAiProviders;
