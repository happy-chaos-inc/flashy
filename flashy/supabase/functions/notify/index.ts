// Supabase Edge Function for email notifications via Resend
// Triggered by pg_net from upsert_document_rpc() on room creation and sustained usage

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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

// Constant-time string comparison to prevent timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Sanitize strings for safe HTML insertion (prevent XSS in emails)
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface NotifyPayload {
  type: 'room_created' | 'sustained_usage'
  document_id: string
  created_by?: string
  last_edited_by?: string
  minutes_active?: number
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate auth - only accept service role key
    const authHeader = req.headers.get('Authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!authHeader || !serviceRoleKey || !timingSafeEqual(authHeader, `Bearer ${serviceRoleKey}`)) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const notificationEmail = Deno.env.get('NOTIFICATION_EMAIL')

    if (!resendApiKey || !notificationEmail) {
      console.error('Missing RESEND_API_KEY or NOTIFICATION_EMAIL env vars')
      return new Response(
        JSON.stringify({ error: 'Notification service not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const payload: NotifyPayload = await req.json()
    const { type, document_id } = payload

    // Sanitize all user-supplied values before inserting into HTML
    const safeDocumentId = escapeHtml(document_id || '')
    const safeCreatedBy = escapeHtml(payload.created_by || 'anonymous')
    const safeLastEditedBy = escapeHtml(payload.last_edited_by || 'anonymous')

    // Build email content based on notification type
    let subject: string
    let html: string
    const roomUrl = `https://happy-chaos-inc.github.io/flashy/#/room/${encodeURIComponent(document_id)}`

    if (type === 'room_created') {
      subject = `Flashy: New room created by ${safeCreatedBy}`
      html = `
        <h2>New Room Created</h2>
        <p><strong>Room ID:</strong> ${safeDocumentId}</p>
        <p><strong>Created by:</strong> ${safeCreatedBy}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p><a href="${roomUrl}">Open Room</a></p>
      `
    } else if (type === 'sustained_usage') {
      const minutes = payload.minutes_active ? Math.round(payload.minutes_active) : '10+'
      subject = `Flashy: Room active for ${minutes} min (${safeLastEditedBy})`
      html = `
        <h2>Sustained Room Usage</h2>
        <p><strong>Room ID:</strong> ${safeDocumentId}</p>
        <p><strong>Last edited by:</strong> ${safeLastEditedBy}</p>
        <p><strong>Active for:</strong> ${minutes} minutes</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p><a href="${roomUrl}">Open Room</a></p>
      `
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown notification type: ${type}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Send email via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Flashy <notifications@flashy.dev>',
        to: [notificationEmail],
        subject,
        html,
      }),
    })

    if (!resendResponse.ok) {
      const error = await resendResponse.text()
      console.error('Resend API error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to send notification' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 }
      )
    }

    const result = await resendResponse.json()
    console.log(`Notification sent: type=${type}, document=${document_id}, resend_id=${result.id}`)

    return new Response(
      JSON.stringify({ success: true, id: result.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Notify function error:', error)
    return new Response(
      JSON.stringify({ error: 'Notification processing failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
