import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Pelican from './pelican'
import { useMessages } from './messages'

/**
 * 全局聚合 Banner（shimen-global-banner.html 原型 100% 还原）
 *
 * 职责：纯展示 + 全局导航 + 用户区。
 * 结构：品牌（左，绝对定位） + 大标题/小标题（中，绝对居中） + 用户区（右上，太阳左侧）
 *       + 底部主导航。
 * 用户区刻意放在 .day-banner 之外（.pg-gb 的直接子级）：.day-banner 有 overflow: hidden
 * 用来裁云朵/光芒，放进去会把向下展开的下拉菜单一起裁掉。
 *
 * Props：
 *  - title        ReactNode → 大标题（手绘下划线 + .hl 高亮）
 *  - subtitle     ReactNode → 小标题
 *  - extraActions ReactNode → 用户下拉菜单里的额外项（如「修改密码」）
 */

// 导航项：teacherOnly 的项只对老师显示
// 「账号管理」已从主导航移除——它挂在右上角的太阳上（见下方 .sun），
// 免得后台管理的感觉太重，占了手账的正经菜单位。
const NAV = [
  // 进度看板对师生都开放：学生进去是全面只读（Progress.jsx 里按 isTeacher 降级）
  { to: '/progress', label: '进度看板' },
  { to: '/thesis', label: '论文管理' },
  { to: '/reports', label: '每周周报' },
  { to: '/qa', label: '问答点评' },
  { to: '/announcements', label: '每日公告' },
  { to: '/links', label: '常用链接' },
]

/* 漂浮光尘的固定随机参数（模块级，避免重挂载时光尘跳变） */
const MOTES = Array.from({ length: 22 }, () => ({
  size: Math.random() * 5 + 2,
  left: Math.random() * 100,
  top: Math.random() * 80,
  dur: 4 + Math.random() * 5,
  delay: Math.random() * 5,
}))

export default function GlobalBanner({ user, logout, title, subtitle, extraActions }) {
  const birdRef = useRef(null)

  /* 飞鸟：每 9~18 秒掠过一次（原版脚本迁移，含清理） */
  useEffect(() => {
    const bird = birdRef.current
    if (!bird) return undefined
    let timer
    const flyBy = () => {
      bird.style.right = `${-20 - Math.random() * 10}px`
      bird.style.top = `${15 + Math.random() * 35}%`
      bird.classList.remove('fly')
      void bird.offsetWidth // 强制重排，重新触发动画
      bird.classList.add('fly')
      timer = setTimeout(flyBy, 9000 + Math.random() * 9000)
    }
    timer = setTimeout(flyBy, 2500)
    return () => clearTimeout(timer)
  }, [])

  const motes = useMemo(() => MOTES, [])
  const isTeacher = user.role === 'teacher'
  const nav = NAV.filter((n) => !n.teacherOnly || isTeacher)
  const navigate = useNavigate()
  const { unread } = useMessages()

  return (
    <div className="pg-gb">
      <header className="day-banner">
        {/* 环境点缀 */}
        <div id="motes">
          {motes.map((m, i) => (
            <span key={i} className="mote" style={{
              width: m.size, height: m.size,
              left: `${m.left}%`, top: `${m.top}%`,
              '--dt-dur': `${m.dur}s`, '--dt-delay': `${m.delay}s`,
            }} />
          ))}
        </div>
        <span className="cloud c1" />
        <span className="cloud c2" />
        <span className="cloud c3" />
        {/* 太阳兼任「账号管理」入口（仅老师）：学生点它没有意义，所以学生端保持纯装饰 */}
        {isTeacher ? (
          <button className="sun sun-btn" type="button"
            title="账号管理" aria-label="进入账号管理"
            onClick={() => navigate('/accounts')} />
        ) : (
          <span className="sun" />
        )}
        <span className="bird" ref={birdRef}>⌒</span>
        <span className="tape-corner tape-tl" />
        <span className="tape-corner tape-br" />

        {/* ===== 单层：品牌（左，绝对定位） + 标题（中，绝对居中） ===== */}
        <div className="bar-top">
          <NavLink className="brand" to="/">
            <span className="brand-seal">师</span>
            <span>
              <span className="brand-name">师门<em>手账</em></span><br />
              <span className="brand-sub">记一笔晴日，伴一程研途</span>
            </span>
          </NavLink>

          {/* 插槽 1 + 2：大标题 / 小标题
              两侧元素都脱离文档流，这里是 bar-top 唯一的在流子元素，
              由 justify-content: center 真正居中，不再受品牌宽度影响 */}
          <div className="slot-text">
            <h1 className="slot slot-1">{title}</h1>
            {subtitle && <p className="slot slot-2">{subtitle}</p>}
          </div>
        </div>

        <div className="bar-divider" />

        {/* ===== 底部：主导航 ===== */}
        <nav className="main-nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* 用户区：与 .day-banner 同级（.pg-gb 的子级），绝对定位到 Banner 右上角、
          太阳的左侧；放下拉菜单时不会被 .day-banner 的 overflow: hidden 裁掉 */}
      <div className="user-zone">
        <div className="user-menu">
          <button className="user-chip" type="button" aria-haspopup="true">
            {/* 原来的「师/生」红印章换成手绘铃铛，右上角挂未读角标 */}
            <span className="bell-wrap">
              <svg className="bell-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3.2c-2.9 0-5.2 2.3-5.2 5.2 0 3.7-1.1 5.3-1.9 6.2-.4.5-.1 1.3.6 1.3h13c.7 0 1-.8.6-1.3-.8-.9-1.9-2.5-1.9-6.2 0-2.9-2.3-5.2-5.2-5.2Z"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.5 18.6a2.7 2.7 0 0 0 5 0"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M12 3.2V2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              {unread > 0 && (
                <span className="bell-badge" title={`${unread} 条未读消息`}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            <b>{user.name}</b>
            <span className="role">· {isTeacher ? '导师' : '学生'}</span>
            <svg className="caret" width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 6 L8 10.5 L12.5 6" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="user-dropdown">
            <button className="dropdown-item" type="button" onClick={() => navigate('/messages')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M12 3.2c-2.9 0-5.2 2.3-5.2 5.2 0 3.7-1.1 5.3-1.9 6.2-.4.5-.1 1.3.6 1.3h13c.7 0 1-.8.6-1.3-.8-.9-1.9-2.5-1.9-6.2 0-2.9-2.3-5.2-5.2-5.2Z"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.5 18.6a2.7 2.7 0 0 0 5 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              消息中心{unread > 0 ? `（${unread}）` : ''}
            </button>
            {extraActions}
            <button className="dropdown-item" type="button" onClick={logout}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M6.5 2.5 H3.5 a1 1 0 0 0 -1 1 v9 a1 1 0 0 0 1 1 h3 M6 8 H13.5 M11 5.5 L13.5 8 L11 10.5"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              退出登录
            </button>
          </div>
        </div>
      </div>

      {/* 最大的一只鹈鹕：贴着 Banner 的分隔虚线骑
          挂在 .pg-gb 里（不是 .day-banner 里——那层 overflow:hidden 会把它裁掉），
          z-index 高于 Banner 内容，所以不会被压住；随文档滚动。 */}
      <div className="ride ride-a ride-doc" aria-hidden="true"><Pelican speed={1} /></div>
    </div>
  )
}
