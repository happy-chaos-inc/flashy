-- Migration script to update existing Garden database
-- Run this if you already have data in your database

-- 1. Update rooms table
ALTER TABLE rooms
  ALTER COLUMN id TYPE VARCHAR(16),
  ADD COLUMN IF NOT EXISTS date_start BIGINT,
  ADD COLUMN IF NOT EXISTS date_end BIGINT;

-- 2. Update room_users table
ALTER TABLE room_users
  ALTER COLUMN room_id TYPE VARCHAR(16),
  ALTER COLUMN password_hash DROP NOT NULL;

-- 3. Update sketches table
ALTER TABLE sketches
  ALTER COLUMN room_id TYPE VARCHAR(16);

-- Note: Existing rooms will keep their 8-character IDs
-- New rooms will use 16-character IDs for better security
