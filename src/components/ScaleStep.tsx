import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CanvasStage, { type StageEvent, type View } from './CanvasStage';
import { useDesigner } from '../state/store';
import { PAPER_SIZES } from '../lib/paper';
import { orderCorners } from '../lib/homography';
import { imageWorker } from '../worker/client';
import type { Pt } from '../lib/geometry';

const LABELS = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];

export default function ScaleStep() {
  const source = useDesigner((s) => s.source)!;
  const corners = useDesigner((s) => s.corners);
  const setCorners = useDesigner((s) => s.setCorners);
  const paperId = useDesigner((s) => s.paperId);
  const setPaper = useDesigner((s) => s.setPaper);
  const customPaper = useDesigner((s) => s.customPaper);
  const setCustomPaper = useDesigner((s) => s.setCustomPaper);
  const paper = useDesigner((s) => s.paper);
  const setRectified = useDesigner((s) => s.setRectified);
  const setStep = useDesigner((s) => s.setStep);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [landscape, setLandscape] = useState(false);
  const dragIdx = useRef<number>(-1);
  const [hover, setHover] = useState<Pt | null>(null);

  useEffect(() => {
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = source.url;
  }, [source.url]);

  // auto-detect on first load
  useEffect(() => {
    if (corners) return;
    let cancelled = false;
    setBusy('Looking for the paper…');
    imageWorker().detect(source.data, source.width, source.height).then((r) => {
      if (cancelled) return;
      if (r.corners) { setCorners(orderCorners(r.corners)); setStatus('Paper detected automatically. Drag the handles if they are off.'); }
      else setStatus('Could not find the paper automatically. Click its four corners in order.');
    }).catch((e) => setStatus(`Detection failed: ${e.message}`)).finally(() => !cancelled && setBusy(null));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const pts = corners ?? [];
  const handleR = useCallback((v: View) => 9 / v.scale, []);
  const viewRef = useRef<View>({ scale: 1, tx: 0, ty: 0 });

  const draw = useCallback((ctx: CanvasRenderingContext2D, view: View) => {
    viewRef.current = view;
    if (img) ctx.drawImage(img, 0, 0, source.width, source.height);
    const r = handleR(view);
    ctx.lineWidth = 2 / view.scale;
    if (pts.length >= 2) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (pts.length === 4) ctx.closePath();
      ctx.strokeStyle = '#4cc9f0'; ctx.stroke();
      if (pts.length === 4) { ctx.fillStyle = 'rgba(76,201,240,0.12)'; ctx.fill(); }
    }
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#4cc9f0'; ctx.fill(); ctx.strokeStyle = '#08222c'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `${12 / view.scale}px system-ui`; ctx.fillText(String(i + 1), p.x + r * 1.3, p.y - r * 0.6);
    });
    if (pts.length < 4 && hover) {
      ctx.beginPath(); ctx.arc(hover.x, hover.y, r * 0.6, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }, [img, pts, source.width, source.height, handleR, hover]);

  const hit = (w: Pt) => {
    const r = handleR(viewRef.current) * 1.6;
    return pts.findIndex((p) => Math.hypot(p.x - w.x, p.y - w.y) <= r);
  };
  const onDown = (e: StageEvent) => {
    if (e.button !== 0) return false;
    const i = hit(e.world);
    if (i >= 0) { dragIdx.current = i; return true; }
    if (pts.length < 4) {
      const next = [...pts, e.world];
      setCorners(next.length === 4 ? orderCorners(next) : next);
      return false;
    }
    return false;
  };
  const onMove = (e: StageEvent, dragging: boolean) => {
    if (dragging && dragIdx.current >= 0) {
      const next = pts.slice(); next[dragIdx.current] = e.world; setCorners(next);
    }
  };
  const onUp = () => { dragIdx.current = -1; };

  const p = paper();
  const paperW = landscape ? p.h : p.w, paperH = landscape ? p.w : p.h;

  const rectifyNow = async () => {
    if (pts.length !== 4) return;
    setBusy('Rectifying photo…');
    try {
      const r = await imageWorker().rectify(source.data, source.width, source.height, pts, paperW, paperH);
      const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer), r.width, r.height));
      setRectified({ width: r.width, height: r.height, pxPerMm: r.pxPerMm, originMm: r.originMm, paperPx: r.paperPx, bitmap });
      setStep('trace');
    } catch (e) { setStatus(`Rectify failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  const quadInfo = useMemo(() => {
    if (pts.length !== 4) return null;
    const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const top = d(pts[0], pts[1]), bottom = d(pts[2], pts[3]), left = d(pts[0], pts[3]), right = d(pts[1], pts[2]);
    const ratio = ((top + bottom) / 2) / ((left + right) / 2);
    return { ratio, expected: paperW / paperH };
  }, [pts, paperW, paperH]);

  return (
    <div className="step-layout">
      <CanvasStage
        contentWidth={source.width}
        contentHeight={source.height}
        draw={draw}
        onDown={onDown}
        onMove={onMove}
        onUp={onUp}
        onHover={(e) => setHover(e.world)}
        cursor={pts.length < 4 ? 'crosshair' : 'default'}
        fitKey={source.url}
        overlay={busy ? <div className="stage-busy">{busy}</div> : null}
      />
      <aside className="panel">
        <h2>Set scale</h2>
        <p className="muted">Tell the designer which paper you used and where its corners are. Everything is measured from that.</p>
        <label className="field">
          <span>Paper size</span>
          <select value={paperId} onChange={(e) => setPaper(e.target.value)}>
            {PAPER_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        {paperId === 'custom' && (
          <div className="row">
            <label className="field"><span>Width (mm)</span><input type="number" value={customPaper.w} min={10} onChange={(e) => setCustomPaper(+e.target.value, customPaper.h)} /></label>
            <label className="field"><span>Height (mm)</span><input type="number" value={customPaper.h} min={10} onChange={(e) => setCustomPaper(customPaper.w, +e.target.value)} /></label>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} /> Paper is landscape in the photo</label>
        <div className="corner-list">
          {LABELS.map((l, i) => (
            <div key={l} className={`corner ${pts[i] ? 'set' : ''}`}>
              <span className="dot">{i + 1}</span> {l}
              <span className="muted">{pts[i] ? `${Math.round(pts[i].x)}, ${Math.round(pts[i].y)}` : 'click on the photo'}</span>
            </div>
          ))}
        </div>
        {quadInfo && Math.abs(quadInfo.ratio / quadInfo.expected - 1) > 0.25 && (
          <p className="warn">The marked quad looks {quadInfo.ratio > quadInfo.expected ? 'wider' : 'taller'} than {p.label.split(' (')[0]}. Check the paper size, the landscape toggle, or the corner order.</p>
        )}
        {status && <p className="muted small">{status}</p>}
        <div className="row">
          <button className="btn" onClick={() => setCorners(null)}>Clear corners</button>
          <button className="btn" disabled={!!busy} onClick={() => { setCorners(null); setStatus(null); imageWorker().detect(source.data, source.width, source.height).then((r) => { if (r.corners) setCorners(orderCorners(r.corners)); else setStatus('No paper found.'); }); }}>Auto-detect</button>
        </div>
        <button className="btn btn-primary wide" disabled={pts.length !== 4 || !!busy} onClick={() => void rectifyNow()}>Rectify &amp; trace tools →</button>
        <p className="muted small">Tip: scroll to zoom, drag empty space or hold Space to pan.</p>
      </aside>
    </div>
  );
}
