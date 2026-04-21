import type { PresenceStatus } from '../../types'

const colors: Record<PresenceStatus, string> = {
  online: '#22c55e',
  afk: '#eab308',
  offline: '#6b7280',
}

const labels: Record<PresenceStatus, string> = {
  online: 'Online',
  afk: 'AFK',
  offline: 'Offline',
}

export function PresenceDot({ status }: { status: PresenceStatus }) {
  return (
    <span
      className="presence-dot"
      title={labels[status]}
      style={{ background: colors[status] }}
    />
  )
}
