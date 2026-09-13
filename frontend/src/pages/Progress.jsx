import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import HandDrawnSelect from '../HandDrawnSelect'
import Pelican from '../pelican'
import { useMessages } from '../messages'
import { usePageBanner } from '../banner'

/* 风险映射：后端返回 正常 / 预警 / 滞后 */
const RISK = {
  正常: { key: 'ok', label: '正常', cls: '', color: '#7ba05b' },
  预警: { key: 'warn', label: '预警', cls: 'warn', color: '#d97706' },
  滞后: { key: 'bad', label: '滞后', cls: 'bad', color: '#f43f5e' },
}
const AVATAR_COLORS = [
  ['#f59e0b', '#fb923c'], ['#7ba05b', '#a3be78'],
  ['#fb923c', '#fbbf24'], ['#f43f5e', '#fb7185'],
]
const CIRC = 207 // 2πr, r=33

const riskOf = (r) => RISK[r] || RISK['正常']

/* 时间轴填充比例：以最后一个完成节点计算（以 actual 为准，兼容本地未同步的 done 标志） */
function fillPercent(nodes) {
  const n = nodes.length
  const isDone = (nd) => (nd.actual !== undefined ? !!nd.actual : !!nd.done)
  if (n < 2) return n === 1 && isDone(nodes[0]) ? 100 : 0
  let lastDone = -1
  nodes.forEach((nd, i) => { if (isDone(nd)) lastDone = i })
  return lastDone < 0 ? 0 : Math.round((lastDone / (n - 1)) * 100)
}

