import { useCallback, useEffect, useRef, useState } from 'react';
import CanvasStage, { type StageEvent, type View } from './CanvasStage';
import { useDesigner, type Tool } from '../state/store';
import { imageWorker } from '../worker/client';
import { pointInPolygon, signedArea } from '../lib/geometry';

export default function TraceStep() {
  const rect = useDesigner((s) => s.rectified)!;
  const tools = useDesigner((s) => s.tools);
  const activeId = useDesigner((s) => s.activeToolId);
  const addTool = useDesigner((s) => s.addTool);
  const removeTool = useDesigner((s) => s.removeTool);
  const updateTool = useDesigner((s) => s.updateTool);
  const setActiveTool = useDesigner((s) => s.setActiveTool);
  const setToolPolygon = useDesigner((s) => s.setToolPolygon);
  const segmenter = useDesigner((s) => s.segmenter);
  const setSegmenter = useDesigner((s) => s.setSegmenter);
  const setStep = useDesigner((s) => s.setStep);
  const autoArrange = useDesigner((s) => s.autoArrange);
  const [showImage, setShowImage] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const active = tools.find((t) => t.id === activeId) ?? null;
  const pending = useRef(new Map<string, number>());

  const runSegment = useCallback(async (tool: Tool) => {
    if (!tool.markers.some((m) => m.positive)) { setToolPolygon(tool.id, []); return; }
    const seq = (pending.current.get(tool.id) ?? 0) + 1;
    pending.current.set(tool.id, seq);
    updateTool(tool.id, { busy: true, error: undefined });
    try {
      const r = await imageWorker().segment(tool.markers, tool.tolerance, segmenter);
      if (pending.current.get(tool.id) !== seq) return; // stale
      if (r.fallback) setNotice(r.fallback);
      if (r.polygon.length < 3) updateTool(tool.id, { busy: false, error: 'Nothing found under that marker. Try a different spot or raise the tolerance.', polygonPx: [], polygonMm: [] });
      else setToolPolygon(tool.id, r.polygon);
    } catch (e) {
      updateTool(tool.id, { busy: false, error: (e as Error).message });
    }
  }, [segmenter, setToolPolygon, updateTool]);

  const onDown = (e: StageEvent) => {
    if (e.button !== 0 && e.button !== 2) return false;
    const positive = !(e.button === 2 || e.shiftKey || e.altKey);
    let tool = active;
    if (!tool || (tool.markers.length && !positive && !tool.markers.some((m) => m.positive))) tool = null;
    if (!tool) {
      // clicking inside an existing outline selects it; otherwise start a new tool
      const hitTool = tools.find((t) => t.polygonPx.length >= 3 && pointInPolygon(e.world, t.polygonPx));
      if (hitTool && positive) { setActiveTool(hitTool.id); return false; }
      const id = addTool();
      tool = useDesigner.getState().tools.find((t) => t.id === id)!;
    }
    const markers = [...tool.markers, { x: e.world.x, y: e.world.y, positive }];
    const next = { ...tool, markers };
    updateTool(tool.id, { markers });
    void runSegment(next);
    return false;
  };

  // re-segment when tolerance changes (debounced)
  const tolTimer = useRef<number | null>(null);
  const setTolerance = (tool: Tool, tolerance: number) => {
    updateTool(tool.id, { tolerance });
    if (tolTimer.current) window.clearTimeout(tolTimer.current);
    tolTimer.current = window.setTimeout(() => void runSegment({ ...tool, tolerance }), 250);
  };

  useEffect(() => () => { if (tolTimer.current) window.clearTimeout(tolTimer.current); }, []);

  const draw = useCallback((ctx: CanvasRenderingContext2D, view: View) => {
    if (rect.bitmap && showImage) ctx.drawImage(rect.bitmap, 0, 0);
    else { ctx.fillStyle = '#1b1d22'; ctx.fillRect(0, 0, rect.width, rect.height); }
    // paper rectangle
    ctx.strokeStyle = 'rgba(76,201,240,0.7)'; ctx.lineWidth = 1.5 / view.scale; ctx.setLineDash([6 / view.scale, 4 / view.scale]);
    ctx.strokeRect(rect.paperPx.x, rect.paperPx.y, rect.paperPx.w, rect.paperPx.h); ctx.setLineDash([]);
    for (const t of tools) {
      const isActive = t.id === activeId;
      if (t.polygonPx.length >= 3) {
        ctx.beginPath(); t.polygonPx.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
        ctx.fillStyle = hexA(t.color, isActive ? 0.35 : 0.22); ctx.fill();
        ctx.strokeStyle = t.color; ctx.lineWidth = (isActive ? 2.5 : 1.5) / view.scale; ctx.stroke();
      }
      for (const m of t.markers) {
        const r = 6 / view.scale;
        ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fillStyle = m.positive ? t.color : '#111'; ctx.fill();
        ctx.strokeStyle = m.positive ? '#fff' : '#ff5c5c'; ctx.lineWidth = 1.5 / view.scale; ctx.stroke();
        if (!m.positive) { ctx.beginPath(); ctx.moveTo(m.x - r * 0.5, m.y); ctx.lineTo(m.x + r * 0.5, m.y); ctx.stroke(); }
      }
    }
  }, [rect, tools, activeId, showImage]);

  const traced = tools.filter((t) => t.polygonMm.length >= 3);

  return (
    <div className="step-layout">
      <CanvasStage contentWidth={rect.width} contentHeight={rect.height} draw={draw} onDown={onDown} cursor="crosshair" fitKey={rect} />
      <aside className="panel">
        <h2>Trace tools</h2>
        <p className="muted">Click <b>New Tool</b>, then click on a tool in the photo. The outline is detected automatically. Add more clicks on multi-coloured tools; <b>right-click</b> (or Shift-click) to mark parts that should be excluded.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => addTool()}>＋ New Tool</button>
          <label className="check small"><input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} /> Show photo</label>
        </div>
        <label className="field">
          <span>Outline engine</span>
          <select value={segmenter} onChange={(e) => setSegmenter(e.target.value as 'classical' | 'sam')}>
            <option value="classical">Classical (on-device, instant)</option>
            <option value="sam">Neural (SlimSAM in browser, downloads ~40 MB)</option>
          </select>
        </label>
        {notice && <p className="warn small">{notice}</p>}
        <div className="tool-list">
          {tools.length === 0 && <p className="muted small">No tools yet.</p>}
          {tools.map((t) => (
            <div key={t.id} className={`tool-item ${t.id === activeId ? 'active' : ''}`} onClick={() => setActiveTool(t.id)}>
              <span className="swatch" style={{ background: t.color }} />
              <input className="tool-name" value={t.name} onChange={(e) => updateTool(t.id, { name: e.target.value })} onClick={(e) => e.stopPropagation()} />
              <span className="muted small">{t.busy ? '…' : t.polygonMm.length >= 3 ? `${areaCm2(t)} cm²` : `${t.markers.length ? 'no outline' : 'click tool'}`}</span>
              <button className="btn btn-icon" title="Delete" onClick={(e) => { e.stopPropagation(); removeTool(t.id); }}>✕</button>
            </div>
          ))}
        </div>
        {active && (
          <div className="subpanel">
            <h3>{active.name}</h3>
            <label className="field">
              <span>Tolerance <span className="muted">({Math.round(active.tolerance * 100)}%)</span></span>
              <input type="range" min={0} max={1} step={0.02} value={active.tolerance} onChange={(e) => setTolerance(active, +e.target.value)} />
            </label>
            <div className="row">
              <button className="btn" disabled={!active.markers.length} onClick={() => { const markers = active.markers.slice(0, -1); updateTool(active.id, { markers }); void runSegment({ ...active, markers }); }}>Undo marker</button>
              <button className="btn" disabled={!active.markers.length} onClick={() => { updateTool(active.id, { markers: [], polygonPx: [], polygonMm: [] }); }}>Clear</button>
            </div>
            {active.error && <p className="error small">{active.error}</p>}
            {active.polygonMm.length >= 3 && <p className="muted small">{dims(active)}</p>}
          </div>
        )}
        <button className="btn btn-primary wide" disabled={!traced.length} onClick={() => { autoArrange(); setStep('layout'); }}>Configure layout ({traced.length}) →</button>
        <button className="btn wide" onClick={() => setStep('scale')}>← Back to scale</button>
      </aside>
    </div>
  );
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function areaCm2(t: Tool) { return (Math.abs(signedArea(t.polygonMm)) / 100).toFixed(1); }
function dims(t: Tool) {
  const xs = t.polygonMm.map((p) => p.x), ys = t.polygonMm.map((p) => p.y);
  return `Bounding box ${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} mm · ${t.polygonMm.length} vertices`;
}
