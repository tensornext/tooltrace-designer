import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CanvasStage, { type StageEvent, type View } from './CanvasStage';
import Preview3D from './Preview3D';
import { placedOutline, useDesigner } from '../state/store';
import { buildDesign, buildMesh, downloadBlob, exportFile } from '../lib/build';
import { GF, OFFSET_PRESETS, type OffsetPreset } from '../lib/layout';
import { centroid, pointInPolygon, type Pt } from '../lib/geometry';
import type { TriMesh } from '../lib/export/mesh';

type Interaction = { kind: 'move'; id: string; start: Pt; orig: Pt } | null;

export default function LayoutStep() {
  const s = useDesigner();
  const [tab, setTab] = useState<'2d' | '3d'>('2d');
  const [placingCutout, setPlacingCutout] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('my-tools');
  const inter = useRef<Interaction>(null);

  const design = useMemo(() => buildDesign({ mode: s.mode, tools: s.tools, offsetMm: s.offsetMm, gridfinity: s.gridfinity, foam: s.foam }), [s.mode, s.tools, s.offsetMm, s.gridfinity, s.foam]);

  const [mesh, setMesh] = useState<TriMesh | null>(null);
  useEffect(() => {
    if (tab !== '3d') return;
    const t = window.setTimeout(() => setMesh(buildMesh(design)), 60);
    return () => window.clearTimeout(t);
  }, [design, tab]);

  const sel = s.tools.find((t) => t.id === selected) ?? null;

  const draw = useCallback((ctx: CanvasRenderingContext2D, view: View) => {
    const lw = 1 / view.scale;
    // container
    ctx.beginPath(); design.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.fillStyle = s.mode === 'gridfinity' ? '#2a3140' : '#3a3630'; ctx.fill();
    ctx.strokeStyle = '#8fa3bf'; ctx.lineWidth = 2 * lw; ctx.stroke();
    // grid cells for gridfinity
    if (s.mode === 'gridfinity') {
      ctx.strokeStyle = 'rgba(143,163,191,0.25)'; ctx.lineWidth = lw; ctx.setLineDash([3 * lw, 3 * lw]);
      for (let i = 1; i < s.gridfinity.unitsX; i++) { const x = i * GF.UNIT - GF.CLEARANCE / 2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, design.height); ctx.stroke(); }
      for (let j = 1; j < s.gridfinity.unitsY; j++) { const y = j * GF.UNIT - GF.CLEARANCE / 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(design.width, y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // pockets
    for (const p of design.pockets) {
      const isSel = p.tool.id === selected;
      ctx.beginPath(); p.poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
      ctx.fillStyle = p.clipped ? 'rgba(255,92,92,0.35)' : 'rgba(20,20,24,0.85)'; ctx.fill();
      ctx.strokeStyle = isSel ? '#fff' : p.tool.color; ctx.lineWidth = (isSel ? 2.5 : 1.5) * lw; ctx.stroke();
      // the tool itself
      const o = placedOutline(p.tool);
      if (o.length) { ctx.beginPath(); o.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fillStyle = hexA(p.tool.color, 0.45); ctx.fill(); }
      for (const c of p.tool.cutouts) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([2 * lw, 2 * lw]); ctx.stroke(); ctx.setLineDash([]); }
      const c = centroid(o.length ? o : p.poly);
      ctx.fillStyle = '#fff'; ctx.font = `${Math.max(3, 11 * lw)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(p.tool.name, c.x, c.y);
    }
    // dimensions
    ctx.fillStyle = '#9fb0c8'; ctx.font = `${Math.max(3, 11 * lw)}px system-ui`; ctx.textAlign = 'left';
    ctx.fillText(`${design.width.toFixed(1)} × ${design.height.toFixed(1)} mm`, 0, -6 * lw);
  }, [design, s.mode, s.gridfinity, selected]);

  const hitTool = (w: Pt) => {
    for (let i = design.pockets.length - 1; i >= 0; i--) { const p = design.pockets[i]; if (pointInPolygon(w, p.poly)) return p.tool; }
    return null;
  };
  const onDown = (e: StageEvent) => {
    if (e.button !== 0) return false;
    if (placingCutout && sel) { s.addCutout(sel.id, e.world); setPlacingCutout(false); return false; }
    const t = hitTool(e.world);
    if (!t) { setSelected(null); return false; }
    setSelected(t.id);
    inter.current = { kind: 'move', id: t.id, start: e.world, orig: { x: t.placement.x, y: t.placement.y } };
    return true;
  };
  const onMove = (e: StageEvent, dragging: boolean) => {
    const it = inter.current; if (!dragging || !it) return;
    const t = s.tools.find((x) => x.id === it.id); if (!t) return;
    const dx = e.world.x - it.start.x, dy = e.world.y - it.start.y;
    const cutouts = t.cutouts.map((c) => ({ ...c, x: c.x + (it.orig.x + dx - t.placement.x), y: c.y + (it.orig.y + dy - t.placement.y) }));
    s.updateTool(t.id, { placement: { ...t.placement, x: it.orig.x + dx, y: it.orig.y + dy }, cutouts });
  };
  const onUp = () => { inter.current = null; };

  const rotate = (t: NonNullable<typeof sel>, deg: number) => {
    // rotate cutouts with the tool about its current centroid
    const c = centroid(placedOutline(t));
    const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    const cutouts = t.cutouts.map((k) => ({ ...k, x: c.x + (k.x - c.x) * cs - (k.y - c.y) * sn, y: c.y + (k.x - c.x) * sn + (k.y - c.y) * cs }));
    s.updateTool(t.id, { placement: { ...t.placement, rotation: (t.placement.rotation + deg) % 360 }, cutouts });
  };

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches('input,select,textarea') || !sel) return;
      const step = e.shiftKey ? 5 : 1;
      if (e.key === 'ArrowLeft') s.updateTool(sel.id, { placement: { ...sel.placement, x: sel.placement.x - step } });
      else if (e.key === 'ArrowRight') s.updateTool(sel.id, { placement: { ...sel.placement, x: sel.placement.x + step } });
      else if (e.key === 'ArrowUp') s.updateTool(sel.id, { placement: { ...sel.placement, y: sel.placement.y - step } });
      else if (e.key === 'ArrowDown') s.updateTool(sel.id, { placement: { ...sel.placement, y: sel.placement.y + step } });
      else if (e.key === 'r') rotate(sel, e.shiftKey ? -15 : 15);
      else if (e.key === 'Delete' || e.key === 'Backspace') { s.removeTool(sel.id); setSelected(null); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const doExport = (fmt: 'svg' | 'dxf' | 'stl' | '3mf' | 'json') => {
    const { blob, filename } = exportFile(design, fmt, projectName);
    downloadBlob(blob, filename);
  };

  const gf = s.gridfinity;
  const totalH = design.totalHeight;

  return (
    <div className="step-layout">
      <div className="stage-col">
        <div className="tabs">
          <button className={`tab ${tab === '2d' ? 'active' : ''}`} onClick={() => setTab('2d')}>Layout</button>
          <button className={`tab ${tab === '3d' ? 'active' : ''}`} onClick={() => setTab('3d')}>3D preview</button>
          <span className="spacer" />
          <button className="btn" onClick={() => s.autoArrange()}>Auto-arrange</button>
          <button className={`btn ${placingCutout ? 'btn-primary' : ''}`} disabled={!sel} onClick={() => setPlacingCutout((v) => !v)}>{placingCutout ? 'Click on the pocket edge…' : 'Add finger cutout'}</button>
        </div>
        {tab === '2d' ? (
          <CanvasStage contentWidth={design.width} contentHeight={design.height} draw={draw} onDown={onDown} onMove={onMove} onUp={onUp} cursor={placingCutout ? 'crosshair' : 'grab'} fitKey={`${design.width}x${design.height}`} />
        ) : (
          <Preview3D mesh={mesh} />
        )}
      </div>
      <aside className="panel">
        <h2>Configure layout</h2>
        <div className="seg">
          <button className={s.mode === 'foam' ? 'active' : ''} onClick={() => { s.setMode('foam'); }}>Foam</button>
          <button className={s.mode === 'gridfinity' ? 'active' : ''} onClick={() => { s.setMode('gridfinity'); }}>Gridfinity</button>
        </div>

        <label className="field">
          <span>Offset (fit) <span className="muted">{s.offsetMm.toFixed(2)} mm</span></span>
          <div className="seg small">
            {(['small', 'medium', 'large', 'custom'] as OffsetPreset[]).map((p) => (
              <button key={p} className={s.offsetPreset === p ? 'active' : ''} onClick={() => s.setOffset(p)} title={p === 'custom' ? 'Custom' : `${OFFSET_PRESETS[p]} mm`}>{p}</button>
            ))}
          </div>
          {s.offsetPreset === 'custom' && <input type="number" step={0.1} min={0} max={10} value={s.offsetMm} onChange={(e) => s.setOffset('custom', +e.target.value)} />}
        </label>

        {s.mode === 'gridfinity' ? (
          <>
            <label className="field">
              <span>Pocket depth <span className="muted">{gf.depth} mm · bin height {totalH} mm (incl. {GF.FLOOR_THICKNESS} mm base)</span></span>
              <input type="range" min={3} max={60} step={1} value={gf.depth} onChange={(e) => s.setGridfinity({ depth: +e.target.value })} />
            </label>
            <label className="check"><input type="checkbox" checked={gf.snapHeight} onChange={(e) => s.setGridfinity({ snapHeight: e.target.checked })} /> Snap height to 7 mm units</label>
            <label className="check"><input type="checkbox" checked={s.autoUnits} onChange={(e) => { s.setAutoUnits(e.target.checked); if (e.target.checked) s.autoArrange(); }} /> Auto-size bin to tools</label>
            <div className="row">
              <label className="field"><span>Units X</span><input type="number" min={1} max={12} value={gf.unitsX} disabled={s.autoUnits} onChange={(e) => s.setGridfinity({ unitsX: Math.max(1, +e.target.value) })} /></label>
              <label className="field"><span>Units Y</span><input type="number" min={1} max={12} value={gf.unitsY} disabled={s.autoUnits} onChange={(e) => s.setGridfinity({ unitsY: Math.max(1, +e.target.value) })} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={gf.magnets} onChange={(e) => s.setGridfinity({ magnets: e.target.checked })} /> Magnet holes (6.5 × 2.4 mm)</label>
          </>
        ) : (
          <>
            <div className="row">
              <label className="field"><span>Sheet width</span><input type="number" min={20} value={s.foam.width} onChange={(e) => s.setFoam({ width: +e.target.value })} /></label>
              <label className="field"><span>Sheet height</span><input type="number" min={20} value={s.foam.height} onChange={(e) => s.setFoam({ height: +e.target.value })} /></label>
            </div>
            <div className="row">
              <label className="field"><span>Thickness</span><input type="number" min={1} value={s.foam.thickness} onChange={(e) => s.setFoam({ thickness: +e.target.value })} /></label>
              <label className="field"><span>Pocket depth</span><input type="number" min={1} value={s.foam.depth} onChange={(e) => s.setFoam({ depth: +e.target.value })} /></label>
            </div>
            <div className="row">
              <label className="field"><span>Edge margin</span><input type="number" min={0} value={s.foam.margin} onChange={(e) => s.setFoam({ margin: +e.target.value })} /></label>
              <label className="field"><span>Corner radius</span><input type="number" min={0} value={s.foam.cornerRadius} onChange={(e) => s.setFoam({ cornerRadius: +e.target.value })} /></label>
            </div>
          </>
        )}
        <div className="row">
          <label className="field"><span>Spacing</span><input type="number" min={0} step={0.5} value={s.gap} onChange={(e) => s.setGap(+e.target.value)} /></label>
          <label className="field"><span>Finger Ø</span><input type="number" min={4} step={1} value={s.fingerRadius * 2} onChange={(e) => s.setFingerRadius(+e.target.value / 2)} /></label>
        </div>

        {sel && (
          <div className="subpanel">
            <h3>{sel.name}</h3>
            <label className="field">
              <span>Rotation <span className="muted">{Math.round(sel.placement.rotation)}°</span></span>
              <input type="range" min={0} max={359} value={((sel.placement.rotation % 360) + 360) % 360} onChange={(e) => rotate(sel, +e.target.value - sel.placement.rotation)} />
            </label>
            <div className="row">
              <button className="btn" onClick={() => rotate(sel, 90)}>Rotate 90°</button>
              <button className="btn" onClick={() => { s.removeTool(sel.id); setSelected(null); }}>Remove</button>
            </div>
            {sel.cutouts.length > 0 && (
              <div className="cutouts">
                {sel.cutouts.map((c, i) => <button key={c.id} className="chip" onClick={() => s.removeCutout(sel.id, c.id)}>cutout {i + 1} ✕</button>)}
              </div>
            )}
            <p className="muted small">Drag to move · arrows nudge (Shift = 5 mm) · R rotates 15°</p>
          </div>
        )}

        {design.warnings.length > 0 && <ul className="warn small">{design.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}

        <div className="subpanel">
          <h3>Export</h3>
          <label className="field"><span>File name</span><input value={projectName} onChange={(e) => setProjectName(e.target.value)} /></label>
          {s.mode === 'gridfinity' ? (
            <div className="row">
              <button className="btn btn-primary" onClick={() => doExport('stl')}>STL</button>
              <button className="btn btn-primary" onClick={() => doExport('3mf')}>3MF</button>
              <button className="btn" onClick={() => doExport('svg')}>SVG</button>
              <button className="btn" onClick={() => doExport('dxf')}>DXF</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn btn-primary" onClick={() => doExport('dxf')}>DXF</button>
              <button className="btn btn-primary" onClick={() => doExport('svg')}>SVG</button>
              <button className="btn" onClick={() => doExport('stl')}>STL</button>
            </div>
          )}
          <button className="btn wide small" onClick={() => doExport('json')}>Outlines as JSON</button>
          <p className="muted small">Files are generated entirely on your device. STEP export is not implemented (needs a B-rep kernel).</p>
        </div>
        <button className="btn wide" onClick={() => s.setStep('trace')}>← Back to tracing</button>
      </aside>
    </div>
  );
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
