import { useDesigner, STEPS, type Step } from './state/store';
import PhotoStep from './components/PhotoStep';
import ScaleStep from './components/ScaleStep';
import TraceStep from './components/TraceStep';
import LayoutStep from './components/LayoutStep';

export default function App() {
  const step = useDesigner((s) => s.step);
  const setStep = useDesigner((s) => s.setStep);
  const source = useDesigner((s) => s.source);
  const rectified = useDesigner((s) => s.rectified);
  const tools = useDesigner((s) => s.tools);
  const reset = useDesigner((s) => s.reset);

  const enabled: Record<Step, boolean> = {
    photo: true,
    scale: !!source,
    trace: !!rectified,
    layout: tools.some((t) => t.polygonMm.length >= 3),
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo">◱</span> Tooltrace <span className="muted">Designer</span> <span className="badge">open reimplementation</span></div>
        <nav className="steps">
          {STEPS.map((s, i) => (
            <button key={s.id} className={`step ${step === s.id ? 'current' : ''} ${enabled[s.id] ? '' : 'disabled'}`} disabled={!enabled[s.id]} onClick={() => setStep(s.id)} title={s.hint}>
              <span className="num">{i + 1}</span> {s.label}
            </button>
          ))}
        </nav>
        <div className="row">
          <button className="btn small" onClick={() => { if (!source || confirm('Start over? Your traced tools will be lost.')) reset(); }}>New design</button>
          <a className="btn small" href="https://github.com/heavymidget/graph-inference-poc" target="_blank" rel="noreferrer">Source</a>
        </div>
      </header>
      <main className="content">
        {step === 'photo' && <PhotoStep />}
        {step === 'scale' && source && <ScaleStep />}
        {step === 'trace' && rectified && <TraceStep />}
        {step === 'layout' && <LayoutStep />}
      </main>
    </div>
  );
}
