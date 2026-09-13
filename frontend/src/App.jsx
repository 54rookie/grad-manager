import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth'
import Login from './pages/Login'
import Layout from './pages/Layout'
import Thesis from './pages/Thesis'
import Progress from './pages/Progress'
import Reports from './pages/Reports'
import QA from './pages/QA'
import Announcements from './pages/Announcements'
import Links from './pages/Links'
import Accounts from './pages/Accounts'
import Messages from './pages/Messages'

// 学生进入系统后的默认首页
const STUDENT_HOME = '/thesis'
// 老师进入系统后的默认首页
const TEACHER_HOME = '/progress'

function Guard({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="page-loading">翻开手账…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

// 仅老师可见的页面：学生直接访问会被送回自己的首页
function TeacherOnly({ children }) {
  const { user } = useAuth()
  if (user.role !== 'teacher') return <Navigate to={STUDENT_HOME} replace />
  return children
}

// 根路径按角色分流
function Home() {
  const { user } = useAuth()
  return <Navigate to={user.role === 'teacher' ? TEACHER_HOME : STUDENT_HOME} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Guard><Layout /></Guard>}>
        <Route index element={<Home />} />
        <Route path="thesis" element={<Thesis />} />
        <Route path="progress" element={<Progress />} />
        <Route path="reports" element={<Reports />} />
        <Route path="qa" element={<QA />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="links" element={<Links />} />
        <Route path="messages" element={<Messages />} />
        <Route path="accounts" element={<TeacherOnly><Accounts /></TeacherOnly>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
