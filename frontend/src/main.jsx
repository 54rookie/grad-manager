import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth'
import { ToastProvider } from './toast'
import { MessagesProvider } from './messages'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ToastProvider>
      <AuthProvider>
        {/* 消息中心要读 user 才知道拉谁的收件箱，所以放在 AuthProvider 里面 */}
        <MessagesProvider>
          <App />
        </MessagesProvider>
      </AuthProvider>
    </ToastProvider>
  </BrowserRouter>
)
