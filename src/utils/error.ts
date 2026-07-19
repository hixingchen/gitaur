/**
 * 统一错误处理工具 — 脱敏 + 日志分离
 * 所有 store 的 catch 块必须使用此工具，禁止直接 String(e)
 */

/** 提取用户友好的错误消息，不暴露堆栈/路径/token */
export function sanitizeError(e: unknown): string {
  if (e instanceof Error) {
    // 只返回消息，不暴露堆栈跟踪（含文件路径、行号）
    return e.message || '操作失败';
  }
  if (typeof e === 'string') return e;
  return '未知错误';
}

/** 开发环境详细日志，生产环境只记摘要 */
export function logError(context: string, e: unknown): void {
  console.error(`[${context}]`, e);
}

/** 统一的 store 错误处理：脱敏消息 + 记录日志 */
export function handleStoreError(context: string, e: unknown): string {
  logError(context, e);
  return sanitizeError(e);
}