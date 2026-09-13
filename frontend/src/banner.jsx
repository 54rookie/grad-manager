import { createContext, useContext, useEffect, useState } from 'react'
import GlobalBanner from './GlobalBanner'
import { useAuth } from './auth'

/**
 * Banner 状态桥：Layout 只渲染一次 <BannerProvider>（内部挂 GlobalBanner），
 * 各页面用 usePageBanner({ title, subtitle, actionWidget, deps }) 声明自己的
 * 标题与控件。利用 children 元素引用不变的特性，Provider 更新只重渲染
 * Banner 本身，不会引起页面重渲染循环。
 */

const BannerCtx = createContext(() => {})

/**
 * extraActions：渲染在用户区（退出按钮旁）的额外按钮，例如「修改密码」。
 * 由 Layout 传入，Banner 内渲染。
 */
export function BannerProvider({ children, extraActions }) {
  const { user, logout } = useAuth()
  const [slots, setSlots] = useState({})

  return (
    <BannerCtx.Provider value={setSlots}>
      <GlobalBanner user={user} logout={logout} extraActions={extraActions} {...slots} />
      {children}
    </BannerCtx.Provider>
  )
}

/**
 * 页面侧调用：
 *   usePageBanner({
 *     title: <span>研究生<span className="hl">论文进度</span>看板</span>,
 *     subtitle: '一图览尽师门论文进展',
 *     deps: [filter, grades],   // 显式声明：这些变化时刷新标题
 *   })
 */
export function usePageBanner({ title, subtitle, deps = [] }) {
  const setSlots = useContext(BannerCtx)
  useEffect(() => {
    setSlots({ title, subtitle })
    return () => setSlots({}) // 卸载时清空，避免残留上一页的标题
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
