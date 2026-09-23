export const jsonHeaders = { "Content-Type": "application/json" };

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(payload?.detail ?? "请求失败");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
