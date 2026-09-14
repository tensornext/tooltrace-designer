import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Pt } from '../lib/geometry';

export interface View { scale: number; tx: number; ty: number }

export interface StageEvent {
  world: Pt;
  client: Pt;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  native: RPointerEvent<HTMLCanvasElement>;
}

interface Props {
  /** Size of the world content (used for fit-to-view). */
  contentWidth: number;
  contentHeight: number;
  /** Re-run drawing when this changes. */
  draw: (ctx: CanvasRenderingContext2D, view: View, size: { w: number; h: number }) => void;
  onDown?: (e: StageEvent) => boolean | void; // return true to capture the drag
  onMove?: (e: StageEvent, dragging: boolean) => void;
  onUp?: (e: StageEvent) => void;
  onHover?: (e: StageEvent) => void;
  cursor?: string;
  fitKey?: unknown;
  children?: ReactNode;
  overlay?: ReactNode;
}

/** A pan/zoom canvas. Wheel zooms around the cursor; middle-drag, space-drag or plain drag (when the handler does not capture) pans. */
export default function CanvasStage({ contentWidth, contentHeight, draw, onDown, onMove, onUp, onHover, cursor, fitKey, overlay }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view); viewRef.current = view;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ mode: 'pan' | 'custom'; last: Pt } | null>(null);
  const space = useRef(false);

  const fit = useCallback((w: number, h: number) => {
    if (!contentWidth || !contentHeight || !w || !h) return;
    const s = Math.min(w / contentWidth, h / contentHeight) * 0.92;
    setView({ scale: s, tx: (w - contentWidth * s) / 2, ty: (h - contentHeight * s) / 2 });
  }, [contentWidth, contentHeight]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // fit whenever content or key changes
  useEffect(() => { fit(size.w, size.h); }, [fit, fitKey, size.w, size.h]);

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(size.w * dpr));
    c.height = Math.max(1, Math.round(size.h * dpr));
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);
    draw(ctx, view, size);
    ctx.restore();
  }, [draw, view, size]);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement)?.matches('input,textarea')) { space.current = true; } };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  const toEvent = (e: RPointerEvent<HTMLCanvasElement>): StageEvent => {
    const r = canvasRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const v = viewRef.current;
    return { client: { x: cx, y: cy }, world: { x: (cx - v.tx) / v.scale, y: (cy - v.ty) / v.scale }, button: e.button, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, native: e };
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const s = Math.min(200, Math.max(0.01, v.scale * f));
      const k = s / v.scale;
      return { scale: s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  };
  useEffect(() => {
    const c = canvasRef.current!;
    const prevent = (e: WheelEvent) => e.preventDefault();
    c.addEventListener('wheel', prevent, { passive: false });
    return () => c.removeEventListener('wheel', prevent);
  }, []);

  const pointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    const ev = toEvent(e);
    if (e.button === 1 || space.current) { drag.current = { mode: 'pan', last: ev.client }; return; }
    const captured = onDown?.(ev);
    drag.current = captured ? { mode: 'custom', last: ev.client } : { mode: 'pan', last: ev.client };
  };
  const pointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const ev = toEvent(e);
    if (!drag.current) { onHover?.(ev); onMove?.(ev, false); return; }
    if (drag.current.mode === 'pan') {
      const dx = ev.client.x - drag.current.last.x, dy = ev.client.y - drag.current.last.y;
      drag.current.last = ev.client;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
      return;
    }
    onMove?.(ev, true);
  };
  const pointerUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const ev = toEvent(e);
    const was = drag.current;
    drag.current = null;
    if (was?.mode === 'custom') onUp?.(ev);
  };

  return (
    <div ref={wrapRef} className="stage" style={{ cursor: cursor ?? 'default' }}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: 'block' }}
        onWheel={onWheel}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="stage-tools">
        <button className="btn btn-icon" title="Fit to view" onClick={() => fit(size.w, size.h)}>⤢</button>
        <button className="btn btn-icon" title="Zoom in" onClick={() => setView((v) => zoomAt(v, size, 1.25))}>+</button>
        <button className="btn btn-icon" title="Zoom out" onClick={() => setView((v) => zoomAt(v, size, 0.8))}>−</button>
      </div>
      {overlay}
    </div>
  );
}

function zoomAt(v: View, size: { w: number; h: number }, f: number): View {
  const cx = size.w / 2, cy = size.h / 2;
  const s = Math.min(200, Math.max(0.01, v.scale * f));
  const k = s / v.scale;
  return { scale: s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
}
