import { useEffect, useState } from 'react'
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

  const remove = async (u) => {
    if (!window.confirm(`确定删除账号「${u.name}（${u.username}）」？`)) return
    try {
      await api.del(`/users/${u.id}`)
      toast('账号已删除', 'success')
      load()
    } catch (e) { toast(e.message, 'error') }
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
    </div>
  )
}
