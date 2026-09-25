import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useToast } from '../toast'
import { Modal } from '../components'
import { usePageBanner } from '../banner'

function AccountsBannerBridge() {
  usePageBanner({
    title: <span>师门的<span className="hl">花名册</span>管理</span>,
    subtitle: '记录每位成员的加入，传承师门温暖',
  })
  return null
}

const EMPTY_FORM = { username: '', password: '', name: '', role: 'student', student_no: '', grade_id: '' }

export default function Accounts() {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [grades, setGrades] = useState([])
  const [modal, setModal] = useState(null) // {mode:'add'} | {mode:'edit', user}
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteStep, setDeleteStep] = useState(1)
  const [impactAcknowledged, setImpactAcknowledged] = useState(false)
  const [deleteUsername, setDeleteUsername] = useState('')
  const [deleting, setDeleting] = useState(false)
  const deleteRequestRef = useRef(false)

  const load = async () => {
    try {
      const [u, g] = await Promise.all([api.get('/users'), api.get('/grades')])
      setUsers(u)
      setGrades(g)
    } catch (e) { toast(e.message, 'error') }
  }
  useEffect(() => { load() }, [])

  const gradeName = (gid) => grades.find((g) => g.id === gid)?.name || '未分组'

  const openAdd = () => { setForm(EMPTY_FORM); setModal({ mode: 'add' }) }
  const openEdit = (u) => {
    setForm({ username: u.username, password: '', name: u.name, role: u.role, student_no: u.student_no || '', grade_id: u.grade_id || '' })
    setModal({ mode: 'edit', user: u })
  }

  const save = async () => {
    try {
      if (modal.mode === 'add') {
        if (!form.username.trim() || !form.password || !form.name.trim()) return toast('用户名、密码、姓名必填', 'error')
        await api.post('/users', {
          username: form.username.trim(),
          password: form.password,
          name: form.name.trim(),
          role: form.role,
          student_no: form.student_no.trim() || null,
          grade_id: form.grade_id ? Number(form.grade_id) : null,
        })
        toast('账号已创建', 'success')
      } else {
        const payload = {
          name: form.name.trim(),
          student_no: form.student_no.trim() || null,
          grade_id: form.grade_id ? Number(form.grade_id) : null,
        }
        if (form.password) payload.password = form.password
        await api.put(`/users/${modal.user.id}`, payload)
        toast('账号已更新', 'success')
      }
      setModal(null)
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const remove = (u) => {
    if (u.role === 'teacher' && users.filter((item) => item.role === 'teacher').length === 1) {
      toast('不能删除最后一个老师账号', 'error')
      return
    }
    setDeleteTarget(u)
    setDeleteStep(1)
    setImpactAcknowledged(false)
    setDeleteUsername('')
  }

  const confirmDelete = async () => {
    if (deleteStep === 1) { setDeleteStep(2); return }
    if (deleteStep === 2) { if (impactAcknowledged) setDeleteStep(3); return }
    if (!deleteTarget || deleteRequestRef.current || deleteUsername !== deleteTarget.username) return
    deleteRequestRef.current = true
    setDeleting(true)
    try {
      await api.del(`/users/${deleteTarget.id}`)
      setDeleteTarget(null)
      toast('账号已删除', 'success')
      await load()
    } catch (e) { toast(e.message, 'error') } finally {
      deleteRequestRef.current = false
      setDeleting(false)
    }
  }

  return (
    <div className="page">
      <AccountsBannerBridge />

      <div className="panel">
        {/* 添加账号：嵌进表格卡片的顶部栏 */}
        <div className="panel-head">
          <span className="ph-title">全部账号 · 共 {users.length} 人</span>
          <button className="btn-primary" onClick={openAdd}>+ 添加账号</button>
        </div>
        <table className="report-table">
          <thead>
            <tr><th>姓名</th><th>用户名</th><th>角色</th><th>学号</th><th>年级</th><th>操作</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.username}</td>
                <td>{u.role === 'teacher' ? <span className="role-tag">老师</span> : '学生'}</td>
                <td>{u.student_no || '—'}</td>
                <td>{gradeName(u.grade_id)}</td>
                <td className="grade-actions">
                  <button className="btn-ghost" onClick={() => openEdit(u)}>编辑</button>
                  <button className="btn-ghost danger" onClick={() => remove(u)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal.mode === 'add' ? '添加账号' : `编辑账号 · ${modal.user.name}`} onClose={() => setModal(null)}>
          <div className="field-row">
            <label className="field">
              <span>用户名{modal.mode === 'edit' && '（不可改）'}</span>
              <input value={form.username} disabled={modal.mode === 'edit'}
                onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="登录用" />
            </label>
            <label className="field">
              <span>{modal.mode === 'add' ? '密码' : '重置密码（留空不改）'}</span>
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="如 123456" />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>姓名</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span>角色</span>
              <select value={form.role} disabled={modal.mode === 'edit'}
                onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="student">学生</option>
                <option value="teacher">老师</option>
              </select>
            </label>
          </div>
          {form.role === 'student' && (
            <div className="field-row">
              <label className="field">
                <span>学号</span>
                <input value={form.student_no} onChange={(e) => setForm({ ...form, student_no: e.target.value })} />
              </label>
              <label className="field">
                <span>年级</span>
                <select value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })}>
                  <option value="">未分组</option>
                  {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn-ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn-primary" onClick={save}>保存</button>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <div className="modal-mask account-delete-mask" onClick={() => { if (!deleting) setDeleteTarget(null) }}>
          <section key={deleteStep} className={`modal account-delete-dialog account-delete-step-${deleteStep}`}
            role="alertdialog" aria-modal="true" aria-labelledby="account-delete-title"
            onClick={(e) => e.stopPropagation()}>
            <div className="account-delete-progress" aria-label={`删除确认第 ${deleteStep} 步，共 3 步`}>
              {[1, 2, 3].map((step) => <span key={step} className={step === deleteStep ? 'current' : step < deleteStep ? 'done' : ''}>{step}</span>)}
            </div>

            {deleteStep === 1 && <>
              <div className="account-delete-kicker">第一步 · 核对账号</div>
              <h3 id="account-delete-title">请确认要删除的成员</h3>
              <div className="account-delete-identity">
                <strong>{deleteTarget.name}</strong>
                <span>{deleteTarget.role === 'teacher' ? '老师' : '学生'} · 用户名 {deleteTarget.username}</span>
                {deleteTarget.student_no && <span>学号 {deleteTarget.student_no}</span>}
              </div>
              <p>请先核对姓名和用户名，确保选中的是正确账号。此时不会发送删除请求。</p>
            </>}

            {deleteStep === 2 && <>
              <div className="account-delete-kicker">第二步 · 核对影响</div>
              <h3 id="account-delete-title">这些资料会一起删除</h3>
              <ul className="account-delete-impact">
                <li>论文项目、往返记录与上传的文件</li>
                <li>周报、正文图片、附件与点评</li>
                <li>问答、回复和收发消息</li>
                {deleteTarget.role === 'teacher' && <li>发布的公告、公告附件和链接</li>}
              </ul>
              <label className="account-delete-ack">
                <input type="checkbox" checked={impactAcknowledged}
                  onChange={(e) => setImpactAcknowledged(e.target.checked)} />
                <span>我明白关联记录和附件也会被永久删除</span>
              </label>
              <p className="account-delete-wait">进入下一步仍不会删除数据。</p>
            </>}

            {deleteStep === 3 && <>
              <div className="account-delete-kicker">第三步 · 高危操作</div>
              <h3 id="account-delete-title">删除后无法恢复</h3>
              <p>即将永久删除 <strong>{deleteTarget.name}</strong> 及上一步列出的关联资料。</p>
              <label className="account-delete-type">
                <span>请输入完整用户名 <strong>{deleteTarget.username}</strong> 以确认</span>
                <input autoFocus value={deleteUsername} autoComplete="off"
                  onChange={(e) => setDeleteUsername(e.target.value)}
                  placeholder="输入用户名后才能删除" />
              </label>
            </>}

            <div className="modal-actions">
              <button type="button" className="btn-ghost" disabled={deleting}
                onClick={() => setDeleteTarget(null)}>取消</button>
              {deleteStep > 1 && <button type="button" className="btn-ghost" disabled={deleting}
                onClick={() => setDeleteStep(deleteStep === 3 ? 2 : 1)}>上一步</button>}
              <button type="button" className="account-delete-next" disabled={deleting || (deleteStep === 2 && !impactAcknowledged) || (deleteStep === 3 && deleteUsername !== deleteTarget.username)}
                onClick={confirmDelete}>
                {deleting ? '正在删除…' : deleteStep === 1 ? '账号无误，查看影响' : deleteStep === 2 ? '我已了解，进入最终确认' : '永久删除账号和资料'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
