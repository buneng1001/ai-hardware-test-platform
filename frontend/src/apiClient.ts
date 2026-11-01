export const jsonHeaders = { "Content-Type": "application/json" };

type ErrorDetail =
  string | Array<{ msg?: string; loc?: unknown[] }> | { message?: string };

/** 把 FastAPI 的三种错误结构都转成一句可读的话。 */
function readDetail(detail: ErrorDetail | undefined): string {
  if (!detail) return "请求失败";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (first?.msg) {
      const field = Array.isArray(first.loc)
        ? first.loc.slice(1).join(".")
        : "";
      return field ? `${field}：${first.msg}` : first.msg;
    }
    return "请求参数不合法";
  }
  return detail.message ?? "请求失败";
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: ErrorDetail;
    } | null;
    throw new Error(readDetail(payload?.detail));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
