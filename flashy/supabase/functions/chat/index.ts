// Supabase Edge Function for AI Chat
// Supports: Free tier (GPT-4o Mini + Claude Haiku), BYOK (user's key), Premium models

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | any[]
}

interface ImageAttachment {
  base64: string
  mimeType: string
  name: string
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
  // Image attachments (base64-encoded, for the latest user message)
  imageAttachments?: ImageAttachment[]
}

// Model configurations
const MODELS = {
  // Free tier (your key)
  'gpt-4o-mini': { provider: 'openai', maxTokens: 500, free: true },
  // Premium OpenAI (BYOK)
  'gpt-4-turbo': { provider: 'openai', maxTokens: 1000, free: false },
  'gpt-4o': { provider: 'openai', maxTokens: 1000, free: false },
  // Free tier Anthropic (your key)
  'claude-3-5-haiku-20241022': { provider: 'anthropic', maxTokens: 500, free: true },
  // Premium Anthropic (BYOK)
  'claude-3-5-sonnet-20241022': { provider: 'anthropic', maxTokens: 1000, free: false },
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
    console.error('OpenAI error:', JSON.stringify(error), 'model:', model, 'hasMultimodal:', messages.some(m => Array.isArray(m.content)))
    throw new Error(`OpenAI [${model}]: ${error.error?.message || 'API request failed'}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || 'No response generated'
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, messages: ChatMessage[], maxTokens: number) {
  // Convert messages format for Anthropic (no system in messages array)
  // Preserve multimodal content arrays as-is
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }))

  // Check if any message contains a PDF document (needs beta header)
  const hasPdf = messages.some(m =>
    Array.isArray(m.content) && m.content.some((p: any) => p.type === 'document')
  )

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  if (hasPdf) {
    headers['anthropic-beta'] = 'pdfs-2024-09-25'
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: anthropicMessages,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    console.error('Anthropic error:', JSON.stringify(error), 'model:', model)
    throw new Error(`Anthropic [${model}]: ${error.error?.message || 'API request failed'}`)
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
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')

    console.log('Chat function called, OPENAI_API_KEY present:', !!openaiKey, 'ANTHROPIC_API_KEY present:', !!anthropicKey)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let reqBody: RequestBody
    try {
      reqBody = await req.json()
    } catch (parseErr) {
      console.error('Failed to parse request body:', parseErr)
      return new Response(
        JSON.stringify({ error: 'Request body too large or invalid JSON. Try a smaller image.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const {
      messages,
      documentContent,
      userApiKey,
      provider = 'openai',
      model = 'gpt-4o-mini',
      roomId = 'default',
      imageAttachments
    } = reqBody

    if (!messages || !Array.isArray(messages)) {
      throw new Error('Invalid request: messages array required')
    }

    // Determine which API key to use
    const DEFAULT_OPENAI_KEY = Deno.env.get('OPENAI_API_KEY')
    const modelConfig = MODELS[model as keyof typeof MODELS] || MODELS['gpt-4o-mini']

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
    const DEFAULT_ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    const actualProvider = modelConfig.provider || provider

    let apiKey: string
    if (userApiKey) {
      apiKey = userApiKey
    } else if (modelConfig.free && actualProvider === 'anthropic' && DEFAULT_ANTHROPIC_KEY) {
      apiKey = DEFAULT_ANTHROPIC_KEY
    } else if (modelConfig.free && actualProvider === 'openai' && DEFAULT_OPENAI_KEY) {
      apiKey = DEFAULT_OPENAI_KEY
    } else {
      throw new Error('API key required for this model. Please add your own API key.')
    }

    // Build system prompt
    let systemPrompt = `You are a helpful AI assistant in Flashy, a collaborative flashcard study app.
Help users with their study topics, explain concepts, quiz them, or answer questions about their flashcards.
Keep responses concise and educational.

IMPORTANT formatting rule: Always reply in plain conversational text. No markdown whatsoever — no headers (#), no bold (**), no bullet points (-), no numbered lists, no code blocks. Just write normal sentences and paragraphs.
The ONLY exception: when the user says "generate flashcards", "make flashcards", "create a list", "summarize in bullets", or "make an outline" — then use this flashcard markdown format:
- # Header 1 = group/chapter name (e.g., # Chapter 4)
- ## Header 2 = flashcard term (the front of the card)
- Plain text under ## = flashcard description (the back of the card)
Example:
# Mitosis
## Prophase
Chromosomes condense and become visible. Nuclear envelope begins to break down.
## Metaphase
Chromosomes align at the cell's equator.
If the user asks about a file, explains a concept, asks a question, or says "tell me about", respond in plain text.`

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

    // If there are file attachments, transform the last user message to multimodal format
    console.log('imageAttachments received:', imageAttachments ? imageAttachments.length : 0,
      imageAttachments ? imageAttachments.map(a => `${a.name}:${a.mimeType}:${a.base64.length}chars`) : [])
    if (imageAttachments && imageAttachments.length > 0) {
      const lastIdx = messages.length - 1
      if (lastIdx >= 0 && messages[lastIdx].role === 'user') {
        const textContent = messages[lastIdx].content as string
        if (actualProvider === 'anthropic') {
          // Anthropic multimodal format — supports images and PDFs natively
          const parts: any[] = imageAttachments.map(att => {
            if (att.mimeType === 'application/pdf') {
              return {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: att.base64 },
              }
            }
            return {
              type: 'image',
              source: { type: 'base64', media_type: att.mimeType, data: att.base64 },
            }
          })
          parts.push({ type: 'text', text: textContent })
          messages[lastIdx].content = parts
        } else {
          // OpenAI multimodal format — images only, PDFs not natively supported
          const imageParts = imageAttachments
            .filter(att => att.mimeType !== 'application/pdf')
            .map(img => ({
              type: 'image_url' as const,
              image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
            }))
          const hasPdfs = imageAttachments.some(att => att.mimeType === 'application/pdf')
          const pdfNote = hasPdfs ? '\n\n(Note: PDF files were attached but this model cannot read PDFs directly. Try switching to Claude for PDF support.)' : ''
          messages[lastIdx].content = [
            { type: 'text' as const, text: textContent + pdfNote },
            ...imageParts,
          ]
        }
      }
    }

    console.log('Calling API — provider:', actualProvider, 'model:', model, 'msgCount:', messages.length,
      'lastMsgIsArray:', Array.isArray(messages[messages.length - 1]?.content))

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
