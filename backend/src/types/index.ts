export interface User {
  id: string
  email: string
  username: string
  avatar_path: string | null
  created_at: Date
  deleted_at: Date | null
}

export interface Session {
  id: string
  user_id: string
  user_agent: string | null
  ip_address: string | null
  created_at: Date
  last_used_at: Date
  expires_at: Date
}

export interface Room {
  id: string
  name: string
  description: string | null
  is_private: boolean
  owner_id: string
  created_at: Date
  deleted_at: Date | null
}

export interface RoomMember {
  room_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: Date
  last_read_message_id: string | null
}

export interface Message {
  id: string
  room_id: string
  author_id: string
  content: string | null
  reply_to_id: string | null
  edited_at: Date | null
  deleted_at: Date | null
  created_at: Date
}

export interface Attachment {
  id: string
  message_id: string
  uploader_id: string
  original_filename: string
  stored_path: string
  mime_type: string
  file_size_bytes: number
  is_image: boolean
  comment: string | null
  created_at: Date
}

export interface Friendship {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: Date
  updated_at: Date
}

export type PresenceStatus = 'online' | 'afk' | 'offline'

export interface JwtAccessPayload {
  sub: string       // user id
  sid: string       // session id
  username: string
}

// Fastify augmentation
declare module 'fastify' {
  interface FastifyRequest {
    userId: string
    sessionId: string
    username: string
  }
}
