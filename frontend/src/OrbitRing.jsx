import { useEffect, useId, useRef, useState } from 'react'
import './orbit-ring.css'

/* 半径 44 → 周长 2πr = 276.46，与原型 stroke-dasharray 完全一致 */
const R = 44
const C = 276.46

/**
 * 数字补间 —— 原型 tweenNum 的 React 版。
 * 900ms、缓出曲线 1-(1-k)³，从当前值补到目标值；挂载时从 0 长上来。
 */
function useTweenNum(target, dur = 900) {
  const [value, setValue] = useState(0)
  const cur = useRef(0)

  useEffect(() => {
    const from = cur.current
    if (from === target) return undefined
    let raf
    let t0 = null
    const step = (t) => {
      if (t0 === null) t0 = t
      const k = Math.min((t - t0) / dur, 1)
      const e = 1 - Math.pow(1 - k, 3)
      const v = Math.round(from + (target - from) * e)
      cur.current = v
      setValue(v)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, dur])

  return value
}

/**
 * 星轨 · 电子环绕 —— 学生卡片右上角的环形进度条。
 *
 * Props
 *  - percent  0~100 的基础节点完成度（超出 100% 的进阶状态由 state 表达）
 *  - state    'normal' | 'break'（修论文）| 'ult'（中论文）
 *  - size     环形进度条的**视觉直径**，默认 200（原设计尺寸）
 *  - box      **占位直径**（不传 = 与 size 相同）。
 *             传得比 size 小，环就会溢出自己的盒子、压在父容器上，
 *             父容器（卡片）的尺寸完全不受环影响。
 *  - title    原生 title 提示文案
 *
 * 视觉与动效 1:1 移植自 electron-orbit.html，样式见 ./orbit-ring.css
 */
export default function OrbitRing({ percent = 0, state = 'normal', size = 200, box, title }) {
  const uid = useId()
  /* 同一页面上会同时渲染几十个环，渐变 id 必须各自唯一，否则所有环都会
     引用到第一个（虽然当前配色相同看不出差别，但那是非法的重复 id） */
  const gradId = `orbit-grad-${uid.replace(/[:]/g, '')}`
  const boxSize = box ?? size

  const pct = Math.max(0, Math.min(100, Number(percent) || 0))
  const advanced = state === 'break' || state === 'ult'
  /* 进阶状态（修 / 中）按原型逻辑直接把环画满，中心改显大字 */
  const shown = advanced ? 100 : pct

  const num = useTweenNum(shown)

  /* 首帧先画空环，下一帧再补到目标值 —— 否则挂载瞬间没有「从 0 长上来」的过程 */
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const dashoffset = C * (1 - (ready ? shown : 0) / 100)

  /* 六芒星轨道（三条倾斜椭圆）随进度略微变亮：起点接近原型的固定色，
     满进度时明显一档 —— 幅度刻意压低，只做「越满越亮」的暗示，不抢主角。 */
  const lineAlpha = (0.26 + 0.32 * (shown / 100)).toFixed(3)

  return (
    <div
      className="orbit-ring"
      data-state={state}
      title={title}
      /* --orb-size 是占位盒（撑布局用），--orb-scale 才是视觉大小：
         两者可以不一致，环就会溢出盒子压在父容器上，而父容器尺寸完全不变。
         --orb-line-a 把进度传进 CSS，供轨道线亮度用。 */
      style={{
        '--orb-size': `${boxSize}px`,
        '--orb-scale': size / 200,
        '--orb-line-a': lineAlpha,
      }}
    >
      <div className="orbit-ring__scale">
        <div className="orbit-ring__stage">
          <div className="orb-rays" />
          <div className="orb-halo" />

          <svg className="orb-crown" viewBox="0 0 64 48">
            <path d="M6 40 L10 14 L22 26 L32 6 L42 26 L54 14 L58 40 Z" fill="#ffd166" stroke="#e8a020"
              strokeWidth="3" strokeLinejoin="round" />
            <circle cx="32" cy="6" r="4" fill="#f59e0b" />
            <circle cx="10" cy="13" r="3.4" fill="#f59e0b" />
            <circle cx="54" cy="13" r="3.4" fill="#f59e0b" />
          </svg>

          <div className="orb-nucleus" />

          {['oa', 'ob', 'oc'].map((k) => (
            <div className={`orb-orbit3d ${k}`} key={k}>
              <div className="orb-line" />
              <div className="orb-spinner"><i className="orb-electron" /></div>
            </div>
          ))}

          <svg className="orb-ring-svg" width="200" height="200" viewBox="0 0 200 200">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffd166" />
                <stop offset="1" stopColor="#ff8f3c" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(190,140,70,.16)" strokeWidth="9" />
            <circle className="orb-prog" cx="100" cy="100" r={R} fill="none" stroke={`url(#${gradId})`}
              strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={dashoffset} />
          </svg>

          <div className="orbit-ring__center">
            {advanced
              ? <div className={`orb-word orb-word--${state === 'ult' ? 'ult' : 'break'}`}>{state === 'ult' ? '中' : '修'}</div>
              : <div className="orb-num">{num}<small>%</small></div>}
          </div>
        </div>
      </div>
    </div>
  )
}
