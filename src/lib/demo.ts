import { applyHomography, computeHomography } from './homography';

/** A synthetic "photo": grey table, white A4 sheet in mild perspective, three tool-like shapes on it. */
export async function makeDemoPhoto(): Promise<{ width: number; height: number; url: string; data: Uint8ClampedArray }> {
  const w = 1200, h = 900;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  // table
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#6a5f55'); g.addColorStop(1, '#4b4239');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // paper quad (mm -> px)
  const quad = [{ x: 330, y: 70 }, { x: 900, y: 95 }, { x: 930, y: 850 }, { x: 290, y: 820 }];
  const H = computeHomography([{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 297 }, { x: 0, y: 297 }], quad);
  const P = (x: number, y: number) => applyHomography(H, { x, y });
  const path = (pts: { x: number; y: number }[]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 25; ctx.shadowOffsetY = 8;
  path(quad); ctx.fillStyle = '#efece6'; ctx.fill();
  ctx.shadowColor = 'transparent';
  // paper texture noise
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 10; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  // tools in mm
  const mmPoly = (pts: [number, number][], fill: string) => { path(pts.map(([x, y]) => P(x, y))); ctx.fillStyle = fill; ctx.fill(); };
  // wrench: 30 x 160 with rounded heads
  const wrench: [number, number][] = [];
  for (let a = 0; a <= 32; a++) { const t = Math.PI / 2 + (a / 32) * Math.PI; wrench.push([50 + 14 * Math.cos(t), 60 + 14 * Math.sin(t)]); }
  wrench.push([44, 60], [44, 200]);
  for (let a = 0; a <= 32; a++) { const t = -Math.PI / 2 + (a / 32) * Math.PI; wrench.push([50 + 13 * Math.cos(t), 200 + 13 * Math.sin(t)]); }
  wrench.push([56, 200], [56, 60]);
  mmPoly(wrench, '#3b3f46');
  // pliers-like: two lobes
  mmPoly([[100, 60], [125, 55], [132, 90], [126, 100], [140, 240], [128, 250], [116, 160], [104, 250], [92, 240], [106, 100], [100, 90]], '#c0392b');
  // hex key set (L shape)
  mmPoly([[150, 200], [190, 200], [190, 210], [160, 210], [160, 270], [150, 270]], '#2c3e50');
  // small round part
  ctx.beginPath(); const cc = P(175, 110); ctx.arc(cc.x, cc.y, 42, 0, Math.PI * 2); ctx.fillStyle = '#8e6e3a'; ctx.fill();
  const data = ctx.getImageData(0, 0, w, h).data;
  return { width: w, height: h, url: c.toDataURL('image/jpeg', 0.9), data };
}
