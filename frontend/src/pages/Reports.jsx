import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, downloadAttachment } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { usePageBanner } from '../banner'
import AttachmentList from '../AttachmentList'
import ReportEditor from '../ReportEditor'
import { isAscendedWeek } from '../reportStatus'
import { waitForProgressSaves } from '../progressSave'
import AscensionFormation from '../AscensionFormation'
import OverdueFigure from '../OverdueFigure'

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
const STATUS_FIGURES = {
  未交: '/report-status/status-qi.svg',
  已交: '/report-status/status-yuanying.svg',
  已飞升: '/report-status/status-ascension.svg',
}
const StatusFigure = ({ status }) => status === '逾期'
  ? <OverdueFigure />
  : <img className="report-student-figure" src={STATUS_FIGURES[status]} alt="" aria-hidden="true" />
const DEFAULT_TEMPLATE = '## 本周进展\n- …\n\n## 遇到问题\n- …\n\n## 下周计划\n- …'
const IMAGE_TOKEN = /!\[([^\]\n]*)\]\(attachment:(pending-[a-z0-9-]+|\d+)\)/g
const isRasterImage = (file) => /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(file.type)

function InlineReportImage({ name, path, file, onRemove, toast }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!path && !file) return undefined
    let active = true
    let objectUrl = ''
    const load = async () => {
      try {
        objectUrl = URL.createObjectURL(file || await api.fileBlob(path))
        if (active) setUrl(objectUrl)
        else URL.revokeObjectURL(objectUrl)
      } catch (e) { if (active) toast(e.message, 'error') }
    }
    load()
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [file, path, toast])
  return <figure className="report-inline-image">
    {url ? <img src={url} alt={name} /> : <span>图片加载中…</span>}
    <figcaption><span>{name}</span>
      {path && <button type="button" onClick={() => downloadAttachment(path, name).catch((e) => toast(e.message, 'error'))}>下载</button>}
      {onRemove && <button type="button" onClick={onRemove}>移除图片</button>}
    </figcaption>
  </figure>
}

function reportImage(token, name, attachments, pending, toast, onRemove) {
  const saved = attachments.find((a) => String(a.id) === token)
  const local = pending.find((item) => `pending-${item.key}` === token)
  if (!saved && !local) return <span className="md-empty">图片「{name}」不可用</span>
  return <InlineReportImage name={saved?.name || local.file.name}
    path={saved ? `/reports/attachments/${saved.id}` : undefined} file={local?.file}
    onRemove={onRemove} toast={toast} />
}

