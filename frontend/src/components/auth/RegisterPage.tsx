import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/authStore'

export function RegisterPage() {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    setError('')
    setLoading(true)
    try {
      const data = await authApi.register(email, username, password)
      setAuth(data.user, data.accessToken)
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Create Account</h2>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <label>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} required
            pattern="[a-zA-Z0-9_\-]{3,32}" title="3-32 characters: letters, numbers, _ or -" />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          <label>Confirm password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          <button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</button>
        </form>
        <p>Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  )
}
