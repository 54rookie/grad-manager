// 纯手写 SVG 图表：甜甜圈进度环 + 节点时间轴

export function Donut({ value = 0, size = 64, stroke = 7, color = '#a8563c', track = '#e8ddc8' }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - value / 100)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="donut-text">
        {value}%
      </text>
    </svg>
  )
}

const RISK_COLOR = { 正常: '#5d7a52', 预警: '#b8862e', 滞后: '#a83c3c' }

export function MilestoneTrack({ milestones = [] }) {
  const W = 340
  const H = 46
  const pad = 26
  const n = milestones.length || 1
  const step = (W - pad * 2) / Math.max(n - 1, 1)
  const today = new Date().toISOString().slice(0, 10)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="milestone-track">
      <path
        d={`M ${pad} 22 ${milestones.map((_, i) => `L ${pad + i * step} 22`).join(' ')}`}
        fill="none" stroke="#d8cbb0" strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round"
      />
      {milestones.map((m, i) => {
        const x = pad + i * step
        const done = !!m.actual
        const late = !done && m.plan && m.plan < today
        const fill = done ? '#5d7a52' : late ? '#a83c3c' : '#f5efe0'
        const strokeC = done ? '#5d7a52' : late ? '#a83c3c' : '#a8563c'
        return (
          <g key={m.key || i}>
            <circle cx={x} cy={22} r={done ? 6 : 5} fill={fill} stroke={strokeC} strokeWidth="1.6" />
            {done && (
              <path d={`M ${x - 2.6} 22 l 1.8 2 l 3.4 -3.6`} fill="none" stroke="#f5efe0" strokeWidth="1.4" strokeLinecap="round" />
            )}
            <text x={x} y={40} textAnchor="middle" className="milestone-label">{m.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function RiskBadge({ risk }) {
  return (
    <span className="risk-badge" style={{ '--risk-color': RISK_COLOR[risk] || '#8a7a5c' }}>
      {risk}
    </span>
  )
}

export function OverviewPie({ stats, size = 150 }) {
  // stats: [{label, value, color}]
  const total = stats.reduce((s, x) => s + x.value, 0) || 1
  const r = size / 2 - 8
  const cx = size / 2
  const cy = size / 2
  let angle = -Math.PI / 2
  const arcs = stats.filter((s) => s.value > 0).map((s) => {
    const a0 = angle
    const a1 = angle + (s.value / total) * Math.PI * 2
    angle = a1
    const large = a1 - a0 > Math.PI ? 1 : 0
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    const d = s.value === total
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
      : `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
    return <path key={s.label} d={d} fill={s.color} stroke="#fbf7ec" strokeWidth="2" />
  })
  return (
    <div className="pie-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{arcs}</svg>
      <div className="pie-legend">
        {stats.map((s) => (
          <div key={s.label} className="pie-legend-item">
            <span className="pie-dot" style={{ background: s.color }} />
            {s.label} · {s.value}
          </div>
        ))}
      </div>
    </div>
  )
}
