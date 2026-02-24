-- Error logs table for remote monitoring
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Error details
  message TEXT NOT NULL,
  stack TEXT,
  error_type TEXT, -- 'uncaught', 'unhandledrejection', 'manual'

  -- Context
  room_id TEXT,
  user_agent TEXT,
  url TEXT,

  -- Session info
  session_id TEXT,
  user_name TEXT
);

-- Index for querying recent errors
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_room_id ON error_logs(room_id);

-- RLS: Allow inserts from anonymous users (for error reporting)
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous inserts" ON error_logs
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Only authenticated users can read (admin access)
CREATE POLICY "Allow authenticated reads" ON error_logs
  FOR SELECT TO authenticated
  USING (true);
