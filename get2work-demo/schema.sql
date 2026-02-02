-- Get2Work Database Schema

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id VARCHAR(16) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL,
    last_activity_at BIGINT NOT NULL
);

-- Room users (registered usernames and passwords)
CREATE TABLE IF NOT EXISTS room_users (
    room_id VARCHAR(16) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    username VARCHAR(255) NOT NULL,
    password_hash VARCHAR(64),
    color VARCHAR(7),
    PRIMARY KEY (room_id, username)
);

-- TODO items
CREATE TABLE IF NOT EXISTS todos (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(16) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at BIGINT NOT NULL
);

-- TODO checks (tracks which user checked which TODO)
CREATE TABLE IF NOT EXISTS todo_checks (
    todo_id VARCHAR(36) NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    room_id VARCHAR(16) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    username VARCHAR(255) NOT NULL,
    checked_at BIGINT NOT NULL,
    PRIMARY KEY (todo_id, username)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_todos_room_id ON todos(room_id);
CREATE INDEX IF NOT EXISTS idx_todo_checks_todo_id ON todo_checks(todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_checks_room_id ON todo_checks(room_id);
CREATE INDEX IF NOT EXISTS idx_room_users_room_id ON room_users(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_last_activity ON rooms(last_activity_at);
