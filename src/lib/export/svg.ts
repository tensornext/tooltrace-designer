import type { Polygon } from '../geometry';

export interface SvgLayer { name: string; polys: Polygon[]; stroke: string; fill?: string }

/** SVG in millimetre units (1 user unit = 1 mm), suitable for laser cutters / Lightburn / Inkscape. */
export function toSvg(widthMm: number, heightMm: number, layers: SvgLayer[]): string {
  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();
  const groups = layers.map((l) => {
    const paths = l.polys
      .filter((p) => p.length >= 3)
      .map((p) => `<path d="M ${p.map((q) => `${fmt(q.x)} ${fmt(q.y)}`).join(' L ')} Z"/>`)
      .join('\n    ');
    return `  <g id="${escapeXml(l.name)}" inkscape:label="${escapeXml(l.name)}" inkscape:groupmode="layer" fill="${l.fill ?? 'none'}" stroke="${l.stroke}" stroke-width="0.2">\n    ${paths}\n  </g>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${fmt(widthMm)}mm" height="${fmt(heightMm)}mm" viewBox="0 0 ${fmt(widthMm)} ${fmt(heightMm)}">
${groups.join('\n')}
</svg>
`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string));
}
