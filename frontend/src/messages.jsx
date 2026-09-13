import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'

/**
 * 消息中心状态（Banner 的铃铛角标 + /messages 页面共用一份）。
 *
 * 后端按角色决定返回什么：老师拿到自己发出的，学生拿到自己收到的。
 * 未读数就是「收到的、还没读的」条数。
 */
const Ctx = createContext({
  items: [], unread: 0, load: () => {}, send: () => {}, markAllRead: () => {},
})

export function MessagesProvider({ children }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  // 未读数以后端为准：只有「发给我的」才算，老师端恒为 0
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    if (!user) { setItems([]); setUnread(0); return }
    try {
      const d = await api.get('/messages')
      setItems(d.items || [])
      setUnread(d.unread || 0)
    } catch { setItems([]); setUnread(0) }   // 消息拿不到不该影响页面本身
  }, [user])

  useEffect(() => { load() }, [load])

  /* 老师催办后，学生那边得有机会看到角标变。
     10s 轻量轮询 + 「切回标签页立刻拉一次」——后者比缩短轮询更有效，
     因为人不在这个标签页时轮询其实没意义。
     真上线应换成 SSE / WebSocket，目前够用且不引入额外依赖。 */
  useEffect(() => {
    if (!user) return undefined
    const t = setInterval(load, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [user, load])

  const send = useCallback(async (payload) => {
    const m = await api.post('/messages', payload)
    await load()
    return m
  }, [load])

  const markAllRead = useCallback(async () => {
    await api.post('/messages/read', {})
    await load()
  }, [load])

  return (
    <Ctx.Provider value={{ items, unread, load, send, markAllRead }}>
      {children}
    </Ctx.Provider>
  )
}

export const useMessages = () => useContext(Ctx)
