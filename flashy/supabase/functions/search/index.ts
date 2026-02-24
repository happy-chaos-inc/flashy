// Supabase Edge Function for hybrid search (dense + sparse + RRF)
// Embeds query via OpenAI, calls hybrid_search RPC, returns ranked results

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
      throw new Error('Missing required fields: room_id, query')
    }

    console.log(`Searching room: ${room_id}, query: "${query.substring(0, 100)}"`)

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
      JSON.stringify({ results: [], error: error?.message || String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
