import type {
  PrototypeAiModelOption,
  PrototypeAiProviderKey as ProviderKey,
} from "./V020PrototypeAiModels";

const CACHE_KEY = "iris-test-ai-model-catalog";

type CatalogCache = Partial<Record<ProviderKey, PrototypeAiModelOption[]>>;

/**
 * 读取上次实时刷新得到的模型目录。
 * 冻结版首页切换页面会卸载组件，只靠内存状态会让模型退回内置目录的“待实时校验”。
 */
export function readCachedCatalog(
  provider: ProviderKey,
): PrototypeAiModelOption[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogCache;
    const models = parsed[provider];
    return Array.isArray(models) && models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

/** 记录本次实时刷新得到的模型目录，供切换页面或刷新后恢复。 */
export function writeCachedCatalog(
  provider: ProviderKey,
  models: PrototypeAiModelOption[],
): void {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CatalogCache) : {};
    parsed[provider] = models;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // 本地存储不可用时只影响缓存，不影响当前会话的选择。
  }
}
