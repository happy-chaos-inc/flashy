-- Email notifications for room creation and sustained usage
-- Requires: pg_net extension (async HTTP from Postgres), Resend API key, notification email
-- Setup: See manual steps in the plan (supabase secrets, ALTER DATABASE settings)

-- 1. Enable pg_net for async HTTP calls from Postgres
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Notification log table for deduplication
CREATE TABLE IF NOT EXISTS notification_log (
  id BIGSERIAL PRIMARY KEY,
  document_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,  -- 'room_created' or 'sustained_usage'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_log_document_id ON notification_log(document_id);

-- RLS: only service role needs access
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage notification_log" ON notification_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. Replace upsert_document_rpc with notification-aware version
CREATE OR REPLACE FUNCTION upsert_document_rpc(
  p_id TEXT,
  p_title TEXT,
  p_owner_id TEXT,
  p_yjs_state_base64 TEXT,
  p_content_text TEXT,
  p_last_edited_by TEXT,
  p_min_version INTEGER DEFAULT 0,
  p_snapshot_every_n INTEGER DEFAULT 10,
  p_snapshot_every_seconds INTEGER DEFAULT 300
)
RETURNS JSON AS $$
DECLARE
  v_current_version INTEGER;
  v_new_version INTEGER;
  v_last_snapshot_time TIMESTAMP;
  v_save_count INTEGER;
  v_should_snapshot BOOLEAN := FALSE;
  v_success BOOLEAN := FALSE;
  v_doc_created_at TIMESTAMPTZ;
  v_supabase_url TEXT;
  v_service_role_key TEXT;
BEGIN
  -- Get current version and created_at from database
  SELECT version, created_at INTO v_current_version, v_doc_created_at
  FROM documents
  WHERE id = p_id;

  -- If document doesn't exist, current version is 0
  IF v_current_version IS NULL THEN
    v_current_version := 0;
  END IF;

  -- Check for version conflict (Rule 1: Server always wins)
  IF v_current_version > p_min_version THEN
    RETURN json_build_object(
      'success', FALSE,
      'server_version', v_current_version,
      'message', 'Conflict: server has newer version'
    );
  END IF;

  -- No conflict - proceed with update
  v_new_version := v_current_version + 1;

  -- Upsert the document
  INSERT INTO documents (id, title, owner_id, yjs_state, content_text, last_edited_by, version, updated_at)
  VALUES (p_id, p_title, p_owner_id, p_yjs_state_base64, p_content_text, p_last_edited_by, v_new_version, NOW())
  ON CONFLICT (id) DO UPDATE SET
    title = p_title,
    yjs_state = p_yjs_state_base64,
    content_text = p_content_text,
    last_edited_by = p_last_edited_by,
    version = v_new_version,
    updated_at = NOW();

  v_success := TRUE;

  -- === NOTIFICATION LOGIC ===
  -- Wrapped in exception handler so failures never block saves
  BEGIN
    v_supabase_url := current_setting('app.supabase_url', true);
    v_service_role_key := current_setting('app.supabase_service_role_key', true);

    IF v_supabase_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
      -- Notification 1: New room created (first save ever, v_new_version = 1)
      IF v_new_version = 1 THEN
        INSERT INTO notification_log (document_id, notification_type)
        VALUES (p_id, 'room_created')
        ON CONFLICT (document_id, notification_type) DO NOTHING;

        IF FOUND THEN
          PERFORM net.http_post(
            url := v_supabase_url || '/functions/v1/notify',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || v_service_role_key
            ),
            body := jsonb_build_object(
              'type', 'room_created',
              'document_id', p_id,
              'created_by', COALESCE(p_last_edited_by, 'anonymous')
            )
          );
        END IF;
      END IF;

      -- Notification 2: Sustained usage (10+ min since creation, not already notified)
      IF v_new_version > 1 AND v_doc_created_at IS NOT NULL
         AND NOW() - v_doc_created_at >= INTERVAL '10 minutes' THEN
        INSERT INTO notification_log (document_id, notification_type)
        VALUES (p_id, 'sustained_usage')
        ON CONFLICT (document_id, notification_type) DO NOTHING;

        IF FOUND THEN
          PERFORM net.http_post(
            url := v_supabase_url || '/functions/v1/notify',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || v_service_role_key
            ),
            body := jsonb_build_object(
              'type', 'sustained_usage',
              'document_id', p_id,
              'last_edited_by', COALESCE(p_last_edited_by, 'anonymous'),
              'minutes_active', EXTRACT(EPOCH FROM (NOW() - v_doc_created_at)) / 60
            )
          );
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Log but never block the save
    RAISE WARNING 'Notification failed for document %: %', p_id, SQLERRM;
  END;
  -- === END NOTIFICATION LOGIC ===

  -- Check if we should create a version snapshot
  SELECT
    MAX(created_at),
    COUNT(*)
  INTO v_last_snapshot_time, v_save_count
  FROM document_versions
  WHERE document_id = p_id;

  IF v_save_count IS NULL THEN
    v_save_count := 0;
  END IF;

  -- Check sampling condition (every Nth save)
  IF (v_save_count + 1) % p_snapshot_every_n = 0 THEN
    v_should_snapshot := TRUE;
  END IF;

  -- Check time condition (every X seconds)
  IF v_last_snapshot_time IS NULL OR
     EXTRACT(EPOCH FROM (NOW() - v_last_snapshot_time)) >= p_snapshot_every_seconds THEN
    v_should_snapshot := TRUE;
  END IF;

  -- Create snapshot if needed
  IF v_should_snapshot THEN
    INSERT INTO document_versions (document_id, version, yjs_state, content_text, last_edited_by, created_at)
    VALUES (p_id, v_new_version, p_yjs_state_base64, p_content_text, p_last_edited_by, NOW());

    RETURN json_build_object(
      'success', v_success,
      'server_version', v_new_version,
      'message', 'Document saved with snapshot created'
    );
  END IF;

  -- Return success without snapshot
  RETURN json_build_object(
    'success', v_success,
    'server_version', v_new_version,
    'message', 'Document saved successfully'
  );
END;
$$ LANGUAGE plpgsql;
