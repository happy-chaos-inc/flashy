// Supabase Edge Function for email notifications via Resend
// Triggered by pg_net from upsert_document_rpc() on room creation and sustained usage

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NotifyPayload {
  type: 'room_created' | 'sustained_usage'
  document_id: string
  created_by?: string
  last_edited_by?: string
  minutes_active?: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate auth - only accept service role key
    const authHeader = req.headers.get('Authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!authHeader || !serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
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

    // Build email content based on notification type
    let subject: string
    let html: string
    const roomUrl = `https://andyt.github.io/flashy/#/room/${document_id}`

    if (type === 'room_created') {
      const user = payload.created_by || 'anonymous'
      subject = `Flashy: New room created by ${user}`
      html = `
        <h2>New Room Created</h2>
        <p><strong>Room ID:</strong> ${document_id}</p>
        <p><strong>Created by:</strong> ${user}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p><a href="${roomUrl}">Open Room</a></p>
      `
    } else if (type === 'sustained_usage') {
      const user = payload.last_edited_by || 'anonymous'
      const minutes = payload.minutes_active ? Math.round(payload.minutes_active) : '10+'
      subject = `Flashy: Room active for ${minutes} min (${user})`
      html = `
        <h2>Sustained Room Usage</h2>
        <p><strong>Room ID:</strong> ${document_id}</p>
        <p><strong>Last edited by:</strong> ${user}</p>
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
        JSON.stringify({ error: 'Failed to send email', details: error }),
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
      JSON.stringify({ error: error?.message || String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
