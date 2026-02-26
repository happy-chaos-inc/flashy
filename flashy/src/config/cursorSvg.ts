/**
 * Centralized cursor SVG definition
 * Customize the cursor shape here - changes will apply everywhere
 */

// Validate color is a safe hex/named value before injecting into SVG
function sanitizeColor(color: string): string {
  if (/^#[0-9A-Fa-f]{3,8}$/.test(color)) return color;
  if (/^[a-zA-Z]+$/.test(color)) return color; // named colors
  return '#999'; // fallback
}

export function getCursorSvg(color: string): string {
  const safeColor = sanitizeColor(color);
  return `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="${safeColor}" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `.trim();
}

export function getCursorDataUrl(color: string): string {
  const svg = getCursorSvg(color);
  return 'data:image/svg+xml;base64,' + btoa(svg);
}
