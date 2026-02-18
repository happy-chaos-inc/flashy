// Supabase Edge Function for AI Chat
// Supports: Free tier (GPT-3.5), BYOK (user's key), Premium models

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface RequestBody {
  messages: ChatMessage[]
  documentContent?: string
  // BYOK: User provides their own API key
  userApiKey?: string
  // Provider: 'openai' or 'anthropic'
  provider?: 'openai' | 'anthropic'
  // Model selection
  model?: string
  // Room ID for rate limiting
  roomId?: string
}

// Model configurations
const MODELS = {
  // Free tier (your key)
  'gpt-3.5-turbo': { provider: 'openai', maxTokens: 500, free: true },
  // Premium OpenAI (BYOK)
  'gpt-4-turbo': { provider: 'openai', maxTokens: 1000, free: false },
  'gpt-4o': { provider: 'openai', maxTokens: 1000, free: false },
  // Premium Anthropic (BYOK)
  'claude-3-5-sonnet-20241022': { provider: 'anthropic', maxTokens: 1000, free: false },
  'claude-3-5-haiku-20241022': { provider: 'anthropic', maxTokens: 1000, free: false },
}

const FREE_TIER_LIMIT = 500 // messages per day per room (~$1/day max per room)

// Check rate limit using Supabase database
async function checkRateLimit(supabase: any, roomId: string): Promise<{ allowed: boolean, remaining: number }> {
  try {
    const { data, error } = await supabase.rpc('check_chat_rate_limit', {
      p_room_id: roomId,
      p_daily_limit: FREE_TIER_LIMIT
    })

    if (error) {
      console.error('Rate limit check error:', error)
      // Fail open - allow request if DB check fails
      return { allowed: true, remaining: FREE_TIER_LIMIT }
    }

    return {
      allowed: data.allowed,
      remaining: data.remaining
    }
  } catch (err) {
    console.error('Rate limit exception:', err)
    return { allowed: true, remaining: FREE_TIER_LIMIT }
  }
}

async function callOpenAI(apiKey: string, model: string, messages: ChatMessage[], maxTokens: number) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'OpenAI API request failed')
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || 'No response generated'
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, messages: ChatMessage[], maxTokens: number) {
  // Convert messages format for Anthropic (no system in messages array)
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }))

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: anthropicMessages,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Anthropic API request failed')
  }

  const data = await response.json()
  return data.content?.[0]?.text || 'No response generated'
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client for rate limiting
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    console.log('Chat function called, OPENAI_API_KEY present:', !!openaiKey)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const {
      messages,
      documentContent,
      userApiKey,
      provider = 'openai',
      model = 'gpt-3.5-turbo',
      roomId = 'default'
    }: RequestBody = await req.json()

    if (!messages || !Array.isArray(messages)) {
      throw new Error('Invalid request: messages array required')
    }

    // Determine which API key to use
    const DEFAULT_OPENAI_KEY = Deno.env.get('OPENAI_API_KEY')
    const modelConfig = MODELS[model as keyof typeof MODELS] || MODELS['gpt-3.5-turbo']

    // Check if using free tier
    const isFreeTier = !userApiKey && modelConfig.free

    let remainingMessages: number | undefined

    if (isFreeTier) {
      // Rate limit free tier using database
      const { allowed, remaining } = await checkRateLimit(supabase, roomId)
      remainingMessages = remaining
      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: 'Free tier limit reached (500 messages/day). Add your own API key for unlimited access.',
            rateLimited: true,
            remaining: 0
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
        )
      }
      console.log(`Free tier: ${remaining} messages remaining for room ${roomId}`)
    }

    // Validate API key availability
    let apiKey: string
    if (userApiKey) {
      apiKey = userApiKey
    } else if (modelConfig.free && DEFAULT_OPENAI_KEY) {
      apiKey = DEFAULT_OPENAI_KEY
    } else {
      throw new Error('API key required for this model. Please add your own API key.')
    }

    // Build system prompt
    let systemPrompt = `You are a helpful AI assistant in Flashy, a collaborative flashcard study app.
Help users with their study topics, explain concepts, quiz them, or answer questions about their flashcards.
Keep responses concise and educational. Use markdown formatting when helpful.`

    if (documentContent && documentContent.trim()) {
      const maxLength = 8000
      const truncatedContent = documentContent.length > maxLength
        ? documentContent.substring(0, maxLength) + '\n\n[Content truncated...]'
        : documentContent

      systemPrompt += `

## Current Study Material

The user is studying the following flashcard content:

\`\`\`markdown
${truncatedContent}
\`\`\`

Use this context to provide relevant, helpful responses.`
    }

    // Call the appropriate API
    let content: string
    const actualProvider = modelConfig.provider || provider

    if (actualProvider === 'anthropic') {
      content = await callAnthropic(apiKey, model, systemPrompt, messages, modelConfig.maxTokens)
    } else {
      const systemMessage: ChatMessage = { role: 'system', content: systemPrompt }
      content = await callOpenAI(apiKey, model, [systemMessage, ...messages], modelConfig.maxTokens)
    }

    return new Response(
      JSON.stringify({
        content,
        model,
        provider: actualProvider,
        remaining: remainingMessages  // undefined if BYOK (unlimited)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Chat function error:', error)
    const errorMessage = error?.message || String(error) || 'Unknown error'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