/* 后端状态 → 视觉状态；图标也由状态决定，逾期不能画成已交的勾。 */
const STATUS = {
  已交: { cls: 'ok', stamp: 'ok' },
  未交: { cls: 'no', stamp: 'no' },
  逾期: { cls: 'late', stamp: 'late' },
  已飞升: { cls: 'ascended', stamp: 'ascended' },
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

/* 周次显示：meta 里带「第 N 周」（老师可自定义基准周，见后端 semester_config）。
   基准周之前的周次算出来是 0 或负数，不显示「第 N 周」，退回 ISO 周并标注「开学前」。 */
function weekLabel(week, meta) {
  const i = meta?.week_index?.[week]
  if (!i || i < 1) return `${week}（开学前）`
  return `第 ${i} 周 · ${week}`
}

/* 日历大字：优先显示学期内的「第 N 周」，没有就退回 ISO 周号 */
function weekNoOf(week, meta) {
  const i = meta?.week_index?.[week]
  return i && i > 0 ? i : weekNo(week)
}

const ymd = (d) => (d
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : '')

/* ISO 周 → 该周周日（YYYY-MM-DD）。基准周对外一律用日期表达，老师只选周日。 */
const weekSunday = (week) => ymd(weekBounds(week)?.sunday)

function studentWeekStatus(week, hasReport, ascensionWindows) {
  if (isAscendedWeek(week, ascensionWindows)) return '已飞升'
  if (hasReport) return '已交'
  const end = weekBounds(week)?.sunday
  if (!end) return '未交'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  return today > end ? '逾期' : '未交'
}

/* 极简 Markdown → JSX（标题 / 列表 / 加粗） */
function Md({ src, attachments = [], pending = [], toast, empty = '该同学本周暂未提交周报。' }) {
  if (!src || !src.trim()) return <p className="md-empty">{empty}</p>
  const bold = (t) => t.split(/\*\*(.+?)\*\*/g).map((seg, i) => (i % 2 ? <strong key={i}>{seg}</strong> : seg))
  const blocks = []
  let list = []
  const flush = () => { if (list.length) { blocks.push(<ul key={`u${blocks.length}`}>{list}</ul>); list = [] } }
  src.split('\n').forEach((raw, idx) => {
    const t = raw.trim()
    if (!t) { flush(); return }
    const images = [...t.matchAll(IMAGE_TOKEN)]
    if (images.length) {
      flush()
      let offset = 0
      images.forEach((match, n) => {
        const before = t.slice(offset, match.index).trim()
        if (before) blocks.push(<p key={`${idx}-before-${n}`}>{bold(before)}</p>)
        blocks.push(<div key={`${idx}-image-${n}`}>{reportImage(match[2], match[1], attachments, pending, toast)}</div>)
        offset = match.index + match[0].length
      })
      const after = t.slice(offset).trim()
      if (after) blocks.push(<p key={`${idx}-after`}>{bold(after)}</p>)
      return
    }
    if (t.startsWith('## ')) { flush(); blocks.push(<h4 key={idx}>{t.slice(3)}</h4>) }
    else if (t.startsWith('# ')) { flush(); blocks.push(<h4 key={idx}>{t.slice(2)}</h4>) }
    else if (t.startsWith('- ')) { list.push(<li key={idx}>{bold(t.slice(2))}</li>) }
    else { flush(); blocks.push(<p key={idx}>{bold(t)}</p>) }
  })
  flush()
  return <>{blocks}</>
}

export default function Reports() {
  const { user } = useAuth()
  const isTeacher = user.role === 'teacher'

  const [weeks, setWeeks] = useState({ current: '', weeks: [], week_index: {}, semesters: [], ascension_windows: [] })
  const [week, setWeek] = useState('')
  /* 学期筛选（与周次构成双重条件）；空串 = 还没拿到后端给的默认学期 */
  const [semester, setSemester] = useState('')
  const [reloading, setReloading] = useState(false)
  /* 学期基准周设置（仅老师）—— 用「周日日期」表达 */
  const [semCfgOpen, setSemCfgOpen] = useState(false)
  const [semStartDate, setSemStartDate] = useState('')
  const [savingSem, setSavingSem] = useState(false)
  const [board, setBoard] = useState(null)
  const [statsBack, setStatsBack] = useState(false)
  const [semesterStats, setSemesterStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [statsRevision, setStatsRevision] = useState(0)
  const [mine, setMine] = useState(null)
  const [myList, setMyList] = useState([])   // 学生本人的全部周报（供「最近十周打卡」用）
  const [open, setOpen] = useState(null) // 打开的学生条目
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState(false)
  const [showExample, setShowExample] = useState(false)
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [templateDraft, setTemplateDraft] = useState('')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([])
  const [keptAttachments, setKeptAttachments] = useState([])
  const richEditor = useRef(null)
  const calendarFormation = useRef(null)
  const boardShell = useRef(null)
  const boardFront = useRef(null)
  const boardBack = useRef(null)
  const hasFlippedBoard = useRef(false)
  const weeksRequest = useRef(0)
  const timers = useRef({})
  const toast = useToast()

  /* 周次元数据：带上学期就只取该学期的周次（学期 → 周 的双重筛选由后端算好）。
     week 的落点：还在新列表里就留着，否则落到该学期的默认周（本周 / 学期内最后一周）。 */
  const loadWeeks = useCallback(async (sem) => {
    const requestId = ++weeksRequest.current
    try {
      const q = sem ? `?semester=${encodeURIComponent(sem)}` : ''
      const w = await api.get(`/reports/weeks${q}`)
      if (requestId !== weeksRequest.current) return
      setWeeks(w)
      setSemester((cur) => cur || w.semester)
      setWeek((cur) => (cur && w.weeks.includes(cur) ? cur : w.default_week))
    } catch (e) { if (requestId === weeksRequest.current) toast(e.message, 'error') }
  }, [toast])

  useEffect(() => {
    loadWeeks()
    return () => { weeksRequest.current += 1 }
  }, [loadWeeks])
  useEffect(() => {
    let active = true
    api.get('/reports/template').then((data) => { if (active) setTemplate(data.template) })
      .catch((e) => { if (active) toast(e.message, 'error') })
    return () => { active = false }
  }, [toast])

  /* 按周加载数据 */
  useEffect(() => {
    if (!week) return
    let alive = true
    ;(async () => {
      try {
        await waitForProgressSaves()
        if (!alive) return
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
      } catch (e) { if (alive) toast(e.message, 'error') }
    })()
    return () => { alive = false }
  }, [week, isTeacher, toast])

  useEffect(() => {
    boardFront.current?.toggleAttribute('inert', statsBack)
    boardBack.current?.toggleAttribute('inert', !statsBack)
    let focusFrame
    if (hasFlippedBoard.current) {
      focusFrame = requestAnimationFrame(() => boardShell.current?.focus())
    }
    hasFlippedBoard.current = true
    return () => { if (focusFrame) cancelAnimationFrame(focusFrame) }
  }, [statsBack, isTeacher])

  useEffect(() => {
    if (!isTeacher || !statsBack || !semester) return undefined
    let active = true
    setStatsLoading(true)
    setStatsError('')
    setSemesterStats(null)
    ;(async () => {
      try {
        await waitForProgressSaves()
        if (!active) return
        const data = await api.get(`/reports/semester-stats?semester=${encodeURIComponent(semester)}`)
        if (active) setSemesterStats(data)
      } catch (e) {
        if (active) {
          setStatsError(e.message)
          toast(e.message, 'error')
        }
      }
      finally { if (active) setStatsLoading(false) }
    })()
    return () => { active = false }
  }, [isTeacher, statsBack, semester, statsRevision, toast])

  useEffect(() => {
    if (!statsBack) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setStatsBack(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [statsBack])

  /* ESC 关闭弹窗（手账本 + 学期基准周设置） */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { closeBook(); setSemCfgOpen(false); setTemplateOpen(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [searchParams] = useSearchParams()
  const openedRef = useRef('')

  const items = board?.items || []
  const requiredItems = items.filter((i) => i.status !== '已飞升')
  const submitted = requiredItems.filter((i) => i.status === '已交').length
  const pct = requiredItems.length ? Math.round((submitted / requiredItems.length) * 100) : items.length ? 100 : 0

  /* 学生视角的卡片数据 */
  const myCard = useMemo(() => (mine ? [{
    student_id: user.id,
    student_name: user.name,
    student_no: user.student_no,
    grade_name: user.grade_name,
    status: studentWeekStatus(week, true, weeks.ascension_windows),
    report: mine,
  }] : [{
    student_id: user.id,
    student_name: user.name,
    student_no: user.student_no,
    grade_name: user.grade_name,
    status: studentWeekStatus(week, false, weeks.ascension_windows),
    report: null,
  }]), [mine, user, week, weeks.ascension_windows])

  // 新年级排在前面；同年级保留接口原有顺序，统计仍使用原始 items。
  const cards = isTeacher ? [...items].sort((a, b) => {
    const year = (item) => Number(String(item.grade_name || '').match(/\d{2,4}/)?.[0] || 0)
    return year(b) - year(a)
  }) : myCard

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

  /* 学生端进度条：统计「本学期已经开过头」的周里已交的比例。
     周次列表是升序的（第 1 周在最前），基准周之前 / 本周之后的周不算进去。 */
  const startedWeeks = useMemo(() => {
    const idx = weeks.week_index || {}
    const curIdx = idx[weeks.current]
    return (weeks.weeks || []).filter((w) => curIdx == null || idx[w] == null || idx[w] <= curIdx)
  }, [weeks])

  const requiredWeeks = startedWeeks.filter((w) => !isAscendedWeek(w, weeks.ascension_windows))
  const myTotal = requiredWeeks.length
  const myDone = requiredWeeks.filter((w) => myList.some((r) => r.week === w)).length
  const myPct = myTotal ? Math.round((myDone / myTotal) * 100) : startedWeeks.length ? 100 : 0

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
      status: studentWeekStatus(w, !!rep, weeks.ascension_windows), report: rep,
    })
  }

  /* 最近十周打卡：已飞升优先，其余周次与后端同样按提交/周日截止判定。 */
  const stampWeeks = useMemo(() => {
    if (isTeacher) return []
    const done = new Set(myList.map((r) => r.week))
    return startedWeeks.slice(-10).reverse().map((w) => ({
      week: w, status: studentWeekStatus(w, done.has(w), weeks.ascension_windows),
    }))
  }, [startedWeeks, myList, isTeacher, weeks.ascension_windows])

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
      const form = new FormData()
      form.append('content_md', draft)
      form.append('keep_ids', JSON.stringify(keptAttachments.map((a) => a.id)))
      form.append('file_keys', JSON.stringify(pendingFiles.map((item) => item.key)))
      pendingFiles.forEach((item) => form.append('files', item.file))
      await api.postForm(`/reports/my/${week}/submit`, form)
      toast(`${week} 周报已提交 ✓`, 'success')
      setEditing(false)
      setOpen(null)
      const list = await api.get('/reports/my')
      setMine(list.find((r) => r.week === week) || null)
      setMyList(list)
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
    setKeptAttachments(mine?.attachments || [])
    setPendingFiles([])
    setPreview(false)
    setShowExample(false)
    setEditing(true)
  }

  const changeWeek = (w) => {
    setWeek(w)
    setOpen(null)
    setEditing(false)
  }

  /* 切学期 = 重新取该学期的周次；week 由 loadWeeks 落到该学期的默认周 */
  const changeSemester = (key) => {
    setSemester(key)
    setOpen(null)
    setEditing(false)
    loadWeeks(key)
  }

  /* 刷新按钮：重新拉一遍「周次元数据 + 当前周数据」。
     原来直接调 changeWeek(week) 是空转 —— week 没变，依赖 week 的 effect 不会重跑，
     所以点了没反应。这里显式重取，并把结果交给全局 toast 组件反馈。 */
  const refreshAll = async () => {
    if (reloading) return
    setReloading(true)
    try {
      const q = semester ? `?semester=${encodeURIComponent(semester)}` : ''
      const w = await api.get(`/reports/weeks${q}`)
      setWeeks(w)
      const target = w.weeks.includes(week) ? week : w.default_week
      setWeek(target)
      if (isTeacher) {
        await waitForProgressSaves()
        setBoard(await api.get(`/reports/board?week=${target}`))
        setStatsRevision((value) => value + 1)
      } else {
        const list = await api.get('/reports/my')
        setMyList(list)
        setMine(list.find((r) => r.week === target) || null)
      }
      toast(`${weekLabel(target, w)} 周报数据已刷新 ✓`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setReloading(false)
    }
  }

  /* 学期基准周设置（仅老师） */
  const openSemCfg = () => {
    setSemStartDate(weeks.start_date || weekSunday(weeks.start_week) || '')
    setSemCfgOpen(true)
  }

  const saveSemesterConfig = async () => {
    if (!semStartDate) return toast('请选择作为第 1 周的周日日期', 'error')
    setSavingSem(true)
    try {
      await api.put('/reports/semester-config', { semester, start_date: semStartDate })
      setSemCfgOpen(false)
      toast('学期基准周已保存，周次已重新推算 ✓', 'success')
      await loadWeeks(semester)   // 第 N 周要按新基准重算
    } catch (e) { toast(e.message, 'error') } finally { setSavingSem(false) }
  }

  /* 关闭手账本（同时退出编辑态） */
  const closeBook = () => {
    setOpen(null)
    setEditing(false)
    setShowExample(false)
  }

  const addReportFiles = (list) => {
    const files = Array.from(list)
    if (keptAttachments.length + pendingFiles.length + files.length > 10) {
      toast('每份周报最多 10 个附件', 'error')
      return
    }
    if (files.some((file) => file.size > 20 * 1024 * 1024)) {
      toast('每个附件不能超过 20 MB', 'error')
      return
    }
    const added = files.map((file) => ({
      key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      file,
    }))
    setPendingFiles((current) => [...current, ...added])
    const images = added.filter((item) => isRasterImage(item.file))
    if (images.length) {
      if (richEditor.current && !preview) richEditor.current.insertImages(images)
      else {
        const lines = images.map((item) => `![${item.file.name.replace(/[\]\n]/g, '')}](attachment:pending-${item.key})`).join('\n')
        setDraft((current) => `${current}${current && !current.endsWith('\n') ? '\n' : ''}${lines}\n`)
        setPreview(false)
      }
    }
  }

  const removeInlineImage = (token) => {
    if (token.startsWith('pending-')) {
      setPendingFiles((list) => list.filter((item) => `pending-${item.key}` !== token))
    } else {
      setKeptAttachments((list) => list.filter((a) => String(a.id) !== token))
    }
  }

  const saveTemplate = async () => {
    if (!templateDraft.trim()) return toast('请填写周报示例', 'error')
    setSavingTemplate(true)
    try {
      const data = await api.put('/reports/template', { template: templateDraft })
      setTemplate(data.template)
      setTemplateOpen(false)
      toast('周报示例已更新', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setSavingTemplate(false) }
  }

  return (
    <div className="pg-report">
      <div className="page">
        <ReportsBannerBridge />

        {/* 模块一：撕页日历 + 提交大盘 */}
        <section className="desk">
          <div className="calendar" onMouseEnter={() => calendarFormation.current?.activate()}
            onMouseLeave={() => calendarFormation.current?.deactivate()}>
            <div className="cal-top"><span>WEEKLY</span></div>
            <div className="cal-body">
              <div className="cal-week">{weekNoOf(week, weeks)}<small>周</small></div>
              <div className="cal-range">{weekRange(week)}</div>
              <div className="cal-sel">
                <select aria-label="选择周次" value={week} onChange={(e) => changeWeek(e.target.value)}>
                  {weeks.weeks.map((w) => (
                    <option key={w} value={w}>
                      {weekLabel(w, weeks)}{w === weeks.current ? ' · 本周' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {/* 双重条件筛选：学期（+年份）收窄上面的周次范围 */}
              <div className="cal-term-label">学期筛选</div>
              <div className="cal-sel cal-term">
                <select aria-label="选择学期" value={semester} onChange={(e) => changeSemester(e.target.value)}>
                  {(weeks.semesters || []).map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="cal-ascension">
              <AscensionFormation ref={calendarFormation} className="cal-formation" hoverSelf={false} />
              <strong>快和我跳出三届之外 !</strong>
              <span>写完两篇论文即可飞升</span>
            </div>
          </div>

          <div className={`board${isTeacher ? ' board-flippable' : ''}${statsBack ? ' flipped' : ''}`}
            ref={boardShell}
            tabIndex={isTeacher ? 0 : undefined}
            aria-label={isTeacher ? (statsBack ? '周报统计情况，点击翻回提交情况' : '全班提交情况，点击翻转查看统计') : undefined}
            onClick={isTeacher ? (e) => {
              if (!e.target.closest('button, a, input, select, textarea')) setStatsBack((value) => !value)
            } : undefined}
            onKeyDown={isTeacher ? (e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                setStatsBack((value) => !value)
              }
            } : undefined}>
            <span className="tape" />
            <div className="board-flip-inner">
            <div className="board-face board-face-front" ref={boardFront} aria-hidden={statsBack}>
            <div className="board-head">
              <div className="board-title">
                <span className="pin">✓</span>{isTeacher ? '全班提交情况' : '我的提交情况'}
              </div>
              <span className="board-meta">
                {isTeacher
                  ? `${weekLabel(week, weeks)} · 已收 ${submitted} / ${requiredItems.length} 份`
                  : `${weekLabel(week, weeks)} · ${myCard[0].status === '已飞升' ? '已飞升 · 本周免交' : mine ? '已提交' : '尚未提交'}`}
                {isTeacher && (
                  <button className="board-refresh board-cfg" type="button" onClick={(e) => { e.stopPropagation(); openSemCfg() }}
                    title="设置哪一周算「第 1 周」（学期基准周）">
                    ⚙ 学期起始周
                  </button>
                )}
                <button className={`board-refresh${reloading ? ' busy' : ''}`} type="button"
                  onClick={(e) => { e.stopPropagation(); refreshAll() }} disabled={reloading} title="重新拉取当前周报数据">
                  <span className="ico">↻</span> {reloading ? '刷新中…' : '刷新'}
                </button>
                {isTeacher && <button className="board-refresh board-stats-toggle" type="button"
                  onClick={(e) => { e.stopPropagation(); setStatsBack(true) }}>▣ 查看统计</button>}
              </span>
            </div>
            <div className="track">
              <div className="track-fill" style={{ width: `${isTeacher ? pct : myPct}%` }} />
            </div>
            <div className="track-labels">
              <span>{isTeacher ? '提交进度' : `累计提交进度 · 已交 ${myDone}/${myTotal} 周`}</span>
              <b>{isTeacher ? `${pct}%` : `${myPct}%`}</b>
            </div>

            {/* 学生端：与老师端共用状态小人，点击小人查看对应周报。 */}
            {!isTeacher && stampWeeks.length > 0 && (
              <div className="stamps">
                <div className="stamps-head">最近十周提交记录</div>
                <div className="report-student-grid">
                  {stampWeeks.map((s) => {
                    const st = stOf(s.status)
                    return (
                      <div key={s.week} className={`report-student report-week ${st.cls}${s.week === week ? ' selected' : ''}`}>
                        <button className="report-student-figure-button" type="button"
                          title={`${s.week}（${weekRange(s.week)}）· ${s.status} · 点击查看该周周报`}
                          aria-label={`查看第 ${weeks.week_index?.[s.week] || weekNo(s.week)} 周周报，${s.status}`}
                          onClick={() => openWeekReport(s.week)}>
                          <StatusFigure status={s.status} />
                        </button>
                        <span className="report-student-name">W{weekNo(s.week)}</span>
                        <span className="report-student-status">{s.status}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* 老师端：原 HTML 的四境 SVG 完整保存在独立文件中 */}
            {isTeacher && (
            <div className="report-student-grid">
              {cards.map((it) => {
                const st = stOf(it.status)
                return (
                  <div key={it.student_id} className={`report-student ${st.cls}`} onClick={(e) => e.stopPropagation()}>
                    <button className="report-student-figure-button" type="button"
                      title={`${it.student_name} · ${it.status}${it.report ? ' · 本周有周报' : ''}`}
                      aria-label={`查看${it.student_name}的周报，${it.status}`}
                      onClick={() => openStudent(it, false)}>
                      <StatusFigure status={it.status} />
                    </button>
                    <span className="report-student-name">{it.student_name}</span>
                    <span className="report-student-status">{it.status}</span>
                  </div>
                )
              })}
            </div>
            )}
            </div>
            {isTeacher && <div className="board-face board-face-back" ref={boardBack} aria-hidden={!statsBack}>
              <div className="report-stats-head">
                <div className="board-title"><span className="pin">▣</span>周报统计 · {weeks.semester_label}</div>
                <button className="board-refresh" type="button"
                  onClick={(e) => { e.stopPropagation(); setStatsBack(false) }}>↩ 返回提交情况</button>
              </div>
              {!semesterStats && <div className="report-stats-empty" role={statsError ? 'alert' : undefined}>
                <p>{statsLoading ? '正在整理周报统计…' : statsError || '暂无统计数据'}</p>
                {!statsLoading && statsError && <button className="board-refresh" type="button"
                  onClick={(e) => { e.stopPropagation(); setStatsRevision((value) => value + 1) }}>↻ 重试加载</button>}
              </div>}
              {semesterStats && <>
                <div className="report-stats-summary">
                  {[
                    ['本周应交', semesterStats.current_week.required],
                    ['本周已交', semesterStats.current_week.submitted],
                    ['本周未交', semesterStats.current_week.missing],
                    ['本周逾期', semesterStats.current_week.overdue],
                    ['本周已飞升', semesterStats.current_week.ascended],
                    ['学期总上交率', `${semesterStats.totals.rate}%`],
                  ].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
                </div>
                <p className="report-stats-note">
                  学期已开始 {semesterStats.week_count} 周 · 应交 {semesterStats.totals.required} 人次，已交 {semesterStats.totals.submitted} 人次
                  {semesterStats.totals.required === 0 && semesterStats.student_count > 0 && semesterStats.week_count > 0 ? ' · 全部免交，完成率按 100% 显示' : ''}
                </p>
                <div className="report-stats-columns">
                  <section>
                    <h5>每位学生 · 学期上交率</h5>
                    <div className="report-stats-list">
                      {semesterStats.students.length ? semesterStats.students.map((item) => (
                        <div className="report-rate-row" key={item.student_id}>
                          <span className="report-rate-name">{item.student_name}<small>{item.required
                            ? `已交 ${item.submitted}/${item.required} 周` : item.ascended ? '本学期免交' : '暂无应交周'}</small></span>
                          <span className="report-rate-track"><i style={{ width: `${item.rate}%` }} /></span>
                          <b>{item.rate}%</b>
                        </div>
                      )) : <p className="report-stats-empty">暂无学生</p>}
                    </div>
                  </section>
                  <section>
                    <h5>每周全班 · 上交率</h5>
                    <div className="report-stats-list">
                      {semesterStats.weeks.length ? semesterStats.weeks.map((item) => (
                        <div className="report-rate-row" key={item.week}>
                          <span className="report-rate-name">{weekLabel(item.week, weeks)}<small>{item.required
                            ? `已交 ${item.submitted}/${item.required} 人` : item.ascended ? '全员免交' : '暂无学生'}</small></span>
                          <span className="report-rate-track"><i style={{ width: `${item.rate}%` }} /></span>
                          <b>{item.rate}%</b>
                        </div>
                      )) : <p className="report-stats-empty">本学期还没有开始的周次</p>}
                    </div>
                  </section>
                </div>
              </>}
            </div>}
            </div>
          </div>
        </section>

        {/* 模块二：便签网格 */}
        <div className="section-head">
          <h2>{isTeacher ? '学生周报' : '我的周报'}</h2>
          <span className="line" />
          {isTeacher && <button className="act act-view" onClick={() => { setTemplateDraft(template); setTemplateOpen(true) }}>✎ 编辑周报示例</button>}
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
                  {brief || <span style={{ color: 'var(--ink-3)' }}>{it.status === '已飞升' ? '基础节点已完成 · 本周免交' : '这一周还没有提交周报'}</span>}
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
                  {brief || <span style={{ color: 'var(--ink-3)' }}>{it.status === '已飞升' ? '基础节点已完成 · 本周免交' : '本周周报还未出现在桌面上…'}</span>}
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
                      attachments={open.report?.attachments || []} toast={toast}
                      empty={open.status === '已飞升' ? '基础节点已完成，这一周无需提交周报。'
                        : isTeacher ? '该同学本周暂未提交周报。' : '这一周还没有提交周报。'} />
                  </div>
                  <AttachmentList existing={(open.report?.attachments || []).filter((a) => !open.report?.content_md?.includes(`attachment:${a.id})`))}
                    pathFor={(id) => `/reports/attachments/${id}`} toast={toast} />
                </>
              ) : (
                <>
                  <div className="edit-bar">
                    <div className="sub">撰写 {week} 周报 · 支持 Markdown（## 标题、- 列表、**加粗**）</div>
                    <button className="mini-toggle" onClick={() => setPreview(!preview)}>{preview ? '继续编辑' : '预览'}</button>
                  </div>
                  {preview
                    ? <div className="md"><Md src={draft} attachments={keptAttachments} pending={pendingFiles} toast={toast} empty="（还没有内容）" /></div>
                    : <ReportEditor ref={richEditor} value={draft} onChange={setDraft} placeholder={DEFAULT_TEMPLATE}
                        attachments={keptAttachments} pending={pendingFiles}
                        onRemoveImage={removeInlineImage} toast={toast} />}
                  <div className="report-file-actions">
                    <label className="mini-toggle">＋ 插入文件
                      <input type="file" multiple onChange={(e) => { addReportFiles(e.target.files); e.target.value = '' }} />
                    </label>
                    <span>图片插入光标位置；单个不超过 20 MB，最多 10 个</span>
                  </div>
                  <AttachmentList existing={keptAttachments.filter((a) => !draft.includes(`attachment:${a.id})`))}
                    pending={pendingFiles.filter((item) => !draft.includes(`attachment:pending-${item.key})`)).map((item) => item.file)}
                    pathFor={(id) => `/reports/attachments/${id}`}
                    onRemoveExisting={(id) => setKeptAttachments((list) => list.filter((a) => a.id !== id))}
                    onRemovePending={(index) => {
                      const loose = pendingFiles.filter((item) => !draft.includes(`attachment:pending-${item.key})`))
                      setPendingFiles((list) => list.filter((item) => item.key !== loose[index]?.key))
                    }}
                    toast={toast} />
                </>
              )}
            </div>

            {/* 右页：红笔批注 */}
            <div className="page-r">
              <button className="m-close" title="关闭" aria-label="关闭弹窗" onClick={closeBook}>
                <svg viewBox="0 0 16 16"><path d="M2 2 L14 14 M14 2 L2 14" /></svg>
              </button>
              <div className="report-side-head">
                <h4>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#d63050" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>{showExample && editing ? '周报示例' : isTeacher ? '导师批注' : '老师的批注'}
                </h4>
                {editing && <button className="mini-toggle example-toggle" type="button"
                  onClick={() => setShowExample((value) => !value)}>
                  {showExample ? '老师批注' : '周报示例'}
                </button>}
              </div>

              {showExample && editing ? (
                <div className="md report-example"><Md src={template} toast={toast} empty="暂无周报示例。" /></div>
              ) : <div className="cmt-list">
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
                  : <div className="cmt-empty">{open.report ? '还没有批注，写下第一条红笔意见吧。'
                    : open.status === '已飞升' ? '已飞升，本周无需提交周报。' : '该同学本周还没有提交周报。'}</div>}
              </div>}

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
                  <span className="cmt-tip">{open.status === '已飞升' ? '本周免交，也可自愿撰写'
                    : mine ? '可随时修改本周周报' : '本周周报还没写'}</span>
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

      {/* 学期基准周设置（仅老师）：决定「第 1 周」落在哪个 ISO 周，
          保存后后端按新基准重算第 N 周，页面立即重取一次。
          复用全站既有的 .overlay + .pwd-card 弹窗骨架。 */}
      {isTeacher && semCfgOpen && (
        <div className="overlay open"
          onClick={(e) => { if (e.target === e.currentTarget) setSemCfgOpen(false) }}>
          <div className="pwd-card">
            <span className="tape" />
            <h3>学期基准周</h3>
            <p className="pwd-sub">
              {weeks.semester_label || '当前学期'} · 选定哪一周算「第 1 周」，
              选项按周日排（该周日所在的那一周即为第 1 周），系统据此推算后续所有周次。
            </p>
            <div className="field">
              <label>第 1 周的周日</label>
              <select value={semStartDate} onChange={(e) => setSemStartDate(e.target.value)}>
                {weeks.weeks.map((w) => {
                  const d = weekSunday(w)
                  return d ? <option key={w} value={d}>{d}</option> : null
                })}
              </select>
            </div>
            <p className="sem-hint">
              当前生效：{weeks.start_date || weekSunday(weeks.start_week)}
              （{weeks.start_week_custom ? '老师自定义' : '按学期默认'}）
            </p>
            <div className="pwd-actions">
              <button className="btn-ghost" type="button" onClick={() => setSemCfgOpen(false)}>取消</button>
              <button className="btn-pin" type="button" disabled={savingSem} onClick={saveSemesterConfig}>
                {savingSem ? '保存中…' : '保存并重算'}
              </button>
            </div>
          </div>
        </div>
      )}
      {isTeacher && templateOpen && (
        <div className="overlay open" onClick={(e) => { if (e.target === e.currentTarget) setTemplateOpen(false) }}>
          <div className="pwd-card report-template-card">
            <span className="tape" />
            <h3>编辑周报示例</h3>
            <p className="pwd-sub">这段文字显示在学生撰写周报时的右侧示例页，支持 Markdown；左侧浅色提示始终保持系统原始模版。</p>
            <textarea value={templateDraft} maxLength={4000} onChange={(e) => setTemplateDraft(e.target.value)} />
            <div className="pwd-actions">
              <button className="btn-ghost" onClick={() => setTemplateOpen(false)}>取消</button>
              <button className="btn-pin" disabled={savingTemplate} onClick={saveTemplate}>{savingTemplate ? '保存中…' : '保存示例'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
