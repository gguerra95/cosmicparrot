import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { authApi } from '../../api/auth'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    setError('')
    setLoading(true)
    try {
      await authApi.resetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate('/login'), 2000)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Reset Password</h2>
        {done ? (
          <p>Password reset! Redirecting to login…</p>
        ) : (
          <>
            {error && <div className="error-msg">{error}</div>}
            <form onSubmit={submit}>
              <label>New password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
              <label>Confirm new password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
              <button type="submit" disabled={loading}>{loading ? 'Resetting…' : 'Reset password'}</button>
            </form>
          </>
        )}
        <p><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  )
}
