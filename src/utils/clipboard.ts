/** 复制文本到剪贴板 — 静默失败 */
export function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}
