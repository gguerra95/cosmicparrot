export type PresenceStatus = 'online' | 'afk' | 'offline'

export interface User {
  id: string
  username: string
  avatar_path: string | null
}

export interface Room {
  id: string
  name: string
  description: string | null
  is_private: boolean
  owner_id: string
  member_count?: number
  my_role?: 'owner' | 'admin' | 'member'
  is_banned?: boolean
}

export interface RoomMember extends User {
  role: 'owner' | 'admin' | 'member'
  joined_at: string
}

export interface Message {
  id: string
  room_id?: string
  channel_id?: string
  author_id: string
  author_username: string
  author_avatar: string | null
  content: string | null
  reply_to_id: string | null
  reply_content?: string | null
  reply_author?: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  attachments?: Attachment[]
}

export interface Attachment {
  id: string
  original_filename: string
  mime_type: string
  file_size_bytes: number
  is_image: boolean
  comment: string | null
}

export interface Friendship {
  id: string
  friendship_id: string
  username: string
  avatar_path: string | null
  direction: 'sent' | 'received'
  status: 'pending' | 'accepted'
  message?: string | null
}

export interface DmChannel {
  id: string
  partner_id: string
  partner_username: string
  partner_avatar: string | null
  frozen_at: string | null
  unread_count: number
  last_message_content?: string | null
  last_message_at?: string | null
}
