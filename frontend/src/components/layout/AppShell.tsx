import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useWsStore } from '../../stores/wsStore'
import { useIdleDetector } from '../../hooks/useIdleDetector'
import { Sidebar } from '../sidebar/Sidebar'
import { TopBar } from './TopBar'
import { Outlet } from 'react-router-dom'

export function AppShell() {
  const { user, accessToken } = useAuthStore()
  const { connect, disconnect } = useWsStore()

  useEffect(() => {
    if (accessToken) connect(accessToken)
    return () => disconnect()
  }, [accessToken, connect, disconnect])

  useIdleDetector()

  if (!user) return null

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <main className="main-content">
          <Outlet />
        </main>
        <Sidebar />
      </div>
    </div>
  )
}
