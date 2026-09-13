import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { Modal } from '../components'
import { usePageBanner } from '../banner'

function LinksBannerBridge() {
  usePageBanner({
    title: <span>研途常用的<span className="hl">百宝箱</span></span>,
    subtitle: '收集散落的工具与资源，助力科研提效',
  })
  return null
}

export default function Links() {
  const { user } = useAuth()
  const toast = useToast()
  const isTeacher = user.role === 'teacher'
  const [links, setLinks] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  const load = async () => {
    try {
      setLinks(await api.get('/links'))
    } catch (e) { toast(e.message, 'error') }
  }
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!title.trim() || !url.trim()) return toast('名称和地址都要填写', 'error')
    let u = url.trim()
    if (!/^https?:\/\//.test(u)) u = 'https://' + u
    try {
      await api.post('/links', { title: title.trim(), url: u })
      setModalOpen(false)
      toast('链接按钮已添加', 'success')
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const remove = async (id) => {
    if (!window.confirm('确定删除这个链接按钮？')) return
    try {
      await api.del(`/links/${id}`)
      toast('已删除', 'success')
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="page page-narrow">
      <LinksBannerBridge />

      <div className="feed-head">
        <span className="fh-title">全部链接 · 共 {links.length} 个</span>
        {isTeacher && (
          <button className="btn-primary" onClick={() => { setTitle(''); setUrl(''); setModalOpen(true) }}>
            ⚑ 添加链接按钮
          </button>
        )}
      </div>

      <div className="link-board">
        {links.map((l) => (
          <div key={l.id} className="link-item">
            <a className="link-btn" href={l.url} target="_blank" rel="noreferrer">
              <span className="link-btn-icon">⚑</span>{l.title}
            </a>
            {isTeacher && <button className="btn-ghost danger small" onClick={() => remove(l.id)}>×</button>}
          </div>
        ))}
        {links.length === 0 && <p className="empty-note">暂无链接。</p>}
      </div>

      {modalOpen && (
        <Modal title="添加链接按钮" onClose={() => setModalOpen(false)}>
          <label className="field">
            <span>按钮名称</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：知网" autoFocus />
          </label>
          <label className="field">
            <span>链接地址</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
              onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn-primary" onClick={add}>添加</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
