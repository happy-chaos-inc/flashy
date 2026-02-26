// Supabase Edge Function for hybrid search (dense + sparse + RRF)
// Embeds query via OpenAI, calls hybrid_search RPC, returns ranked results

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
const MAX_QUERY_LENGTH = 500

interface SearchRequest {
  room_id: string
  query: string
}

interface SearchResult {
  file_name: string
  chunk_index: number
  text_content: string
  rrf_score: number
}

// Embed a single query string
async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`OpenAI Embeddings API error: ${error.error?.message || 'Request failed'}`)
  }

  const data = await response.json()
  return data.data[0].embedding
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

    const { room_id, query }: SearchRequest = await req.json()

    if (!room_id || !query) {
      return new Response(
        JSON.stringify({ results: [], error: 'Missing required fields: room_id, query' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Input validation
    if (!ROOM_ID_REGEX.test(room_id) || room_id.length > MAX_ROOM_ID_LENGTH) {
      return new Response(
        JSON.stringify({ results: [], error: 'Invalid room_id. Must be lowercase alphanumeric with hyphens, max 64 chars.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return new Response(
        JSON.stringify({ results: [], error: `Query too long. Maximum ${MAX_QUERY_LENGTH} characters.` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Log search for rate monitoring (Supabase built-in edge function limits handle throttling)
    console.log(`Search: room=${room_id}, query="${query.substring(0, 100)}"`)

    // 1. Check if room has any chunks (fast bail-out)
    const { count, error: countError } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room_id)

    if (countError) {
      console.error('Error checking chunks:', countError)
    }

    if (!count || count === 0) {
      return new Response(
        JSON.stringify({ results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 2. Embed the query
    const queryEmbedding = await embedQuery(query, openaiKey)

    // 3. Call hybrid search RPC
    const { data: results, error: searchError } = await supabase.rpc('hybrid_search', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      query_text: query,
      p_room_id: room_id,
      match_count: 5,
    })

    if (searchError) {
      throw new Error(`Hybrid search failed: ${searchError.message}`)
    }

    const formattedResults: SearchResult[] = (results || []).map((r: any) => ({
      file_name: r.file_name,
      chunk_index: r.chunk_index,
      text_content: r.text_content,
      rrf_score: r.rrf_score,
    }))

    console.log(`Found ${formattedResults.length} results`)

    return new Response(
      JSON.stringify({ results: formattedResults }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Search function error:', error)
    return new Response(
      JSON.stringify({ results: [], error: 'Search failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
