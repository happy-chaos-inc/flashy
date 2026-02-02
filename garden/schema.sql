-- Garden Database Schema

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id VARCHAR(16) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL,
    last_activity_at BIGINT NOT NULL,
    date_start BIGINT,
    date_end BIGINT
);

-- Room users (registered usernames and passwords)
CREATE TABLE IF NOT EXISTS room_users (
    room_id VARCHAR(16) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    username VARCHAR(255) NOT NULL,
    password_hash VARCHAR(64),
    PRIMARY KEY (room_id, username)
);

-- Sketches (drawings)
CREATE TABLE IF NOT EXISTS sketches (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(16) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    svg_path TEXT NOT NULL,
    position_x FLOAT NOT NULL,
    position_y FLOAT NOT NULL,
    created_at BIGINT NOT NULL
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sketches_room_id ON sketches(room_id);
CREATE INDEX IF NOT EXISTS idx_room_users_room_id ON room_users(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_last_activity ON rooms(last_activity_at);
