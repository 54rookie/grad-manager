const BASE = '/api'

// 注意：登录态存在 sessionStorage（每个标签页独立），
// 这样同一浏览器可以同时开「老师」和「学生」两个页面互不干扰。
export function getToken() {
  return sessionStorage.getItem('gm_token')
}

export function setToken(token) {
  sessionStorage.setItem('gm_token', token)
}

export function clearToken() {
  sessionStorage.removeItem('gm_token')
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(options.json)
    delete options.json
  }
  const res = await fetch(BASE + path, { ...options, headers })
  if (res.status === 401) {
    // 登录接口自己返回 401 表示「密码错」，不是登录态过期：
    // 要把后端文案原样抛给调用方去提示，绝不能再跳 /login ——
    // 那会让登录页在密码错误时整页重载，既丢了 React 状态、
    // 又覆盖掉真正的报错（用户只看到「登录已过期」），
    // 自动化里还会变成无限重载。
    if (path === '/login') {
      let msg = '用户名或密码错误'
      try {
        const data = await res.json()
        if (data.detail) msg = data.detail
      } catch { /* 保底用上面的默认文案 */ }
      throw new Error(msg)
    }
    clearToken()
    window.location.href = '/login'
    throw new Error('登录已过期')
  }
  if (res.status === 403) {
    let msg = '当前账号没有此操作权限（请确认该标签页登录的是老师账号）'
    try {
      const data = await res.json()
      if (data.detail) msg = data.detail
    } catch {}
    throw new Error(msg)
  }
  if (res.status === 405 && (path === '/announcements/with-attachments' || /^\/reports\/my\/[^/]+\/submit$/.test(path))) {
    throw new Error('后端尚未加载新的附件接口，请重启 5183 后端服务并刷新页面')
  }
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      if (data.detail) msg = data.detail
    } catch {}
    throw new Error(msg)
  }
  return options.asBlob ? res.blob() : res.json()
}

export const api = {
  get: (p) => request(p),
  post: (p, json) => request(p, { method: 'POST', json }),
  put: (p, json) => request(p, { method: 'PUT', json }),
  del: (p) => request(p, { method: 'DELETE' }),
  delete: (p) => request(p, { method: 'DELETE' }),
  postForm: (p, formData) => request(p, { method: 'POST', body: formData }),
  putForm: (p, formData) => request(p, { method: 'PUT', body: formData }),
  fileBlob: (p) => request(p, { asBlob: true }),
}

export async function downloadAttachment(path, name) {
  const blob = await api.fileBlob(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name || '附件'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadFile(storedName, origName) {
  const res = await fetch(`${BASE}/thesis/files/${storedName}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error('下载失败')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = origName || storedName
  a.click()
  URL.revokeObjectURL(url)
}
