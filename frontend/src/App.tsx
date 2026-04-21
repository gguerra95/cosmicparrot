import { useEffect } from 'react'
import axios from 'axios'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './components/auth/LoginPage'
import { RegisterPage } from './components/auth/RegisterPage'
import { ForgotPasswordPage } from './components/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './components/auth/ResetPasswordPage'
import { ChatView } from './components/chat/ChatView'
import { DmView } from './components/chat/DmView'
import { RoomCatalogPage } from './components/settings/RoomCatalogPage'
import { PrivateRoomsPage } from './components/settings/PrivateRoomsPage'
import { ContactsPage } from './components/settings/ContactsPage'
import { SessionsPage } from './components/settings/SessionsPage'
import { SettingsPage } from './components/settings/SettingsPage'

function parseJwtPayload(token: string): { sub: string; username: string } | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    return { sub: payload.sub, username: payload.username }
  } catch {
    return null
  }
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, bootstrapped } = useAuthStore()
  if (!bootstrapped) return null
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function App() {
  const { setAuth, setBootstrapped, bootstrapped } = useAuthStore()

  useEffect(() => {
    axios.post('/api/v1/auth/refresh', {}, { withCredentials: true })
      .then(({ data }) => {
        const decoded = parseJwtPayload(data.accessToken)
        if (decoded) {
          setAuth({ id: decoded.sub, username: decoded.username }, data.accessToken)
        }
      })
      .catch(() => {})
      .finally(() => setBootstrapped())
  }, [])

  if (!bootstrapped) return null

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route path="/" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Navigate to="/rooms" replace />} />
        <Route path="rooms" element={<RoomCatalogPage />} />
        <Route path="private-rooms" element={<PrivateRoomsPage />} />
        <Route path="room/:roomId" element={<ChatView />} />
        <Route path="dm/:channelId" element={<DmView />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
