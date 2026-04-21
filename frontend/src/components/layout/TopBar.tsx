import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/authStore'
import { useWsStore } from '../../stores/wsStore'

export function TopBar() {
  const { user, clearAuth } = useAuthStore()
  const disconnect = useWsStore((s) => s.disconnect)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleLogout() {
    try { await authApi.logout() } catch {}
    disconnect()
    clearAuth()
    navigate('/login')
  }

  return (
    <header className="topbar">
      <div className="topbar-logo">
        <Link to="/">🦜 CosmicParrot</Link>
      </div>
      <nav className="topbar-nav">
        <Link to="/rooms">Public Rooms</Link>
        <Link to="/private-rooms">Private Rooms</Link>
        <Link to="/contacts">Contacts</Link>
        <Link to="/sessions">Sessions</Link>
      </nav>
      <div className="topbar-user" onClick={() => setMenuOpen(o => !o)}>
        <span>{user?.username} ▼</span>
        {menuOpen && (
          <div className="topbar-dropdown">
            <Link to="/settings" onClick={() => setMenuOpen(false)}>Profile</Link>
            <button onClick={handleLogout}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  )
}
