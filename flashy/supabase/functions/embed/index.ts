// Supabase Edge Function for document embedding
// Chunks text, calls OpenAI text-embedding-3-small, stores in Postgres

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://happy-chaos-inc.github.io',
  'http://localhost:3000',
]

function getAllowedOrigin(req: Request): string {
  const origin = req.headers.get('Origin') || ''
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin
  }
  return ALLOWED_ORIGINS[0]
}

function getCorsHeaders(req: Request) {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(req),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

const ROOM_ID_REGEX = /^[a-z0-9-]+$/
const MAX_ROOM_ID_LENGTH = 64
const MAX_FILE_NAME_LENGTH = 255
const MAX_TEXT_CONTENT_LENGTH = 500000
const MAX_CHUNKS_PER_ROOM = 500

interface EmbedRequest {
  room_id: string
  file_name: string
  text_content: string
  file_id: string
}

// Split text into chunks with overlap
function chunkText(text: string, targetChars = 2000, overlapChars = 300): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/\n\n+/)

  let currentChunk = ''

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue

    // If adding this paragraph would exceed target, save current chunk and start new one
    if (currentChunk.length > 0 && currentChunk.length + trimmed.length > targetChars) {
      chunks.push(currentChunk.trim())

      // Start new chunk with overlap from end of previous chunk
      const overlapStart = Math.max(0, currentChunk.length - overlapChars)
      currentChunk = currentChunk.slice(overlapStart).trim() + '\n\n' + trimmed
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  // Handle case where input has no paragraph breaks
  if (chunks.length === 0 && text.trim()) {
    // Fall back to character-based splitting
    let i = 0
    while (i < text.length) {
      const end = Math.min(i + targetChars, text.length)
      chunks.push(text.slice(i, end).trim())
      i = end - overlapChars
      if (i < 0) break
    }
  }

  return chunks.filter(c => c.length > 0)
}

// Batch embed texts via OpenAI
async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  const BATCH_SIZE = 100
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: batch,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`OpenAI Embeddings API error: ${error.error?.message || 'Request failed'}`)
    }

    const data = await response.json()
    const embeddings = data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding)

    allEmbeddings.push(...embeddings)
  }

  return allEmbeddings
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { room_id, file_name, text_content, file_id }: EmbedRequest = await req.json()

    if (!room_id || !file_name || !text_content) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: room_id, file_name, text_content' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Input validation
    if (!ROOM_ID_REGEX.test(room_id) || room_id.length > MAX_ROOM_ID_LENGTH) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid room_id. Must be lowercase alphanumeric with hyphens, max 64 chars.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (file_name.length > MAX_FILE_NAME_LENGTH || file_name.includes('..') || file_name.includes('/')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid file_name. Max 255 chars, no ".." or "/" allowed.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (text_content.length > MAX_TEXT_CONTENT_LENGTH) {
      return new Response(
        JSON.stringify({ success: false, error: `text_content too large. Maximum ${MAX_TEXT_CONTENT_LENGTH} characters.` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Rate limiting: check existing chunk count for this room
    const { count: existingChunks, error: countError } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room_id)

    if (countError) {
      console.error('Error checking chunk count:', countError)
    }

    if (existingChunks && existingChunks > MAX_CHUNKS_PER_ROOM) {
      return new Response(
        JSON.stringify({ success: false, error: 'Embedding limit reached for this room.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      )
    }

    console.log(`Embedding file: ${file_name} for room: ${room_id}, content length: ${text_content.length}`)

    // 1. Chunk the text
    const chunks = chunkText(text_content)
    console.log(`Split into ${chunks.length} chunks`)

    if (chunks.length === 0) {
      return new Response(
        JSON.stringify({ success: true, chunk_count: 0, file_name }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 2. Generate embeddings
    const embeddings = await embedTexts(chunks, openaiKey)
    console.log(`Generated ${embeddings.length} embeddings`)

    // 3. Delete existing chunks for this file (idempotent re-upload)
    const { data: deleteResult, error: deleteError } = await supabase.rpc('delete_file_chunks', {
      p_room_id: room_id,
      p_file_name: file_name,
    })

    if (deleteError) {
      console.error('Error deleting old chunks:', deleteError)
      // Continue anyway — upsert will handle conflicts
    } else {
      console.log(`Deleted ${deleteResult} existing chunks for ${file_name}`)
    }

    // 4. Prepare and upsert chunks
    const chunkRecords = chunks.map((text, index) => ({
      room_id,
      file_name,
      chunk_index: index,
      text_content: text,
      embedding: `[${embeddings[index].join(',')}]`,
      metadata: { file_id, chunk_count: chunks.length },
    }))

    const { data: upsertResult, error: upsertError } = await supabase.rpc('upsert_chunks', {
      p_chunks: chunkRecords,
    })

    if (upsertError) {
      throw new Error(`Failed to store chunks: ${upsertError.message}`)
    }

    console.log(`Upserted ${upsertResult} chunks for ${file_name}`)

    return new Response(
      JSON.stringify({ success: true, chunk_count: chunks.length, file_name }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Embed function error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Embedding failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
