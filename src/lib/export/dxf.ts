import type { Polygon } from '../geometry';

export interface DxfLayer { name: string; polys: Polygon[]; color: number }

/**
 * Minimal DXF (AC1015 / R2000) writer with closed LWPOLYLINE entities in millimetres.
 * Y axis is flipped so the drawing matches the on-screen (y-down) layout when opened in CAD (y-up).
 */
export function toDxf(layers: DxfLayer[], heightMm: number): string {
  const L: string[] = [];
  const push = (code: number | string, value: string | number) => { L.push(String(code)); L.push(String(value)); };
  const fmt = (n: number) => (Math.round(n * 10000) / 10000).toString();

  push(0, 'SECTION'); push(2, 'HEADER');
  push(9, '$ACADVER'); push(1, 'AC1015');
  push(9, '$INSUNITS'); push(70, 4); // 4 = millimetres
  push(0, 'ENDSEC');

  push(0, 'SECTION'); push(2, 'TABLES');
  push(0, 'TABLE'); push(2, 'LAYER'); push(70, layers.length);
  for (const l of layers) {
    push(0, 'LAYER'); push(2, l.name); push(70, 0); push(62, l.color); push(6, 'CONTINUOUS');
  }
  push(0, 'ENDTAB');
  push(0, 'ENDSEC');

  push(0, 'SECTION'); push(2, 'ENTITIES');
  for (const l of layers) {
    for (const p of l.polys) {
      if (p.length < 3) continue;
      push(0, 'LWPOLYLINE'); push(8, l.name); push(90, p.length); push(70, 1); // 1 = closed
      for (const q of p) { push(10, fmt(q.x)); push(20, fmt(heightMm - q.y)); }
    }
  }
  push(0, 'ENDSEC');
  push(0, 'EOF');
  return L.join('\n') + '\n';
}
