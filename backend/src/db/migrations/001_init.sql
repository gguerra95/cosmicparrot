-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  avatar_path   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));

-- ─────────────────────────────────────────
-- Sessions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash  TEXT NOT NULL,
  user_agent          TEXT,
  ip_address          INET,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);

-- ─────────────────────────────────────────
-- Password Reset Tokens
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens (user_id);

-- ─────────────────────────────────────────
-- Rooms
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  is_private  BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id    UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rooms_public ON rooms (created_at DESC) WHERE is_private = FALSE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_name ON rooms (lower(name)) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────
-- Room Members
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_members (
  room_id                UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                   TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_message_id   UUID,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rm_user_id ON room_members (user_id);

-- ─────────────────────────────────────────
-- Room Bans
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_bans (
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by   UUID NOT NULL REFERENCES users(id),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- ─────────────────────────────────────────
-- Room Invitations
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  invited_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at     TIMESTAMPTZ,
  declined_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, invited_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ri_invited_user ON room_invitations (invited_user_id) WHERE accepted_at IS NULL AND declined_at IS NULL;

-- ─────────────────────────────────────────
-- Messages
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id),
  content     TEXT CHECK (octet_length(content) <= 3072),
  reply_to_id UUID REFERENCES messages(id),
  edited_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages (author_id);

-- ─────────────────────────────────────────
-- Attachments
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id       UUID NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL,
  stored_path       TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size_bytes   BIGINT NOT NULL,
  is_image          BOOLEAN NOT NULL DEFAULT FALSE,
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_att_message ON attachments (message_id);

-- ─────────────────────────────────────────
-- Friendships
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  message       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id != addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friendships_pair ON friendships (
  LEAST(requester_id, addressee_id),
  GREATEST(requester_id, addressee_id)
) WHERE status = 'accepted';

-- ─────────────────────────────────────────
-- User-to-User Bans
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_bans (
  banner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (banner_id, banned_id),
  CHECK (banner_id != banned_id)
);

CREATE INDEX IF NOT EXISTS idx_user_bans_banned ON user_bans (banned_id);

-- ─────────────────────────────────────────
-- Direct Message Channels
-- ─────────────────────────────────────────
-- DMs are stored as virtual rooms; messages use the messages table with room_id = dm channel id.
-- The rooms table is NOT used for DMs. We keep a separate table to avoid polluting the room catalog.
CREATE TABLE IF NOT EXISTS dm_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frozen_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- enforce user_a < user_b lexicographically to prevent duplicate pairs
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);

CREATE INDEX IF NOT EXISTS idx_dm_user_a ON dm_channels (user_a);
CREATE INDEX IF NOT EXISTS idx_dm_user_b ON dm_channels (user_b);

-- DM messages use a separate table to avoid conflicts with room authorization checks
CREATE TABLE IF NOT EXISTS dm_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id),
  content     TEXT CHECK (octet_length(content) <= 3072),
  reply_to_id UUID REFERENCES dm_messages(id),
  edited_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_channel ON dm_messages (channel_id, created_at DESC);

-- DM attachments
CREATE TABLE IF NOT EXISTS dm_attachments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
  uploader_id       UUID NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL,
  stored_path       TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size_bytes   BIGINT NOT NULL,
  is_image          BOOLEAN NOT NULL DEFAULT FALSE,
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Unread Counters
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_unread (
  room_id   UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  count     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS dm_unread (
  channel_id  UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  count       INT NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);
