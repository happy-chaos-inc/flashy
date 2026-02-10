/**
 * Centralized cursor SVG definition
 * Customize the cursor shape here - changes will apply everywhere
 */

export function getCursorSvg(color: string): string {
  return `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="${color}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `.trim();
}

export function getCursorDataUrl(color: string): string {
  const svg = getCursorSvg(color);
  return 'data:image/svg+xml;base64,' + btoa(svg);
}
