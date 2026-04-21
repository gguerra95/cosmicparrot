import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/authStore'
import { useWsStore } from '../../stores/wsStore'

export function SettingsPage() {
  return (
    <div className="page settings-page">
      <h2>Settings</h2>
      <ChangePasswordForm />
      <AccountDangerZone />
    </div>
  )
}

function ChangePasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== confirm) { setError('Passwords do not match'); return }
    setError('')
    setLoading(true)
    try {
      await authApi.changePassword(current, next)
      setSuccess(true)
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      <h3>Change Password</h3>
      {error && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">Password changed!</div>}
      <form onSubmit={submit}>
        <label>Current password</label>
        <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required />
        <label>New password</label>
        <input type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={8} />
        <label>Confirm new password</label>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
        <button type="submit" disabled={loading}>Change password</button>
      </form>
    </section>
  )
}

function AccountDangerZone() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { clearAuth } = useAuthStore()
  const { disconnect } = useWsStore()
  const navigate = useNavigate()

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault()
    if (!confirm('Delete your account? This cannot be undone.')) return
    setError('')
    setLoading(true)
    try {
      await authApi.deleteAccount(password)
      disconnect()
      clearAuth()
      navigate('/login')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="danger-zone">
      <h3>Delete Account</h3>
      <p>This will permanently delete your account and all rooms you own.</p>
      {error && <div className="error-msg">{error}</div>}
      <form onSubmit={deleteAccount}>
        <input type="password" placeholder="Enter password to confirm" value={password}
          onChange={e => setPassword(e.target.value)} required />
        <button type="submit" className="btn-danger" disabled={loading}>
          {loading ? 'Deleting…' : 'Delete account'}
        </button>
      </form>
    </section>
  )
}
