import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { usePageBanner } from '../banner'

function ReportsBannerBridge() {
  usePageBanner({
    title: <span>小组每周的<span className="hl">周报本</span></span>,
    subtitle: '每周一份，记录走过的路，见证科研的每一步',
  })
  return null
}

const AVATAR_COLORS = [
  ['#f59e0b', '#fb923c'], ['#7ba05b', '#a3be78'],
  ['#fb923c', '#fbbf24'], ['#f43f5e', '#fb7185'],
]

/* 后端状态 → 视觉状态 */
const STATUS = {
  已交: { cls: 'ok', stamp: '', dot: '#7ba05b', filled: true },
  未交: { cls: 'no', stamp: 'no', dot: '#c9b992', filled: false },
  逾期: { cls: 'late', stamp: 'late', dot: '#f43f5e', filled: true },
}
const stOf = (s) => STATUS[s] || STATUS['未交']

/* ISO 周 → 该周的周一 / 周日 */
function weekBounds(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(week || '')
  if (!m) return null
  const y = Number(m[1])
  const w = Number(m[2])
  const jan4 = new Date(y, 0, 4)
  const mondayW1 = new Date(jan4)
  mondayW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  const monday = new Date(mondayW1)
  monday.setDate(mondayW1.getDate() + (w - 1) * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { monday, sunday }
}

/* ISO 周 → 起止日期（MM.DD — MM.DD） */
function weekRange(week) {
  const b = weekBounds(week)
  if (!b) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(b.monday.getMonth() + 1)}.${pad(b.monday.getDate())} — ${pad(b.sunday.getMonth() + 1)}.${pad(b.sunday.getDate())}`
}

const weekNo = (week) => (week || '').split('-W')[1] || '—'

/* 极简 Markdown → JSX（标题 / 列表 / 加粗） */
function Md({ src, empty = '该同学本周暂未提交周报。' }) {
  if (!src || !src.trim()) return <p className="md-empty">{empty}</p>
  const bold = (t) => t.split(/\*\*(.+?)\*\*/g).map((seg, i) => (i % 2 ? <strong key={i}>{seg}</strong> : seg))
  const blocks = []
  let list = []
  const flush = () => { if (list.length) { blocks.push(<ul key={`u${blocks.length}`}>{list}</ul>); list = [] } }
  src.split('\n').forEach((raw, idx) => {
    const t = raw.trim()
    if (!t) { flush(); return }
    if (t.startsWith('## ')) { flush(); blocks.push(<h4 key={idx}>{t.slice(3)}</h4>) }
    else if (t.startsWith('# ')) { flush(); blocks.push(<h4 key={idx}>{t.slice(2)}</h4>) }
    else if (t.startsWith('- ')) { list.push(<li key={idx}>{bold(t.slice(2))}</li>) }
    else { flush(); blocks.push(<p key={idx}>{bold(t)}</p>) }
  })
  flush()
  return <>{blocks}</>
}

/* 手绘抖动圆圈 + 对勾 */
function HandCircle({ color, filled }) {
  return (
    <svg viewBox="0 0 34 34">
      {filled ? (
        <circle cx="17" cy="17" r="13.5" fill="none" stroke={color} strokeWidth="2.2" strokeDasharray="86"
          strokeLinecap="round" transform="rotate(-78 17 17)" />
      ) : (
        <circle cx="17" cy="17" r="13.5" fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" />
      )}
      {filled && (
        <path d="M11 17.5 L15.5 21.5 L24 12.5" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

export default function Reports() {
  const { user } = useAuth()
  const isTeacher = user.role === 'teacher'

  const [weeks, setWeeks] = useState({ current: '', weeks: [] })
  const [week, setWeek] = useState('')
  const [board, setBoard] = useState(null)
  const [mine, setMine] = useState(null)
  const [myList, setMyList] = useState([])   // 学生本人的全部周报（供「最近十周打卡」用）
  const [open, setOpen] = useState(null) // 打开的学生条目
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState(false)
  const timers = useRef({})
  const toast = useToast()

  const loadWeeks = useCallback(async () => {
    try {
      const w = await api.get('/reports/weeks')
      setWeeks(w)
      setWeek((cur) => cur || w.current)
    } catch (e) { toast(e.message, 'error') }
  }, [toast])

  useEffect(() => { loadWeeks() }, [loadWeeks])

  /* 按周加载数据 */
  useEffect(() => {
    if (!week) return
    let alive = true
    ;(async () => {
      try {
        if (isTeacher) {
          const b = await api.get(`/reports/board?week=${week}`)
          if (alive) setBoard(b)
        } else {
          const list = await api.get('/reports/my')
          if (alive) {
            setMine(list.find((r) => r.week === week) || null)
            setMyList(list)   // 同一份数据复用给「最近十周打卡」，不额外发请求
            setBoard(null)
          }
        }
      } catch (e) { toast(e.message, 'error') }
    })()
    return () => { alive = false }
  }, [week, isTeacher, toast])

  /* ESC 关闭弹窗 */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeBook() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [searchParams] = useSearchParams()
  const openedRef = useRef('')

  const items = board?.items || []
  const submitted = items.filter((i) => i.status === '已交').length
  const pct = items.length ? Math.round((submitted / items.length) * 100) : 0

  /* 学生视角的卡片数据 */
  const myCard = useMemo(() => (mine ? [{
    student_id: user.id,
    student_name: user.name,
    student_no: user.student_no,
    grade_name: user.grade_name,
    status: '已交',
    report: mine,
  }] : [{
    student_id: user.id,
    student_name: user.name,
    student_no: user.student_no,
    grade_name: user.grade_name,
    status: '未交',
    report: null,
  }]), [mine, user])

  const cards = isTeacher ? items : myCard

  /* 从进度看板弹窗点「周报打卡记录」跳过来时带着 ?studentId=..&week=..
     —— 先切到那一周，等该周数据回来后再自动翻开手账本。
     老师端也要认：跳转是从老师的看板弹窗发起的。
     openedRef 保证只自动打开一次，否则每次渲染都会重开、用户关不掉。 */
  useEffect(() => {
    const sid = searchParams.get('studentId')
    const w = searchParams.get('week')
    if (!sid || !w) return
    if (week !== w) { changeWeek(w); return }      // 先切周，week 变化后本 effect 会再跑一次
    const key = `${sid}|${w}`
    if (openedRef.current === key) return
    if (isTeacher) {
      const it = items.find((i) => String(i.student_id) === sid)
      if (!it) return                              // 本周名单还没回来，等 items 变化再试
      openedRef.current = key
      openStudent(it, false)
    } else {
      if (String(user.id) !== sid || !myList.length) return
      openedRef.current = key
      openWeekReport(w)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, week, items, myList, isTeacher, user])

  /* 学生端进度条：统计「从第一周到本周」已交周数占窗口总周数的比例
     （老师端仍是当周收取率 pct，见上） */
  const myTotal = weeks.weeks?.length || 0
  const myDone = (weeks.weeks || []).filter((w) => myList.some((r) => r.week === w)).length
  const myPct = myTotal ? Math.round((myDone / myTotal) * 100) : 0

  /* 只有本周的周报能改，历史周一律只读 */
  const isCurrentWeek = !!week && week === weeks.current

  /* 点十周印章 → 直接翻开那一周的手账本（数据已在 myList 里，不用再请求）。
     ⚠ 必须先 changeWeek 再 setOpen：changeWeek 内部会 setOpen(null) 清场，
     顺序反了的话刚设好的 open 会被它冲掉，弹窗打不开。 */
  const openWeekReport = (w) => {
    const rep = myList.find((r) => r.week === w) || null
    changeWeek(w)   // 日历与周次下拉一起同步过去（顺带清空旧弹窗）
    setOpen({
      student_id: user.id, student_name: user.name,
      student_no: user.student_no, grade_name: user.grade_name,
      status: rep ? '已交' : '未交', report: rep,
    })
  }

  /* 最近十周打卡：weeks.weeks 由近及远（后端 recent_weeks(12)），取前十周。
     状态判定与后端保持一致（backend/app/routers/reports.py:99）：
     有该周周报 → 已交；否则「今天」已过该周周日 → 逾期；再否则 → 未交。
     后端比的是日期不是时刻，这里也把两边都归零到当天再比。 */
  const stampWeeks = useMemo(() => {
    if (isTeacher) return []
    const done = new Set(myList.map((r) => r.week))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return (weeks.weeks || []).slice(0, 10).map((w) => {
      if (done.has(w)) return { week: w, status: '已交' }
      const b = weekBounds(w)
      if (!b) return { week: w, status: '未交' }
      const end = new Date(b.sunday)
      end.setHours(0, 0, 0, 0)
      return { week: w, status: today > end ? '逾期' : '未交' }
    })
  }, [weeks, myList, isTeacher])

  /* 学生端下方网格：最近十周各一张卡片（老师端仍用当周全班名单） */
  const weekCards = useMemo(() => {
    if (isTeacher) return []
    return stampWeeks.map((s) => ({
      key: s.week,
      week: s.week,
      isCurrent: s.week === weeks.current,
      status: s.status,
      report: myList.find((r) => r.week === s.week) || null,
    }))
  }, [isTeacher, stampWeeks, myList, weeks.current])

  /* 老师发点评 */
  const sendComment = async (e) => {
    const btn = e.currentTarget
    const b = btn.getBoundingClientRect()
    const size = Math.max(b.width, b.height)
    const rip = document.createElement('span')
    rip.className = 'ripple'
    rip.style.cssText = `width:${size}px;height:${size}px;left:${(e.clientX || b.left + b.width / 2) - b.left - size / 2}px;top:${(e.clientY || b.top + b.height / 2) - b.top - size / 2}px`
    btn.appendChild(rip)
    setTimeout(() => rip.remove(), 700)

    if (!comment.trim()) return toast('先写点批注内容再发送哦', 'error')
    setSending(true)
    try {
      const updated = await api.post(`/reports/${open.report.id}/comments`, { content: comment })
      setComment('')
      setOpen({ ...open, report: updated })
      toast(`批注已发送给 ${open.student_name} ✓`, 'success')
      const fresh = await api.get(`/reports/board?week=${week}`)
      setBoard(fresh)
    } catch (err) { toast(err.message, 'error') } finally { setSending(false) }
  }

  /* 学生写周报 */
  const saveReport = async () => {
    if (!draft.trim()) return toast('内容不能为空', 'error')
    setSending(true)
    try {
      await api.post(`/reports/my/${week}`, { content_md: draft })
      toast(`${week} 周报已提交 ✓`, 'success')
      setEditing(false)
      setOpen(null)
      const list = await api.get('/reports/my')
      setMine(list.find((r) => r.week === week) || null)
    } catch (e) { toast(e.message, 'error') } finally { setSending(false) }
  }

  const openStudent = (it, focusComment) => {
    setOpen(it)
    setComment('')
    if (focusComment) setTimeout(() => document.querySelector('.pg-report .cmt-box textarea')?.focus(), 460)
  }

  const startWrite = () => {
    setOpen(myCard[0]) // 学生端：打开自己的手账本并进入编辑态
    setDraft(mine?.content_md || '')
    setPreview(false)
    setEditing(true)
  }

  const changeWeek = (w) => {
    setWeek(w)
    setOpen(null)
    setEditing(false)
  }

  /* 关闭手账本（同时退出编辑态） */
  const closeBook = () => {
    setOpen(null)
    setEditing(false)
  }

  return (
    <div className="pg-report">
      <div className="page">
        <ReportsBannerBridge />

        {/* 模块一：撕页日历 + 提交大盘 */}
        <section className="desk">
          <div className="calendar">
            <div className="cal-top"><span>WEEKLY</span></div>
            <div className="cal-body">
              <div className="cal-week">{weekNo(week)}<small>周</small></div>
              <div className="cal-range">{weekRange(week)}</div>
              <div className="cal-sel">
                <select aria-label="选择周次" value={week} onChange={(e) => changeWeek(e.target.value)}>
                  {weeks.weeks.map((w) => (
                    <option key={w} value={w}>
                      {w}{w === weeks.current ? ' · 本周' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="board">
            <span className="tape" />
            <div className="board-head">
              <div className="board-title">
                <span className="pin">✓</span>{isTeacher ? '全班提交情况' : '我的提交情况'}
              </div>
              <span className="board-meta">
                {isTeacher
                  ? `${week} · 已收 ${submitted} / ${items.length} 份`
                  : `${week} · ${mine ? '已提交' : '尚未提交'}`}
                <button className="board-refresh" onClick={() => changeWeek(week)}>↻ 刷新</button>
              </span>
            </div>
            <div className="track">
              <div className="track-fill" style={{ width: `${isTeacher ? pct : myPct}%` }} />
            </div>
            <div className="track-labels">
              <span>{isTeacher ? '提交进度' : `累计提交进度 · 已交 ${myDone}/${myTotal} 周`}</span>
              <b>{isTeacher ? `${pct}%` : `${myPct}%`}</b>
            </div>

            {/* 学生端：最近十周打卡印章（已交=绿 / 未交=灰 / 逾期=红） */}
            {!isTeacher && stampWeeks.length > 0 && (
              <div className="stamps">
                <div className="stamps-head">最近十周提交记录</div>
                <div className="stamp-row">
                  {stampWeeks.map((s) => {
                    const st = stOf(s.status)
                    return (
                      <div key={s.week} className={`stamp-cell ${st.cls}`}
                        title={`${s.week}（${weekRange(s.week)}）· ${s.status} · 点击查看该周周报`}
                        onClick={() => openWeekReport(s.week)}>
                        <span className="stamp-mark">
                          {s.status === '已交' ? '✓' : s.status === '逾期' ? '!' : '·'}
                        </span>
                        <span className="stamp-week">W{weekNo(s.week)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* 全班每个人的圆点：这是老师点开某个学生周报的主要入口，学生端不需要 */}
            {isTeacher && (
            <div className="dots">
              {cards.map((it, i) => {
                const st = stOf(it.status)
                return (
                  <div key={it.student_id} className={`dot ${st.cls}`} onClick={() => openStudent(it, false)}>
                    <HandCircle color={st.dot} filled={st.filled} />
                    <span className="who">{it.student_name[0]}</span>
                    <span className="tip">
                      {it.student_name} · {it.status}
                      {it.report ? ` · 提交于 ${new Date(it.report.created_at).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
            )}
            <div className="legend">
              <span><i className="l1" />已交</span>
              <span><i className="l2" />未交</span>
              <span><i className="l3" />逾期</span>
            </div>
          </div>
        </section>

        {/* 模块二：便签网格 */}
        <div className="section-head">
          <h2>{isTeacher ? '学生周报' : '我的周报'}</h2>
          <span className="line" />
          {!isTeacher && (
            <div className="head-actions">
              {isCurrentWeek ? (
                <button className="act act-cmt" onClick={startWrite}>
                  {mine ? '✎ 修改本周报' : '✎ 撰写周报'}
                </button>
              ) : (
                <span className="ro-hint">📖 历史周报 · 只读</span>
              )}
            </div>
          )}
        </div>

        <main className="grid">
          {/* 学生端：最近十周各一张周卡，点开就是那一周的只读周报 */}
          {!isTeacher && weekCards.map((it, i) => {
            const st = stOf(it.status)
            const brief = it.report
              ? (it.report.content_md || '').replace(/[#*]/g, '').split('\n').filter((l) => l.trim()).join(' ').slice(0, 60)
              : ''
            return (
              <article key={it.key} style={{ '--d': `${i * 0.05}s` }}
                className={`note week-note${it.isCurrent ? ' is-current' : ''}`}
                onClick={() => openWeekReport(it.week)}>
                <span className="pin-deco" />
                <span className="tape-deco" />
                <span className={`stamp ${st.stamp}`}>{it.status}</span>
                <div className="wn-top">
                  <span className="wn-week">W{weekNo(it.week)}</span>
                  <span className="wn-range">{weekRange(it.week)}</span>
                </div>
                <div className="note-brief">
                  {brief || <span style={{ color: 'var(--ink-3)' }}>这一周还没有提交周报</span>}
                </div>
                <div className="note-foot">
                  <span className="tm">
                    {it.report ? `提交于 ${new Date(it.report.created_at).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}` : '—'}
                  </span>
                  <span className="wk">{it.isCurrent ? '本周' : `${weekNo(it.week)} 周`}</span>
                </div>
                <div className="actions">
                  <button className="act act-view"
                    onClick={(e) => { e.stopPropagation(); openWeekReport(it.week) }}>👁 查看</button>
                </div>
              </article>
            )
          })}

          {isTeacher && cards.map((it, i) => {
            const st = stOf(it.status)
            const brief = it.report
              ? (it.report.content_md || '').replace(/[#*]/g, '').split('\n').filter((l) => l.trim()).join(' ').slice(0, 60)
              : ''
            return (
              <article className="note" key={it.student_id} style={{ '--d': `${i * 0.05}s` }}
                onClick={() => openStudent(it, false)}>
                <span className="pin-deco" />
                <span className="tape-deco" />
                <span className={`stamp ${st.stamp}`}>{it.status}</span>
                <div className="note-head">
                  <div className="avatar" style={{ '--ac1': AVATAR_COLORS[i % 4][0], '--ac2': AVATAR_COLORS[i % 4][1] }}>
                    {it.student_name[0]}
                  </div>
                  <div>
                    <div className="nm">{it.student_name}</div>
                    <div className="gd">{it.grade_name || '—'} · 学号 {(it.student_no || '—').slice(-4)}</div>
                  </div>
                </div>
                <div className="note-brief">
                  {brief || <span style={{ color: 'var(--ink-3)' }}>本周周报还未出现在桌面上…</span>}
                </div>
                <div className="note-foot">
                  <span className="tm">
                    {it.report ? `提交于 ${new Date(it.report.created_at).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}` : '—'}
                  </span>
                  <span className="wk">{weekNo(week)} 周</span>
                </div>
                <div className="actions">
                  <button className="act act-view" onClick={(e) => { e.stopPropagation(); openStudent(it, false) }}>👁 查看</button>
                  {isTeacher ? (
                    <button className="act act-cmt" onClick={(e) => { e.stopPropagation(); openStudent(it, true) }}>✎ 点评</button>
                  ) : (
                    <button className="act act-cmt" onClick={(e) => { e.stopPropagation(); startWrite() }}>✎ {mine ? '修改' : '撰写'}</button>
                  )}
                </div>
              </article>
            )
          })}
          {cards.length === 0 && (
            <div className="empty">{isTeacher ? '本周暂无学生数据' : '还没有可展示的周次'}</div>
          )}
        </main>
      </div>

      {/* 模块三：手账本弹窗 */}
      <div className={`modal${open ? ' open' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-bg" onClick={closeBook} />
        {open && (
          <div className="book">
            <div className="rings"><i /><i /><i /><i /><i /></div>

            {/* 左页：周报正文（学生可编辑） */}
            <div className="page-l">
              <span className="tape" />
              {!editing ? (
                <>
                  <div className="m-stu">
                    <div className="avatar" style={{ '--ac1': '#f59e0b', '--ac2': '#fb923c' }}>{open.student_name[0]}</div>
                    <div>
                      <h3>{open.student_name} 的周报</h3>
                      <div className="sub">
                        {open.grade_name || '—'} · 学号 {open.student_no || '—'} · 第 {weekNo(week)} 周
                        {open.report ? ` · 提交于 ${new Date(open.report.created_at).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}` : ''}
                      </div>
                    </div>
                    <span className={`stamp ${stOf(open.status).stamp}`}>{open.status}</span>
                  </div>
                  <div className="md">
                    <Md src={open.report?.content_md}
                      empty={isTeacher ? '该同学本周暂未提交周报。' : '这一周还没有提交周报。'} />
                  </div>
                </>
              ) : (
                <>
                  <div className="edit-bar">
                    <div className="sub">撰写 {week} 周报 · 支持 Markdown（## 标题、- 列表、**加粗**）</div>
                    <button className="mini-toggle" onClick={() => setPreview(!preview)}>{preview ? '继续编辑' : '预览'}</button>
                  </div>
                  {preview
                    ? <div className="md"><Md src={draft} empty="（还没有内容）" /></div>
                    : <textarea className="md-edit" value={draft} readOnly={!isCurrentWeek}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={'## 本周进展\n- …\n\n## 遇到问题\n- …\n\n## 下周计划\n- …'} />}
                </>
              )}
            </div>

            {/* 右页：红笔批注 */}
            <div className="page-r">
              <button className="m-close" title="关闭" aria-label="关闭弹窗" onClick={closeBook}>
                <svg viewBox="0 0 16 16"><path d="M2 2 L14 14 M14 2 L2 14" /></svg>
              </button>
              <h4>
                <svg viewBox="0 0 24 24" fill="none" stroke="#d63050" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>{isTeacher ? '导师批注' : '老师的批注'}
              </h4>

              <div className="cmt-list">
                {open.report?.comments?.length
                  ? open.report.comments.map((c, i) => (
                    <div className="cmt" key={c.id} style={{ animationDelay: `${i * 0.08}s` }}>
                      <div className="who">
                        <b>{c.author_name}</b>
                        <span>{new Date(c.created_at).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}</span>
                      </div>
                      {c.content}
                      <span className="wave" />
                    </div>
                  ))
                  : <div className="cmt-empty">{open.report ? '还没有批注，写下第一条红笔意见吧。' : '该同学本周还没有提交周报。'}</div>}
              </div>

              {editing ? (
                <div className="cmt-foot">
                  <span className="cmt-tip">提交后将同步给老师</span>
                  <button className="btn-send" disabled={sending} onClick={saveReport}>
                    <span className="pen">🖊</span>{sending ? '提交中…' : '提交周报'}
                  </button>
                </div>
              ) : isTeacher && open.report ? (
                <>
                  <div className="cmt-box">
                    <textarea value={comment} onChange={(e) => setComment(e.target.value)}
                      placeholder="用红笔写下你的批注… 如：实验部分不错，注意补充误差分析。" />
                  </div>
                  <div className="cmt-foot">
                    <span className="cmt-tip">批注将实时同步给该学生</span>
                    <button className="btn-send" disabled={sending} onClick={sendComment}>
                      <span className="pen">🖊</span>{sending ? '发送中…' : '发送点评'}
                    </button>
                  </div>
                </>
              ) : !isTeacher && !editing && isCurrentWeek ? (
                <div className="cmt-foot">
                  <span className="cmt-tip">{mine ? '可随时修改本周周报' : '本周周报还没写'}</span>
                  <button className="btn-send" onClick={startWrite}>
                    <span className="pen">🖊</span>{mine ? '修改周报' : '撰写周报'}
                  </button>
                </div>
              ) : !isTeacher && !editing ? (
                /* 历史周：没有提交按钮，只有一句说明 */
                <div className="cmt-foot">
                  <span className="cmt-tip ro">🕰 {week} 是历史周次，只能查看，不能修改</span>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
