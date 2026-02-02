import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please check your .env.local file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 100, // Higher limit for 4 users typing fast
    },
  },
  global: {
    headers: {
      'x-client-info': 'flashy-collab',
    },
  },
});

// Database types will be generated later from Supabase schema
export type Database = {
  public: {
    Tables: {
      documents: {
        Row: {
          id: string;
          title: string;
          owner_id: string;
          yjs_state: string | null;
          content_text: string | null;
          created_at: string;
          updated_at: string;
          last_edited_by: string | null;
          version: number;
          is_deleted: boolean;
        };
        Insert: {
          id?: string;
          title?: string;
          owner_id: string;
          yjs_state?: string | null;
          content_text?: string | null;
          created_at?: string;
          updated_at?: string;
          last_edited_by?: string | null;
          version?: number;
          is_deleted?: boolean;
        };
        Update: {
          id?: string;
          title?: string;
          owner_id?: string;
          yjs_state?: string | null;
          content_text?: string | null;
          created_at?: string;
          updated_at?: string;
          last_edited_by?: string | null;
          version?: number;
          is_deleted?: boolean;
        };
      };
      document_collaborators: {
        Row: {
          id: string;
          document_id: string;
          user_id: string;
          role: 'viewer' | 'editor' | 'owner';
          added_at: string;
          added_by: string | null;
        };
        Insert: {
          id?: string;
          document_id: string;
          user_id: string;
          role: 'viewer' | 'editor' | 'owner';
          added_at?: string;
          added_by?: string | null;
        };
        Update: {
          id?: string;
          document_id?: string;
          user_id?: string;
          role?: 'viewer' | 'editor' | 'owner';
          added_at?: string;
          added_by?: string | null;
        };
      };
      flashcards: {
        Row: {
          id: string;
          document_id: string;
          question: string;
          answer: string;
          header_level: number | null;
          position: number;
          created_at: string;
          updated_at: string;
          source_block_id: string | null;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          document_id: string;
          question: string;
          answer: string;
          header_level?: number | null;
          position: number;
          created_at?: string;
          updated_at?: string;
          source_block_id?: string | null;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          document_id?: string;
          question?: string;
          answer?: string;
          header_level?: number | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
          source_block_id?: string | null;
          is_active?: boolean;
        };
      };
    };
  };
};
