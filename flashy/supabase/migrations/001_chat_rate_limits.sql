-- Chat rate limiting table
-- Tracks daily usage per room for free tier limits

CREATE TABLE IF NOT EXISTS chat_usage (
  room_id TEXT PRIMARY KEY,
  message_count INTEGER DEFAULT 0,
  reset_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_chat_usage_reset_date ON chat_usage(reset_date);                                                    

-- Function to check and increment usage
-- Returns: { allowed: boolean, remaining: number, limit: number }
CREATE OR REPLACE FUNCTION check_chat_rate_limit(
  p_room_id TEXT,
  p_daily_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
  v_remaining INTEGER;
  v_allowed BOOLEAN;
BEGIN
  -- Insert or update usage record
  INSERT INTO chat_usage (room_id, message_count, reset_date)
  VALUES (p_room_id, 1, CURRENT_DATE)
  ON CONFLICT (room_id) DO UPDATE
  SET
    message_count = CASE
      WHEN chat_usage.reset_date < CURRENT_DATE THEN 1  -- Reset if new day
      ELSE chat_usage.message_count + 1
    END,
    reset_date = CURRENT_DATE,
    updated_at = NOW()
  RETURNING message_count INTO v_count;

  -- Calculate remaining and allowed
  v_remaining := GREATEST(0, p_daily_limit - v_count);
  v_allowed := v_count <= p_daily_limit;

  -- If not allowed, decrement the count we just added
  IF NOT v_allowed THEN
    UPDATE chat_usage
    SET message_count = message_count - 1
    WHERE room_id = p_room_id;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'remaining', v_remaining,
    'limit', p_daily_limit,
    'used', LEAST(v_count, p_daily_limit)
  );
END;
$$;

-- Function to get current usage without incrementing
CREATE OR REPLACE FUNCTION get_chat_usage(p_room_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
  v_reset_date DATE;
BEGIN
  SELECT message_count, reset_date
  INTO v_count, v_reset_date
  FROM chat_usage
  WHERE room_id = p_room_id;

  -- Return 0 if no record or if it's a new day
  IF v_count IS NULL OR v_reset_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('used', 0, 'limit', 500, 'remaining', 500);
  END IF;

  RETURN jsonb_build_object(
    'used', v_count,
    'limit', 500,
    'remaining', GREATEST(0, 500 - v_count)
  );
END;
$$;

-- Cleanup old records (run periodically via cron or manually)
CREATE OR REPLACE FUNCTION cleanup_old_chat_usage()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM chat_usage
  WHERE reset_date < CURRENT_DATE - INTERVAL '7 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Enable RLS
ALTER TABLE chat_usage ENABLE ROW LEVEL SECURITY;

-- Allow edge functions to access (via service role)
CREATE POLICY "Service role can manage chat_usage" ON chat_usage
  FOR ALL
  USING (true)
  WITH CHECK (true);
