// 跨页面等待进度看板尚未发出或尚未完成的节点保存，避免周报先读到旧状态。
const pending = new Set()

export function trackProgressSave(promise) {
  pending.add(promise)
  promise.finally(() => pending.delete(promise))
}

export async function waitForProgressSaves() {
  while (pending.size) await Promise.allSettled([...pending])
}
