import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { createGargantua } from '../gargantua/engine'
import s from './Login.module.css'

/**
 * Gargantua 登录页 —— 黑洞引力透镜 + 碎屑吸积盘 + Endurance + 全息呼叫。
 *
 * 视觉部分逐字移植自 v21.html：着色器、三维轨道、遮挡、尘埃、彗尾、飞船网格
 * 与全息投影都在 `gargantua/engine.js` 里逐帧算。这个组件只负责三件事：
 *  1. 用 ref 把 canvas / 场景 / HUD / 输入框交给引擎；
 *  2. 把「会驱动 DOM 的状态」做成受控 state（表单、busy、提示、scene 上的标志类）；
 *  3. 接上真实登录，让穿越特效与 API 请求并行跑。
 *
 * ⚠ scene 上的四个标志类（quiet / immersed / engaging / arrived / summon）由 React
 * **独占**控制。引擎只通过 onFlag / onSummon 回调上报，绝不自己 classList.add ——
 * 否则任何一次 React 重绘都会用新的 className 把它加的那个类抹掉。
 *
 * 原页面其实**不登录**（源码注释：Deliberately local: credentials are neither
 * sent nor persisted），提交只是播一段 4700ms 的穿越动画然后提示「本地航程模拟完成」。
 * 这里把那套演出接成了真的业务：成功就转场进系统，失败就中断穿越并报错。
 */

