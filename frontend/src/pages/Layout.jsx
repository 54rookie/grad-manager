import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../toast'
import { BannerProvider } from '../banner'

export default function Layout() {
  const { user } = useAuth()
  const toast = useToast()

  // 修改密码弹窗（关闭时不渲染，避免依赖 CSS 隐藏）
  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setPwdOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openPwd = () => {
    setOldPwd('')
    setNewPwd('')
    setConfirmPwd('')
    setPwdOpen(true)
  }

  const savePwd = async () => {
    if (!oldPwd || !newPwd) return toast('请填写原密码与新密码', 'error')
    if (newPwd.length < 6) return toast('新密码至少 6 位', 'error')
    if (newPwd !== confirmPwd) return toast('两次输入的新密码不一致', 'error')
    setBusy(true)
    try {
      await api.post('/me/password', { old_password: oldPwd, new_password: newPwd })
      setPwdOpen(false)
      toast('密码修改成功，请牢记新密码 🔒', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="pg-shell">
      {/* 全局聚合 Banner（修仙者/导航/用户 + 页面三插槽）+ 内容区 */}
      <BannerProvider extraActions={
        <button className="dropdown-item" type="button" onClick={openPwd}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 3.5 a2.5 2.5 0 1 0 0 5 a2.5 2.5 0 0 0 0 -5 M5.5 8.5 L4 13 a1 1 0 0 0 1 1.2 h6 a1 1 0 0 0 1 -1.2 L10.5 8.5"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          修改密码
        </button>
      }>
        <div className="shell-body">
          <main className="shell-main">
            <Outlet />
          </main>
        </div>
      </BannerProvider>

      {/* 修改密码弹窗 */}
      {pwdOpen && (
        <div className="overlay open"
          onClick={(e) => { if (e.target === e.currentTarget) setPwdOpen(false) }}>
          <div className="pwd-card">
            <span className="tape" />
            <h3>修改登录密码</h3>
            <p className="pwd-sub">当前账号：{user.name}（{user.username}）</p>
            <div className="field">
              <label>原密码</label>
              <input type="password" value={oldPwd} autoComplete="current-password"
                onChange={(e) => setOldPwd(e.target.value)} placeholder="请输入当前密码" autoFocus />
            </div>
            <div className="field">
              <label>新密码</label>
              <input type="password" value={newPwd} autoComplete="new-password"
                onChange={(e) => setNewPwd(e.target.value)} placeholder="至少 6 位" />
            </div>
            <div className="field">
              <label>确认新密码</label>
              <input type="password" value={confirmPwd} autoComplete="new-password"
                onChange={(e) => setConfirmPwd(e.target.value)} placeholder="再输一次"
                onKeyDown={(e) => { if (e.key === 'Enter') savePwd() }} />
            </div>
            <div className="pwd-actions">
              <button className="btn-ghost" type="button" onClick={() => setPwdOpen(false)}>取消</button>
              <button className="btn-pin" type="button" disabled={busy} onClick={savePwd}>{busy ? '保存中…' : '确认修改'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
