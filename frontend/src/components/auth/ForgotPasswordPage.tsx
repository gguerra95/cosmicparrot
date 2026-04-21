import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../../api/auth'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Forgot Password</h2>
        {sent ? (
          <p>If an account exists for that email, you will receive a reset link shortly.</p>
        ) : (
          <form onSubmit={submit}>
            <label>Enter your email to reset password</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <button type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
          </form>
        )}
        <p><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  )
}
