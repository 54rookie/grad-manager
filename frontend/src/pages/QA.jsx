import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { Modal } from '../components'
import { usePageBanner } from '../banner'

function QABannerBridge() {
  usePageBanner({
    title: <span>研途<span className="hl">问答</span>师生交流</span>,
    subtitle: '遇到瓶颈不要怕，在这里留下你的疑惑与思考',
  })
  return null
}

export default function QA() {
  const { user } = useAuth()
  const toast = useToast()
  const [questions, setQuestions] = useState([])
  const [openReplies, setOpenReplies] = useState({})
  const [modal, setModal] = useState(null) // {kind:'question'} | {kind:'reply', question}
  const [draft, setDraft] = useState('')

  const load = async () => {
    try {
      setQuestions(await api.get('/questions'))
    } catch (e) { toast(e.message, 'error') }
  }
  useEffect(() => { load() }, [])

  const openModal = (kind, question = null) => {
    setDraft('')
    setModal({ kind, question })
  }

  const submit = async () => {
    if (!draft.trim()) return toast('内容不能为空', 'error')
    try {
      if (modal.kind === 'question') {
        await api.post('/questions', { content: draft })
        toast('已发布', 'success')
      } else {
        await api.post(`/questions/${modal.question.id}/replies`, { content: draft })
        toast('回复已发送', 'success')
        setOpenReplies({ ...openReplies, [modal.question.id]: true })
      }
      setModal(null)
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const remove = async (qid) => {
    if (!window.confirm('确定删除这条提问？')) return
    try {
      await api.del(`/questions/${qid}`)
      toast('已删除', 'success')
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="page page-narrow">
      <QABannerBridge />

      {/* 注意：这里不能再叫 .qa-actions——它同时被每张卡片内的回复按钮行复用，
           外层用这个名字会让 .page-narrow .qa-actions 的后代选择器误伤卡片内部 */}
      <div className="feed-head">
        <span className="fh-title">全部提问 · 共 {questions.length} 条</span>
        <button className="btn-primary" onClick={() => openModal('question')}>✎ 发布提问</button>
      </div>

      <div className="qa-feed">
        {questions.map((q) => (
          <article key={q.id} className="qa-card panel">
            <div className="qa-head">
              <span className={`avatar ${q.author_role}`}>{q.author_name[0]}</span>
              <div className="qa-meta">
                <span className="qa-author">{q.author_name}
                  {q.author_role === 'teacher' && <span className="role-tag">老师</span>}
                </span>
                <span className="qa-time">{new Date(q.created_at).toLocaleString('zh-CN')}</span>
              </div>
              {(user.role === 'teacher' || q.author_name === user.name) && (
                <button className="btn-ghost danger small" onClick={() => remove(q.id)}>删除</button>
              )}
            </div>
            <p className="qa-content">{q.content}</p>
            <div className="qa-actions">
              <button className="btn-ghost" onClick={() => setOpenReplies({ ...openReplies, [q.id]: !(openReplies[q.id] ?? true) })}>
                ✉ {q.replies.length} 条回复
              </button>
              <button className="btn-ghost" onClick={() => openModal('reply', q)}>写回复</button>
            </div>
            {(openReplies[q.id] ?? true) && q.replies.length > 0 && (
              <div className="qa-replies">
                {q.replies.map((r) => (
                  <div key={r.id} className="qa-reply">
                    <span className={`avatar small ${r.author_role}`}>{r.author_name[0]}</span>
                    <div>
                      <span className="qa-reply-author">{r.author_name}
                        {r.author_role === 'teacher' && <span className="role-tag">老师</span>}
                      </span>
                      <p>{r.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
        {questions.length === 0 && <p className="empty-note">还没有人提问，来发第一条吧。</p>}
      </div>

      {modal && (
        <Modal title={modal.kind === 'question' ? '发布提问 / 需求' : `回复 · ${modal.question.author_name} 的提问`} onClose={() => setModal(null)}>
          {modal.kind === 'reply' && <p className="modal-quote">{modal.question.content}</p>}
          <label className="field">
            <span>{modal.kind === 'question' ? '内容' : '你的回复'}</span>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5}
              placeholder={modal.kind === 'question' ? '提出你的问题 / 需求…' : '写下你的回复…'} autoFocus />
          </label>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn-primary" onClick={submit}>{modal.kind === 'question' ? '发布' : '回复'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
