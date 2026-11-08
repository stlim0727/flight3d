-- Flight3d Multiplayer Room Directory D1 Schema
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  lease_generation INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  airport TEXT NOT NULL,
  aircraft TEXT NOT NULL,
  scenario TEXT NOT NULL,
  current_players INTEGER NOT NULL DEFAULT 1,
  max_players INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'waiting',
  protocol_major INTEGER NOT NULL,
  flight_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_expires_at ON rooms (expires_at);
CREATE INDEX IF NOT EXISTS idx_rooms_filter ON rooms (protocol_major, flight_revision, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_code ON rooms (room_code);