const MIN_WARP_MS = 1600   // 穿越动画至少播这么久，再等 API 一起放行
const ARRIVAL_MS = 260     // .arrival 黑屏淡出播完再跳路由
const SUMMON_MS = 4500     // 全息呼叫的提示停留时长（与 v21 的 notify 一致）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()

  // ── 受控 state：凡是要驱动 DOM 的都在这里 ────────────────────────
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)          // 按钮锁定 + .engaging
  const [status, setStatus] = useState('')         // #form-status 文案（报错 / 全息呼叫提示）
  const [invalid, setInvalid] = useState(null)     // 'account' | 'password' | null
  const [quiet, setQuiet] = useState(false)        // 闲置后 HUD 淡出
  const [immersed, setImmersed] = useState(false)  // h 键沉浸模式
  const [arrived, setArrived] = useState(false)    // 抵达闪白
  const [summon, setSummon] = useState(false)      // 全息投影正在呼叫（HUD 回应）
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ── ref：只参与逐帧渲染，不触发重绘 ─────────────────────────────
  const sceneRef = useRef(null)
  const cosmosRef = useRef(null)
  const flightRef = useRef(null)
  const hudRef = useRef(null)
  const ringRef = useRef(null)
  const accountRef = useRef(null)
  const passwordRef = useRef(null)
  const engineRef = useRef(null)
  const mountedRef = useRef(true)
  const submittingRef = useRef(false)
  const statusTimerRef = useRef(0)

  /* 状态栏的两套写法：notify 会自己定时清空（全息呼叫要用），
     setStatusNow 立即覆盖并取消上一个定时器（报错要用，否则错误会被
     4.5 秒前那次呼叫的定时器顺手抹掉）。 */
  const notify = useCallback((message, duration = 2800) => {
    clearTimeout(statusTimerRef.current)
    setStatus(message)
    if (message) {
      statusTimerRef.current = setTimeout(() => setStatus(''), duration)
    }
  }, [])

  const setStatusNow = useCallback((message) => {
    clearTimeout(statusTimerRef.current)
    setStatus(message)
  }, [])

  useEffect(() => () => clearTimeout(statusTimerRef.current), [])

  /* 已经登录过还手动敲 /login 的话直接送走。
     ⚠ 必须排除「我们自己的提交」：login() 成功会 setUser，这个 effect 会立刻
     抢在穿越特效播完之前跳走，MIN_WARP_MS 那道闸门就形同虚设了（实测过，
     登录成功后 ~10ms 就跳了，warp 一帧都没看见）。提交期间交给 submit 自己收尾。 */
  useEffect(() => {
    if (user && !submittingRef.current) navigate('/', { replace: true })
  }, [user, navigate])

  /* 渲染引擎：挂载时创建，卸载时 dispose（cancelAnimationFrame + 摘监听） */
  useEffect(() => {
    mountedRef.current = true
    const engine = createGargantua({
      cosmos: cosmosRef.current,
      flight: flightRef.current,
      scene: sceneRef.current,
      hud: hudRef.current,
      account: accountRef.current,
      progressRing: ringRef.current,
      // quiet 每 30 帧算一次，只在真正翻转时回调，避免 60fps setState
      onFlag: (name, value) => { if (name === 'quiet') setQuiet(value) },
      // 船掠过阴影中央 → 召唤；被透镜吞掉 → 收起。都由 React 落到 class 上
      onSummon: setSummon,
      onNotify: notify,
    })
    engineRef.current = engine
    engine.start()
    return () => {
      mountedRef.current = false
      engine.dispose()
      engineRef.current = null
    }
  }, [notify])

  /* 沉浸模式的 inert 是命令式属性（React 18 不认 inert prop），手动同步；
     同时告诉引擎「别再来抢输入框焦点」 */
  useEffect(() => {
    const form = hudRef.current
    if (form) {
      if (immersed) form.setAttribute('inert', '')
      else form.removeAttribute('inert')
    }
    engineRef.current?.setImmersed(immersed)
  }, [immersed])

  /* 全屏按钮 + h 键快捷键 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return
      engineRef.current?.wake()
      if (e.key.toLowerCase() === 'h') setImmersed((v) => !v)
    }
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
      engineRef.current?.resize()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFsChange)
    }
  }, [])

  const toggleFullscreen = async () => {
    const scene = sceneRef.current
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (scene.requestFullscreen) await scene.requestFullscreen()
      else if (scene.webkitRequestFullscreen) scene.webkitRequestFullscreen()
    } catch {
      notify('请使用浏览器的全屏功能')
    }
    engineRef.current?.wake()
  }

  const fieldError = (which, message) => {
    setInvalid(which)
    setStatusNow(message)
    const el = which === 'account' ? accountRef.current : passwordRef.current
    el?.focus()
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!username.trim()) return fieldError('account', '请输入账号')
    if (!password) return fieldError('password', '请输入密码')

    setInvalid(null)
    setStatusNow('')
    setBusy(true)
    submittingRef.current = true
    engineRef.current?.setEngaging(true)   // 起穿越特效（同时掐掉全息投影）
    setSummon(false)
    setArrived(false)
    const startedAt = performance.now()

    try {
      // 特效与真实登录并行：请求通常 <100ms，所以实际节奏由 MIN_WARP_MS 决定
      await login(username, password)
      const rest = MIN_WARP_MS - (performance.now() - startedAt)
      if (rest > 0) await sleep(rest)
      if (!mountedRef.current) return
      setArrived(true)                     // 黑屏淡出盖住路由切换
      await sleep(ARRIVAL_MS)
      navigate('/', { replace: true })
    } catch (err) {
      if (!mountedRef.current) return
      submittingRef.current = false           // 交回给 user effect 去处理后续
      engineRef.current?.setEngaging(false)   // 中断穿越
      engineRef.current?.reset()
      setBusy(false)
      setStatusNow(err.message || '登录失败')
    }
  }

  /* 输入即清除报错，与原生 input 事件里的 notify('') 一致 */
  const onInput = (setter) => (e) => {
    setter(e.target.value)
    setInvalid(null)
    setStatusNow('')
    engineRef.current?.wake()
  }

  const rootClass = [
    s.universe,
    quiet && s.quiet,
    immersed && s.immersed,
    busy && s.engaging,
    arrived && s.arrived,
    summon && s.summon,
  ].filter(Boolean).join(' ')

  return (
    <main ref={sceneRef} className={rootClass} aria-label="沉浸式黑洞场景">
      <div className={s.fallback} aria-hidden="true">
        <div className={s['fallback-disk']} />
        <div className={s['fallback-hole']} />
      </div>
      <canvas ref={cosmosRef} className={s.sky} aria-hidden="true" />
      <canvas ref={flightRef} className={s.flight} aria-hidden="true" />
      <div className={s.edge} aria-hidden="true" />

      <button className={s.fullscreen} type="button" onClick={toggleFullscreen}
        aria-label={isFullscreen ? '退出全屏' : '进入全屏'} title="全屏">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6" />
        </svg>
      </button>

      <form ref={hudRef} className={s.hud} onSubmit={submit} noValidate aria-label="登录终端">
        <div className={s.controls}>
          <div className={s.field}>
            <svg className={s['field-icon']} viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="6" r="3" />
              <path d="M4 18v-2a6 6 0 0112 0v2" />
            </svg>
            <label className={s['sr-only']} htmlFor="account">账号</label>
            <input
              ref={accountRef} id="account" name="username" type="text"
              placeholder="请输入账号" autoComplete="username" maxLength={80}
              autoCapitalize="none" spellCheck="false" required disabled={busy}
              aria-describedby="form-status" aria-invalid={invalid === 'account' || undefined}
              value={username} onChange={onInput(setUsername)}
            />
          </div>

          <div className={s.field}>
            <svg className={s['field-icon']} viewBox="0 0 20 20" aria-hidden="true">
              <path d="M6 8V5a4 4 0 018 0v3M4 8h12v10H4zM10 12v3" />
            </svg>
            <label className={s['sr-only']} htmlFor="password">密码</label>
            <input
              ref={passwordRef} id="password" name="password" type="password"
              placeholder="输入密码 如：123456" autoComplete="current-password" required disabled={busy}
              aria-describedby="form-status" aria-invalid={invalid === 'password' || undefined}
              value={password} onChange={onInput(setPassword)}
            />
          </div>

          <button className={s.launch} type="submit" aria-label="启动" disabled={busy}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h15m-6-6 6 6-6 6" />
            </svg>
            <svg className={s.progress} viewBox="0 0 46 46" aria-hidden="true">
              <circle ref={ringRef} cx="23" cy="23" r="21" />
            </svg>
          </button>
        </div>

        <div id="form-status" className={`${s['form-status']}${status ? ` ${s.visible}` : ''}`}
          role="status" aria-live="polite">{status}</div>
      </form>

      <div className={s.arrival} aria-hidden="true" />
    </main>
  )
}
