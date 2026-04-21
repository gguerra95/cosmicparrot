import { useQuery } from '@tanstack/react-query'
import { roomsApi } from '../../api/rooms'
import { usePresenceStore } from '../../stores/presenceStore'
import { PresenceDot } from '../sidebar/PresenceDot'
import type { RoomMember } from '../../types'

interface Props {
  roomId: string
  myRole?: string
  onUserClick: (userId: string) => void
}

export function MembersPanel({ roomId, myRole, onUserClick }: Props) {
  const { data: members = [] } = useQuery<RoomMember[]>({
    queryKey: ['room-members', roomId],
    queryFn: () => roomsApi.members(roomId),
    refetchInterval: 30_000,
  })

  return (
    <aside className="members-panel">
      <div className="members-header">
        <span>Members ({members.length})</span>
      </div>
      <div className="members-list">
        {members.map(m => <MemberRow key={m.id} member={m} onClick={() => onUserClick(m.id)} />)}
      </div>
    </aside>
  )
}

function MemberRow({ member, onClick }: { member: RoomMember; onClick: () => void }) {
  const status = usePresenceStore(s => s.getStatus(member.id))
  return (
    <div className="member-row member-row--clickable" onClick={onClick}>
      <PresenceDot status={status} />
      <span className="member-username">{member.username}</span>
      {member.role !== 'member' && (
        <span className="member-role">{member.role}</span>
      )}
    </div>
  )
}
