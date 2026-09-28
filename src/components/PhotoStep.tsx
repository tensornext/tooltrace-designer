import { useRef, useState } from 'react';
import { useDesigner } from '../state/store';

export async function decodeImageFile(file: File, maxDim = 2400): Promise<{ width: number; height: number; url: string; data: Uint8ClampedArray }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  const url = c.toDataURL('image/jpeg', 0.9);
  return { width: w, height: h, url, data };
}

export default function PhotoStep() {
  const setSource = useDesigner((s) => s.setSource);
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (file?: File | null) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try { setSource(await decodeImageFile(file)); }
    catch (e) { setErr(`Could not read that image: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const demo = async () => {
    setBusy(true);
    try {
      const { makeDemoPhoto } = await import('../lib/demo');
      setSource(await makeDemoPhoto());
    } finally { setBusy(false); }
  };

  return (
    <div className="photo-step">
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void load(e.dataTransfer.files[0]); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => void load(e.target.files?.[0])} />
        <div className="dz-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1.5 1.5 0 0 0 1.25-.67l.6-.9A1.5 1.5 0 0 1 9.8 4.8h4.4a1.5 1.5 0 0 1 1.25.67l.6.9A1.5 1.5 0 0 0 17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
            <circle cx="12" cy="13" r="3.2" />
          </svg>
        </div>
        <h2>{busy ? 'Reading photo…' : 'Drop a photo here, or click to choose'}</h2>
        <p>JPG, PNG or HEIC-converted photos. Shot straight from above, with a sheet of paper in frame.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Choose photo</button>
          <button className="btn" onClick={(e) => { e.stopPropagation(); void demo(); }}>Try a demo photo</button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
      <div className="tips">
        <h3>How to take the photo</h3>
        <ol>
          <li><b>Lay a sheet of paper flat</b> (A4 or US Letter) and place your tools on or next to it. The paper is the scale reference.</li>
          <li><b>Shoot straight down.</b> Keep the camera parallel to the table to minimise perspective error; the paper corners fix the rest.</li>
          <li><b>Good, even light.</b> Avoid hard shadows; shadows read as part of the tool.</li>
          <li><b>Contrast helps.</b> Dark tools on white paper trace best. Light-coloured tools work but may need extra markers.</li>
        </ol>
      </div>
    </div>
  );
}
