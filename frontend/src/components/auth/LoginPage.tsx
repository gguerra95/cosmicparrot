import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/authStore'

export function LoginPage() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await authApi.login(identifier, password)
      setAuth(data.user, data.accessToken)
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Sign In</h2>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <label>Email or Username</label>
          <input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p><Link to="/forgot-password">Forgot password?</Link></p>
        <p>No account? <Link to="/register">Register</Link></p>
      </div>
    </div>
  )
}
