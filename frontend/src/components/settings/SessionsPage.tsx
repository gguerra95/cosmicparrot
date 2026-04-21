import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/authStore'
import { format } from 'date-fns'

interface Session {
  id: string
  user_agent: string | null
  ip_address: string | null
  created_at: string
  last_used_at: string
  is_current: boolean
}

export function SessionsPage() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => authApi.sessions(),
  })

  async function revoke(id: string) {
    await authApi.revokeSession(id)
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  return (
    <div className="page sessions-page">
      <h2>Active Sessions</h2>
      {isLoading ? <p>Loading…</p> : (
        <table className="sessions-table">
          <thead>
            <tr><th>Device</th><th>IP</th><th>Last used</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {sessions.map((s: Session) => (
              <tr key={s.id} className={s.is_current ? 'current-session' : ''}>
                <td>
                  {s.user_agent ?? 'Unknown'}
                  {s.is_current && <span className="badge">This device</span>}
                </td>
                <td>{s.ip_address ?? '—'}</td>
                <td>{format(new Date(s.last_used_at), 'MMM d, yyyy HH:mm')}</td>
                <td>
                  {!s.is_current && (
                    <button onClick={() => revoke(s.id)}>Log out</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
