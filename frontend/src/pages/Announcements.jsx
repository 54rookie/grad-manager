import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { usePageBanner } from '../banner'
import AttachmentList from '../AttachmentList'

function AnnouncementsBannerBridge() {
  usePageBanner({
    title: <span>师门<span className="hl">大小事</span>便签墙</span>,
    subtitle: '钉一张便签，捎一句叮咛，师门动态早知道',
  })
  return null
}

const TAG_NAME = { notice: '通知', study: '学术', task: '任务', life: '生活' }
const TAGS = Object.keys(TAG_NAME)
const COLORS = ['c-cream', 'c-sage', 'c-sky', 'c-rose']
const SHAPES = ['', 's-lined', 's-torn']
const ROTS = ['-1.6deg', '1.2deg', '-0.8deg', '1.8deg', '-1.2deg', '0.9deg']
const PIN_COLORS = ['#f43f5e', '#f59e0b', '#7ba05b', '#5b9aa0']
const STYLE_KEY = 'gm_note_style' // 仅保存便签的装饰偏好（与登录态无关）

/* 读取本地装饰偏好（发布时选择的分类 / 纸色） */
function readStyles() {
  try { return JSON.parse(localStorage.getItem(STYLE_KEY) || '{}') } catch { return {} }
}
function writeStyles(map) {
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

/* 缺省装饰按「id + 标题」稳定推导：与列表顺序无关，刷新后样式不变 */
function styleOf(a) {
  const seed = `${a.id}|${a.title || ''}`
  let h = 0
  for (let k = 0; k < seed.length; k += 1) h = (h * 31 + seed.charCodeAt(k)) % 99991
  return {
    tag: a.__tag || TAGS[h % TAGS.length],
    color: a.__color || COLORS[Math.floor(h / 7) % COLORS.length],
    shape: SHAPES[Math.floor(h / 53) % SHAPES.length],
    deco: Math.floor(h / 101) % 2 ? 'tape' : 'pin',
    rot: ROTS[Math.floor(h / 211) % ROTS.length],
    pinColor: PIN_COLORS[Math.floor(h / 419) % PIN_COLORS.length],
    tapeIdx: Math.floor(h / 823),
  }
}

function Pin({ color }) {
  return (
    <svg className="pin" width="26" height="34" viewBox="0 0 26 34">
      <circle cx="13" cy="10" r="8" fill={color} />
      <circle cx="10.5" cy="7.5" r="2.6" fill="rgba(255,255,255,.55)" />
      <path d="M13 17 L13 32" stroke="#6b5236" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

function Tape({ i }) {
  const kinds = ['t-sun', 't-sage', 't-rose', 't-sky']
  const rots = ['-4deg', '3deg', '-2deg', '5deg']
  return <span className={`tape ${kinds[i % 4]}`} style={{ '--tr': rots[i % 4] }} />
}

export default function Announcements() {
  const { user } = useAuth()
  const toast = useToast()
  const isTeacher = user.role === 'teacher'

  const [notes, setNotes] = useState([])
  const [styles, setStyles] = useState(readStyles)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(null)
  const [tag, setTag] = useState('notice')
  const [color, setColor] = useState('c-cream')
  const [sending, setSending] = useState(false)
  const [crumpling, setCrumpling] = useState(null)

  const load = useCallback(async () => {
    try {
      const list = await api.get('/announcements')
      setNotes(list.map((a) => ({ ...a, ...(styles[a.id] || {}) })))
    } catch (e) { toast(e.message, 'error') }
  }, [toast, styles])

  useEffect(() => { load() }, [load])

  /* ESC 关闭发布弹层 */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setSelected(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* 撕下便签：先播放揉皱坠落动画，再调接口删除 */
  const tear = (note) => {
    if (!isTeacher) return
    setCrumpling(note.id)
    setTimeout(async () => {
      try {
        await api.delete(`/announcements/${note.id}`)
        setNotes((list) => list.filter((n) => n.id !== note.id))
        setSelected(null)
        toast('便签已撕下')
      } catch (e) {
        toast(e.message, 'error')
        setCrumpling(null)
      }
    }, 520)
  }

  const publish = async () => {
    if (!title.trim() || !body.trim()) return toast('标题和内容都要写哦', 'error')
    if (files.length > 10 || files.some((file) => file.size > 20 * 1024 * 1024)) return toast('最多 10 个附件，单个不超过 20 MB', 'error')
    setSending(true)
    try {
      const form = new FormData()
      form.append('title', title.trim())
      form.append('content', body.trim())
      files.forEach((file) => form.append('files', file))
      const created = await api.postForm('/announcements/with-attachments', form)
      const map = { ...readStyles(), [created.id]: { __tag: tag, __color: color } }
      writeStyles(map)
      setStyles(map)
      setOpen(false)
      setTitle('')
      setBody('')
      setFiles([])
      setTag('notice')
      setColor('c-cream')
      toast('便签已钉上公告板 📌', 'success')
      const list = await api.get('/announcements')
      setNotes(list.map((a) => ({ ...a, ...(map[a.id] || {}) })))
      setTimeout(() => document.querySelector('.pg-board .note')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200)
    } catch (e) { toast(e.message, 'error') } finally { setSending(false) }
  }

  const rendered = useMemo(() => notes.map((a) => ({ a, s: styleOf(a) })), [notes])

  return (
    <div className="pg-board">
      <div className="page">
        <AnnouncementsBannerBridge />

        <div className="board-frame">
          {/* 写张便签：嵌进软木墙木框的头部（仅老师） */}
          <div className="board-frame-head">
            <span className="bfh-title">软木墙 · 共 {rendered.length} 张便签</span>
            {isTeacher && (
              <button className="btn-publish" onClick={() => setOpen(true)}>
                <span className="plus">＋</span>写张便签
              </button>
            )}
          </div>
          <div className="board">
            {/* 涂鸦：小太阳 */}
            <svg className="doodle doodle-sun" width="54" height="54" viewBox="0 0 54 54" fill="none">
              <circle cx="27" cy="27" r="10" stroke="#8a5a28" strokeWidth="2" strokeLinecap="round" />
              <g stroke="#8a5a28" strokeWidth="2" strokeLinecap="round">
                <line x1="27" y1="6" x2="27" y2="12" /><line x1="27" y1="42" x2="27" y2="48" />
                <line x1="6" y1="27" x2="12" y2="27" /><line x1="42" y1="27" x2="48" y2="27" />
                <line x1="12" y1="12" x2="16" y2="16" /><line x1="38" y1="38" x2="42" y2="42" />
                <line x1="42" y1="12" x2="38" y2="16" /><line x1="16" y1="38" x2="12" y2="42" />
              </g>
            </svg>
            {/* 涂鸦：风线 */}
            <svg className="doodle doodle-wind" width="90" height="34" viewBox="0 0 90 34" fill="none">
              <path d="M4 10 H58 a8 8 0 1 0 -8 -8" stroke="#8a5a28" strokeWidth="2" strokeLinecap="round" />
              <path d="M12 22 H72 a7 7 0 1 1 -7 7" stroke="#8a5a28" strokeWidth="2" strokeLinecap="round" />
            </svg>

            {rendered.length === 0 && <div className="board-empty">板子空空如也，钉上第一张便签吧 ✎</div>}

            {rendered.map(({ a, s }) => (
              <article key={a.id}
                className={`note ${s.color} ${s.shape}${crumpling === a.id ? ' crumpling' : ''}`}
                style={{ '--r': s.rot }} tabIndex={0} role="button" aria-label={`查看公告：${a.title}`}
                onClick={() => setSelected(a)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(a) } }}>
                {s.deco === 'tape' ? <Tape i={s.tapeIdx} /> : <Pin color={s.pinColor} />}
                {isTeacher && (
                  <button className="note-del" title="撕下这张便签" onClick={(e) => { e.stopPropagation(); tear(a) }}>✕</button>
                )}
                <span className={`note-tag tag-${s.tag}`}>{TAG_NAME[s.tag]}</span>
                <h3>{a.title}</h3>
                <p>{a.content}</p>
                {!!a.attachments?.length && <div className="note-attachment-count">📎 {a.attachments.length} 个附件 · 点击查看</div>}
                <div className="note-meta">
                  <span className="note-date">{new Date(a.created_at).toISOString().slice(0, 10)}</span>
                  <span className="note-author">{a.author_name}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      {/* 发布便签弹层 */}
      <div className={`overlay${open ? ' open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
        <div className="composer">
          <span className="tape t-sun" style={{ '--tr': '-4deg' }} />
          <h2>写一张新便签</h2>
          <div className="field">
            <label>标题</label>
            <input type="text" maxLength={30} value={title} placeholder="譬如：本周组会照常"
              onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>内容</label>
            <textarea rows={3} maxLength={140} value={body} placeholder="写点想对同学们说的话……"
              onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="field">
            <label>附件</label>
            <input type="file" multiple onChange={(e) => { const chosen = Array.from(e.target.files); setFiles((current) => [...current, ...chosen]); e.target.value = '' }} />
            {!!files.length && <div className="pending-names">{files.map((file, i) => <span key={`${i}-${file.name}`}>
              📎 {file.name} <button type="button" onClick={() => setFiles((list) => list.filter((_, n) => n !== i))}>移除</button>
            </span>)}</div>}
          </div>
          <div className="field">
            <label>分类</label>
            <div className="chips">
              {TAGS.map((t) => (
                <span key={t} className={`chip tag-${t}${tag === t ? ' on' : ''}`} onClick={() => setTag(t)}>
                  {TAG_NAME[t]}
                </span>
              ))}
            </div>
          </div>
          <div className="field">
            <label>纸色</label>
            <div className="swatches">
              {COLORS.map((c) => (
                <span key={c} className={`swatch ${c}${color === c ? ' on' : ''}`} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
          <div className="composer-actions">
            <button className="btn-ghost" onClick={() => setOpen(false)}>先不写</button>
            <button className="btn-pin" disabled={sending} onClick={publish}>{sending ? '钉上中…' : '钉上公告板'}</button>
          </div>
        </div>
      </div>
      {selected && <div className="overlay open" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null) }}>
        <div className="composer note-detail" role="dialog" aria-modal="true" aria-label={selected.title}>
          <span className="tape t-sun" />
          <button className="detail-close" onClick={() => setSelected(null)} aria-label="关闭">✕</button>
          <h2>{selected.title}</h2>
          <p>{selected.content}</p>
          <AttachmentList existing={selected.attachments || []}
            pathFor={(id) => `/announcements/attachments/${id}`} toast={toast} />
          <div className="note-meta"><span>{new Date(selected.created_at).toISOString().slice(0, 10)}</span><span>{selected.author_name}</span></div>
        </div>
      </div>}
    </div>
  )
}
