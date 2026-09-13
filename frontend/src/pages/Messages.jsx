import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { useMessages } from '../messages'
import { usePageBanner } from '../banner'

/**
 * 消息中心：老师发来的定向消息（催办 / 提醒）。
 *
 * 学生看到的是「收到的」，老师看到的是「我发出的」——后端按角色决定，
 * 这里不区分展示逻辑，只在标题和空状态上换个说法。
 */

const TOPIC_STYLE = {
  论文管理: { cls: 't-thesis', ic: '📄' },
  周报: { cls: 't-report', ic: '🗓' },
  问答点评: { cls: 't-qa', ic: '💬' },
}

function MessagesBannerBridge() {
  usePageBanner({
    title: <span>研途的<span className="hl">信箱</span>与回音</span>,
    subtitle: '每一条回信都带着温度，记得及时查收',
  })
  return null
}

const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }).slice(5, 16) : '—')

export default function Messages() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { items, unread, markAllRead, load } = useMessages()
  const isTeacher = user.role === 'teacher'

  /* 进来就把收到的消息标记为已读，Banner 上的角标随之清空。
     ⚠ 不能写成 `if (unread > 0) ...` + 空依赖：挂载那一刻消息还没拉回来、
     unread 恒为 0，条件永远不成立（之前就是这么漏的）。
     markAllRead 是幂等的，没有未读时后端返回 marked: 0。 */
  useEffect(() => {
    if (isTeacher) return
    markAllRead().catch(() => {})
  }, [isTeacher, markAllRead])

  return (
    <div className="pg-msg">
      <div className="page">
        <MessagesBannerBridge />

        <div className="feed-head">
          <span className="fh-title">
            {isTeacher ? `我发出的消息 · 共 ${items.length} 条` : `收到的消息 · 共 ${items.length} 条`}
          </span>
          <button className="btn-primary" onClick={() => navigate(isTeacher ? '/progress' : '/thesis')}>
            {isTeacher ? '去进度看板催办' : '去看我的论文'}
          </button>
        </div>

        <div className="msg-board">
          {items.length === 0 && (
            <div className="msg-empty">
              <span className="stamp">空</span>
              {isTeacher ? '还没有发出过消息，去进度看板点「一键催办」试试。' : '还没有收到消息，安心写论文吧 ✎'}
            </div>
          )}

          {items.map((m) => {
            const ts = TOPIC_STYLE[m.topic] || TOPIC_STYLE['论文管理']
            return (
              <article key={m.id} className={`letter ${ts.cls}${m.read_at ? '' : ' unread'}`}>
                <span className="tape" />
                <div className="letter-head">
                  <span className="l-topic">{ts.ic} {m.topic}</span>
                  <span className="l-time">{fmt(m.created_at)}</span>
                </div>
                <p className="l-body">{m.content}</p>
                <div className="letter-foot">
                  <span className="l-who">
                    {isTeacher ? `发给 ${m.to_name}` : `来自 ${m.from_name}`}
                  </span>
                  {!m.read_at && !isTeacher && <span className="l-new">未读</span>}
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