/* 数字生长动画 */
function CountUp({ target = 0, suffix = '' }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf
    /* 基准取首帧 rAF 的时间戳，而不是 performance.now()：
       两者虽然名义上同一时间原点，但 rAF 给的是「帧开始时刻」，effect 里取到的
       performance.now() 可能比它还晚，于是 (t - t0) 一开始就是负数，
       e = 1-(1-p)³ 跟着变负，统计数字会闪出 -71 这种值。
       统一用 rAF 的时间戳，p 天然 ≥ 0，再夹一道上下界兜底。 */
    let t0 = null
    const dur = 1100
    const tick = (t) => {
      if (t0 === null) t0 = t
      const p = Math.min(Math.max((t - t0) / dur, 0), 1)
      const e = 1 - Math.pow(1 - p, 3)
      setV(Math.round(target * e))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return <>{v}{suffix}</>
}

export default function Progress() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const isTeacher = user.role === 'teacher'
  const [grades, setGrades] = useState([])
  const [projects, setProjects] = useState([])
  const [filter, setFilter] = useState('all')
  const [editingId, setEditingId] = useState(null)
  /* 统计卡联动：点「进度正常/预警关注/严重滞后」高亮对应柱子（再点一次取消） */
  const [riskFilter, setRiskFilter] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [detail, setDetail] = useState(null) // {project, rounds, reports}
  // 催办：点按钮后在原位展开一张精简表单（不再直接弹 toast）
  const [urgeOpen, setUrgeOpen] = useState(false)
  const [urgeTopic, setUrgeTopic] = useState('论文管理')
  const [urgeText, setUrgeText] = useState('')
  const [sending, setSending] = useState(false)
  const saveTimers = useRef({})
  const { send: sendMessage } = useMessages()

  const load = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([api.get('/grades'), api.get('/thesis/projects')])
      setGrades(g)
      setProjects(p)
    } catch (e) { toast(e.message, 'error') }
  }, [toast])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setTimeout(() => setMounted(true), 120); return () => clearTimeout(t) }, [])

  /* ESC 关闭弹窗 */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setDetail(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---------- 数据整形 ---------- */
  const view = useMemo(() => projects.map((p, i) => ({
    ...p,
    nodes: (p.milestones || []).map((m) => ({ ...m, done: !!m.actual })),
    risk: riskOf(p.risk),
    ac: AVATAR_COLORS[i % AVATAR_COLORS.length],
  })), [projects])

  const visible = useMemo(
    () => (filter === 'all' ? view : view.filter((s) => String(s.grade_id) === filter)),
    [view, filter]
  )

  const stats = useMemo(() => {
    const c = { ok: 0, warn: 0, bad: 0 }
    visible.forEach((s) => { c[s.risk.key] += 1 })
    const avg = visible.length ? Math.round(visible.reduce((a, s) => a + s.progress, 0) / visible.length) : 0
    return { total: visible.length, ...c, avg }
  }, [visible])

  const grouped = useMemo(() => {
    const map = new Map()
    visible.forEach((s) => {
      const k = s.grade_name || '未分组'
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(s)
    })
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0], 'zh'))
  }, [visible])

  /* ---------- 统计卡 ↔ 柱状图联动 ---------- */
  const toggleRisk = (k) => setRiskFilter((cur) => (cur === k ? null : k))

  /* ---------- 时间轴编辑（改动后 PUT 回后端） ---------- */
  const persist = (project, nodes, label) => {
    const progress = fillPercent(nodes)
    const milestones = nodes.map(({ key, label: lb, plan, actual }) => ({
      key, label: lb, plan: plan || null, actual: actual || null,
    }))
    setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, milestones, progress } : p)))
    clearTimeout(saveTimers.current[project.id])
    saveTimers.current[project.id] = setTimeout(async () => {
      try {
        await api.put(`/thesis/projects/${project.id}`, { milestones, progress })
        toast(label || '时间轴已保存 ✓', 'success')
      } catch (e) { toast(e.message, 'error') }
    }, 550)
  }

  const toggleNode = (project, index) => {
    const nodes = project.nodes.map((n, i) => {
      if (i !== index) return n
      const next = n.actual ? null : new Date().toISOString().slice(0, 10)
      return { ...n, actual: next, done: !!next } // done 与 actual 同步，保证进度计算正确
    })
    persist(project, nodes, `「${nodes[index].label}」已${nodes[index].actual ? '完成' : '取消完成'} ✓`)
  }

  const renameNode = (project, index, label) => {
    const nodes = project.nodes.map((n, i) => (i === index ? { ...n, label } : n))
    persist(project, nodes, '节点名称已保存 ✓')
  }

  const deleteNode = (project, index) => {
    if (project.nodes.length <= 1) return toast('至少保留一个节点', 'error')
    persist(project, project.nodes.filter((_, i) => i !== index), '节点已删除 ✓')
  }

  const addNode = (project) => {
    persist(project, [...project.nodes, { key: `n${Date.now()}`, label: '新节点', plan: null, actual: null, done: false }], '已新增节点 ✓')
  }

  /* ---------- 详情弹窗 ---------- */
  const openDetail = async (s) => {
    // 学生只能查看进度概览：不拉取他人的往返记录与周报（后端也不放行）
    if (!isTeacher) {
      setDetail({ project: s, rounds: [], reports: [], readonly: true })
      return
    }
    setDetail({ project: s, rounds: null, reports: null })
    try {
      const [rounds, reports] = await Promise.all([
        api.get(`/thesis/projects/${s.id}/rounds`),
        api.get(`/reports/student/${s.student_id}`).catch(() => []),
      ])
      setDetail({ project: s, rounds, reports })
    } catch (e) {
      toast(e.message, 'error')
      setDetail({ project: s, rounds: [], reports: [] })
    }
  }

  /* 朱砂红波纹按压（只做动效，不再直接发 toast） */
  const ripple = (e) => {
    const btn = e.currentTarget
    const b = btn.getBoundingClientRect()
    const size = Math.max(b.width, b.height)
    const rip = document.createElement('span')
    rip.className = 'ripple'
    rip.style.cssText = `width:${size}px;height:${size}px;left:${(e.clientX || b.left + b.width / 2) - b.left - size / 2}px;top:${(e.clientY || b.top + b.height / 2) - b.top - size / 2}px`
    btn.appendChild(rip)
    setTimeout(() => rip.remove(), 700)
  }

  /* 展开催办表单（预填一句得体的提醒，老师改一下就能发） */
  const openUrge = (e, p) => {
    ripple(e)
    setUrgeTopic('论文管理')
    setUrgeText(`${p.student_name}，论文的下一步记得安排上，有卡住的地方随时找我。`)
    setUrgeOpen(true)
  }

  /* 真正把消息发给这位学生 —— 对方账号的铃铛角标会 +1 */
  const sendUrge = async () => {
    const p = detail?.project
    if (!p) return
    if (!urgeText.trim()) return toast('先写一句要提醒的内容吧', 'error')
    setSending(true)
    try {
      await sendMessage({ to_id: p.student_id, topic: urgeTopic, content: urgeText.trim() })
      setUrgeOpen(false)
      setUrgeText('')
      toast(`已把「${urgeTopic}」提醒发给 ${p.student_name} 🔔`, 'success')
    } catch (err) { toast(err.message, 'error') } finally { setSending(false) }
  }

  /* 老师手动指定风险等级（空字符串 = 回到自动判定） */
  const setRiskOverride = async (project, value) => {
    try {
      await api.put(`/thesis/projects/${project.id}`, { risk_override: value })
      toast(value ? `已把 ${project.student_name} 标为「${value}」` : '已恢复自动判定 ✓', 'success')
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const currentWeek = useMemo(() => {
    const d = new Date()
    const start = new Date(d.getFullYear(), 0, 1)
    const wk = Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7)
    return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`
  }, [])

  return (
    <div className="pg-progress">
      {/* 环形进度描边用的渐变：.ring .fg 里写的是 stroke: url(#sunRing),
          而全项目原本没有任何地方定义它 —— 失效的 paint server 引用会让该圆
          整个不绘制，于是所有学生的进度环都只剩灰底、看不出 0%/20%/35% 的差别。
          注意必须真实渲染（不能 display:none），否则引用同样失效。 */}
      <svg className="svg-defs" aria-hidden="true">
        <defs>
          <linearGradient id="sunRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--sun-2)" />
            <stop offset="100%" stopColor="var(--sun)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="page">
        <BannerBridge />

        {/* 数据大盘 */}
        <section className="paper hero">
          <span className="tape" />
          <div className="hero-head">
            <div className="hero-title">
              <span className="stamp-ic">☀</span>全班整体进度对比
              <span className="meta">共 {visible.length} 名学生</span>
            </div>
            {/* 年级筛选：控件长在它所控制的这张卡片里（靠右，与标题同一行） */}
            <HandDrawnSelect
              value={filter}
              options={[
                { value: 'all', label: '全部年级' },
                ...grades.map((g) => ({ value: String(g.id), label: g.name })),
              ]}
              onChange={(v) => { setFilter(v); setRiskFilter(null) }}
            />
          </div>
          <div className="stats">
            <div className="stat"><div className="n"><CountUp target={stats.total} /></div><div className="l">在册学生</div></div>
            <div className={`stat clickable s-ok${riskFilter === 'ok' ? ' active' : ''}`}
              onClick={() => toggleRisk('ok')} title="点击只看「进度正常」的学生，再点一次取消">
              <div className="n ok"><CountUp target={stats.ok} /></div>
              <div className="l" style={{ color: 'var(--sage)' }}>进度正常</div>
            </div>
            <div className={`stat clickable s-warn${riskFilter === 'warn' ? ' active' : ''}`}
              onClick={() => toggleRisk('warn')} title="点击只看「预警关注」的学生，再点一次取消">
              <div className="n warn"><CountUp target={stats.warn} /></div>
              <div className="l" style={{ color: 'var(--amber)' }}>预警关注</div>
            </div>
            <div className={`stat clickable s-bad${riskFilter === 'bad' ? ' active' : ''}`}
              onClick={() => toggleRisk('bad')} title="点击只看「严重滞后」的学生，再点一次取消">
              <div className="n bad"><CountUp target={stats.bad} /></div>
              <div className="l" style={{ color: 'var(--bad)' }}>严重滞后</div>
            </div>
            <div className="stat"><div className="n"><CountUp target={stats.avg} suffix="%" /></div><div className="l">平均完成度</div></div>
          </div>

          {/* 纯手写 SVG 柱状图 */}
          <div className="chart">
            <svg className="chart-svg" viewBox="0 0 1000 230" preserveAspectRatio="none">
              <defs>
                {visible.map((s, i) => (
                  <linearGradient key={s.id} id={`bar-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lighten(s.risk.color, 0.35)} />
                    <stop offset="100%" stopColor={s.risk.color} />
                  </linearGradient>
                ))}
                {visible.map((s, i) => {
                  const slot = 1000 / Math.max(visible.length, 1)
                  const barW = Math.min(slot * 0.5, 46)
                  const cx = slot * i + slot / 2
                  const h = ((s.progress * 0.82 + 4) / 100) * 186
                  return (
                    <clipPath key={`clip-${s.id}`} id={`clip-${i}`}>
                      <rect x={cx - barW / 2} y={196 - h} width={barW} height={h} rx="9" />
                    </clipPath>
                  )
                })}
              </defs>
              {visible.map((s, i) => {
                const slot = 1000 / Math.max(visible.length, 1)
                const barW = Math.min(slot * 0.5, 46)
                const cx = slot * i + slot / 2
                const h = ((s.progress * 0.82 + 4) / 100) * 186
                const y = 196 - h
                return (
                  <g key={s.id}
                    className={`col-group${riskFilter && s.risk.key !== riskFilter ? ' dim' : ''}`}
                    style={{ '--bc': s.risk.color }} onClick={() => openDetail(s)}>
                    <title>{`${s.student_name} · ${s.progress}% · ${s.risk.label}`}</title>
                    <text className="col-val" x={cx} y={Math.max(y - 8, 14)} textAnchor="middle">{s.progress}%</text>
                    <rect className={`bar-rect${mounted ? ' in' : ''}`} x={cx - barW / 2} y={y} width={barW}
                      height={Math.max(h, 2)} rx="9" fill={`url(#bar-${i})`} style={{ transitionDelay: `${i * 70}ms` }} />
                    <rect className="bar-shine" x={cx - barW / 2} y={y} width={barW} height={Math.max(h * 0.42, 2)}
                      fill="rgba(255,255,255,.5)" clipPath={`url(#clip-${i})`} style={{ '--d': `${i * 0.25}s` }} />
                    <text className="col-cap" x={cx} y="214" textAnchor="middle">{s.student_name}</text>
                    <circle className="col-gdot" cx={cx} cy="223" r="3" />
                  </g>
                )
              })}
            </svg>
            {/* 第二只鹈鹕：贴着图表最上方那条横向虚线（.chart::before 的 top:33%）骑 */}
            <div className="ride ride-b ride-chart" aria-hidden="true"><Pelican speed={0.85} /></div>
            {visible.length === 0 && <div className="empty">该年级暂无学生数据</div>}
          </div>
        </section>

        {/* 年级分组 + 学生卡片 */}
        <main>
          {grouped.map(([gradeName, list]) => (
            <section className="grade" key={gradeName}>
              <div className="grade-head">
                <h2>{gradeName}</h2>
                <span className="pill">{list.length} 人</span>
                <span className="line" />
              </div>
              <div className="grid">
                {list.map((s) => (
                  <article className={`paper card${editingId === s.id ? ' editing' : ''}`} key={s.id}
                    onClick={() => { if (!isTeacher || editingId !== s.id) openDetail(s) }}>
                    <span className="tape sage" />
                    <div className="card-top">
                      <div className="avatar" style={{ '--ac1': s.ac[0], '--ac2': s.ac[1] }}>{s.student_name[0]}</div>
                      <div className="who">
                        <div className="name">{s.student_name}</div>
                        <div className="sid">学号 {s.student_no || '—'}</div>
                      </div>
                      <div className="ring">
                        <span className="orbit" />
                        <svg viewBox="0 0 80 80">
                          <circle className="bg" cx="40" cy="40" r="33" />
                          <circle className="fg" cx="40" cy="40" r="33"
                            style={{ strokeDashoffset: mounted ? CIRC * (1 - s.progress / 100) : CIRC }} />
                        </svg>
                        <div className="num"><span>{s.progress}</span><small>%</small></div>
                      </div>
                    </div>

                    {/* 自适应可编辑时间轴 */}
                    <div className="tl">
                      <div className="tl-rail" />
                      <div className="tl-fill" style={{ width: `${fillPercent(s.nodes)}%` }} />
                      <div className="tl-nodes">
                        {s.nodes.map((nd, i) => (
                          <div className={`tl-node ${nd.done ? 'done' : 'todo'}`} key={nd.key || i}>
                            {isTeacher && (
                              <button className="tl-del" title="删除节点"
                                onClick={(e) => { e.stopPropagation(); deleteNode(s, i) }}>×</button>
                            )}
                            <span className="tl-dot" title={isTeacher ? '点击切换完成状态' : undefined}
                              onClick={(e) => { e.stopPropagation(); if (isTeacher) toggleNode(s, i) }} />
                            <span className="tl-lab" title={isTeacher ? '双击改名' : undefined}
                              contentEditable={isTeacher && editingId === s.id}
                              suppressContentEditableWarning
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => { e.stopPropagation(); e.currentTarget.focus() }}
                              onBlur={(e) => {
                                const v = e.currentTarget.textContent.trim()
                                if (v && v !== nd.label) renameNode(s, i, v)
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                            >{nd.label}</span>
                          </div>
                        ))}
                        {isTeacher && (
                          <div className="tl-add">
                            <button title="添加节点" onClick={(e) => { e.stopPropagation(); addNode(s) }}>＋</button>
                          </div>
                        )}
                      </div>
                    </div>
                    {isTeacher && editingId === s.id && (
                      <div className="edit-tip">✎ 编辑模式：点击节点文字改名，× 删除，＋ 新增；点击圆点完成状态</div>
                    )}

                    <div className="card-foot">
                      <span className="meta">当前阶段 · {s.stage}</span>
                      {/* 老师可直接指定风险等级；学生只读展示 */}
                      {isTeacher ? (
                        <select
                          className={`badge badge-sel ${s.risk.cls}${s.risk_override ? ' manual' : ''}`}
                          value={s.risk_override || ''}
                          title="手动指定风险等级（选「自动」则回到系统判定）"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRiskOverride(s, e.target.value)}>
                          <option value="">自动 · {s.risk_auto}</option>
                          <option value="正常">正常</option>
                          <option value="预警">预警</option>
                          <option value="滞后">滞后</option>
                        </select>
                      ) : (
                        <span className={`badge ${s.risk.cls}`}><i />{s.risk.label}</span>
                      )}
                      {isTeacher && (
                        <button className="edit-btn" title="编辑时间轴节点"
                          onClick={(e) => { e.stopPropagation(); setEditingId(editingId === s.id ? null : s.id) }}>✎</button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {visible.length === 0 && <div className="paper empty">该年级暂无学生数据</div>}
        </main>
      </div>

      {/* 详情弹窗 */}
      <div className={`modal${detail ? ' open' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-bg" onClick={() => setDetail(null)} />
        {detail && (
          <div className="modal-card paper">
            <span className="tape rose" />
            <div className="m-hero">
              <div className="avatar" style={{ '--ac1': detail.project.ac[0], '--ac2': detail.project.ac[1] }}>
                {detail.project.student_name[0]}
              </div>
              <div>
                <h3>{detail.project.student_name} 的论文档案夹</h3>
                <div className="sub">
                  学号 {detail.project.student_no || '—'} · {detail.project.grade_name} · 总体进度 {detail.project.progress}% · {detail.project.risk.label}
                </div>
              </div>
              <button className="m-close" title="关闭" aria-label="关闭弹窗" onClick={() => setDetail(null)}>
                <svg viewBox="0 0 16 16"><path d="M2 2 L14 14 M14 2 L2 14" /></svg>
              </button>
            </div>

            <div className={`m-body${detail.readonly ? ' solo' : ''}`}>
              {/* 关键节点：置顶、横向排开，节点多了横向滚动 */}
              <div className="feed feed-nodes">
                <h4><span className="pip" />关键节点进度</h4>
                <div className="nodes-row">
                  {detail.project.milestones.map((m, i) => (
                    <div className={`n-card${m.actual ? '' : ' back'}`} key={m.key || i}>
                      <span className="n-dot" />
                      <div className="n-title">{m.label}</div>
                      <div className="n-tag">{m.actual ? '已完成' : '未开始'}</div>
                      <div className="n-time">
                        <span>计划 {m.plan || '—'}</span>
                        <span>实际 {m.actual || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {detail.readonly && (
                  <div className="readonly-tip">进度看板对所有同学开放，只看不改 —— 想催自己一把的话，早点动手 😉</div>
                )}
              </div>

              {/* 往返记录 | 周报打卡：左右并排，点任意一条跳到对应页面 */}
              {!detail.readonly && (
                <div className="m-cols">
                  <div className="feed">
                    <h4>
                      <span className="pip" />论文往返提交记录
                      <span className="jump-hint">点任意一条 → 论文管理</span>
                    </h4>
                    <div className="vtl">
                      {detail.rounds === null && <div className="v-note">加载中…</div>}
                      {detail.rounds?.length === 0 && <div className="v-note">还没有提交记录。</div>}
                      {detail.rounds?.slice().reverse().map((r) => (
                        <div className={`v-item jumpable${r.teacher_comment ? '' : ' back'}`} key={r.id}
                          title="点击进入论文管理"
                          onClick={() => navigate(`/thesis?studentId=${detail.project.student_id}`)}>
                          <span className="v-dot" />
                          <div className="v-head">
                            <span className="v-title">第 {r.round_no} 轮 · 学生提交</span>
                            <span className="v-tag">{r.teacher_comment ? '已批注' : '待批注'}</span>
                          </div>
                          <div className="v-time">{new Date(r.submitted_at).toLocaleString('zh-CN')}</div>
                          {r.student_text && <div className="v-note">{r.student_text}</div>}
                          {r.teacher_comment && (
                            <>
                              <div className="v-time">批注于 {r.feedback_at ? new Date(r.feedback_at).toLocaleString('zh-CN') : '—'}</div>
                              <div className="v-note">🖊 {r.teacher_comment}</div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="feed">
                    <h4>
                      <span className="pip" />周报打卡记录
                      <span className="jump-hint">点任意一条 → 每周周报</span>
                    </h4>
                    <div className="ck-list">
                      {detail.reports === null && <div className="v-note">加载中…</div>}
                      {detail.reports?.length === 0 && <div className="v-note">还没有周报记录。</div>}
                      {detail.reports?.slice(0, 6).map((r) => (
                        <div className="ck jumpable" key={r.id}
                          title="点击进入每周周报"
                          onClick={() => navigate(`/reports?studentId=${detail.project.student_id}&week=${r.week}`)}>
                          <span className="wk">{r.week}</span>
                          <span className="tx">{(r.content_md || '').replace(/[#*\n]/g, ' ').replace(/-/g, '').trim().slice(0, 30) || '（无内容）'}</span>
                          <span className="st on">已交</span>
                        </div>
                      ))}
                      {detail.reports && detail.reports.length > 0 && !detail.reports.some((r) => r.week === currentWeek) && (
                        <div className="ck jumpable" title="点击进入每周周报"
                          onClick={() => navigate(`/reports?studentId=${detail.project.student_id}&week=${currentWeek}`)}>
                          <span className="wk">{currentWeek}</span>
                          <span className="tx">本周周报尚未提交</span>
                          <span className="st miss">缺卡</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {isTeacher && (
              <div className="m-actions">
                {urgeOpen ? (
                  /* 就地展开的催办表单：选话题 + 写一句，发出去对方角标 +1 */
                  <div className="urge-form">
                    <div className="urge-row">
                      <label className="urge-to">
                        发给 <b>{detail.project.student_name}</b>
                      </label>
                      <select value={urgeTopic} onChange={(e) => setUrgeTopic(e.target.value)}>
                        <option value="论文管理">论文管理</option>
                        <option value="周报">周报</option>
                        <option value="问答点评">问答点评</option>
                      </select>
                    </div>
                    <textarea value={urgeText} autoFocus
                      onChange={(e) => setUrgeText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setUrgeOpen(false) }}
                      placeholder="写一句要提醒同学的话…" />
                    <div className="urge-actions">
                      <button className="btn btn-ghost" type="button" onClick={() => setUrgeOpen(false)}>取消</button>
                      <button className="btn btn-fire" type="button" disabled={sending} onClick={sendUrge}>
                        <span className="bell">🔔</span>{sending ? '发送中…' : '发送提醒'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-fire" type="button" onClick={(e) => openUrge(e, detail.project)}>
                    <span className="bell">🔔</span>一键催办 / 提醒
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* 颜色变亮（柱状图顶端渐变） */
function lighten(hex, ratio) {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  const mix = (c) => Math.round(c + (255 - c) * ratio)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

/* 把标题注入全局 Banner（年级筛选下放到页面 DOM） */
function BannerBridge() {
  usePageBanner({
    title: <span>学生<span className="hl">论文进度</span>看板</span>,
    subtitle: '一图览尽师门论文进展，愿每行字都踏着晴日前行',
  })
  return null
}
