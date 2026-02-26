/**
 * Error Reporter
 * Captures client-side errors and sends them to Supabase for remote monitoring
 */

import { supabase } from '../config/supabase';

// Dedupe: don't send the same error repeatedly
const sentErrors = new Set<string>();
const MAX_SENT_ERRORS = 100;

// Rate limiting: max errors per minute
let errorCount = 0;
const MAX_ERRORS_PER_MINUTE = 10;
let rateLimitTimer: ReturnType<typeof setInterval> | null = null;

interface ErrorReport {
  message: string;
  stack?: string;
  error_type: 'uncaught' | 'unhandledrejection' | 'manual';
  room_id?: string;
  user_agent: string;
  url: string;
  session_id?: string;
  user_name?: string;
}

function getErrorKey(message: string, stack?: string): string {
  return `${message}:${stack?.slice(0, 200) || ''}`;
}

async function sendError(report: ErrorReport): Promise<void> {
  // Rate limit
  if (errorCount >= MAX_ERRORS_PER_MINUTE) return;

  // Dedupe
  const key = getErrorKey(report.message, report.stack);
  if (sentErrors.has(key)) return;

  // Track
  sentErrors.add(key);
  errorCount++;

  // Clean up old entries
  if (sentErrors.size > MAX_SENT_ERRORS) {
    const first = sentErrors.values().next().value;
    if (first) sentErrors.delete(first);
  }

  try {
    await supabase.from('error_logs').insert({
      message: report.message.slice(0, 1000), // Limit size
      stack: report.stack?.slice(0, 5000),
      error_type: report.error_type,
      room_id: report.room_id,
      user_agent: report.user_agent,
      url: report.url,
      session_id: report.session_id,
      user_name: report.user_name,
    });
  } catch {
    // Silently fail - don't cause more errors
  }
}

function getContext(): Pick<ErrorReport, 'room_id' | 'user_agent' | 'url' | 'session_id' | 'user_name'> {
  // Extract room ID from URL
  const roomMatch = window.location.pathname.match(/\/room\/([^/]+)/);

  return {
    room_id: roomMatch?.[1] || sessionStorage.getItem('flashy_room_id') || undefined,
    user_agent: navigator.userAgent,
    url: window.location.href,
    session_id: sessionStorage.getItem('flashy_session_id') || undefined,
    user_name: sessionStorage.getItem('flashy_username') || undefined,
  };
}

/**
 * Initialize global error handlers
 * Call this once at app startup
 */
export function initErrorReporter(): void {
  // Start rate limit reset timer (store handle for cleanup)
  if (!rateLimitTimer) {
    rateLimitTimer = setInterval(() => { errorCount = 0; }, 60000);
  }

  // Generate session ID if not exists
  if (!sessionStorage.getItem('flashy_session_id')) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('flashy_session_id', `session-${id}`);
  }

  // Uncaught errors
  window.addEventListener('error', (event) => {
    sendError({
      message: event.message || 'Unknown error',
      stack: event.error?.stack,
      error_type: 'uncaught',
      ...getContext(),
    });
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    sendError({
      message: error?.message || String(error) || 'Unhandled promise rejection',
      stack: error?.stack,
      error_type: 'unhandledrejection',
      ...getContext(),
    });
  });
}

/**
 * Manually report an error
 */
export function reportError(error: Error | string, extra?: Record<string, unknown>): void {
  const message = typeof error === 'string' ? error : error.message;
  const stack = typeof error === 'string' ? undefined : error.stack;

  sendError({
    message: extra ? `${message} | ${JSON.stringify(extra)}` : message,
    stack,
    error_type: 'manual',
    ...getContext(),
  });
}
