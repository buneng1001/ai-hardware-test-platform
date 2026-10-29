/** 测试用 JSON 响应构造器，避免各 Mock 模块重复实现。 */
export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
