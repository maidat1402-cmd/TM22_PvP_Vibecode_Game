// Âm thanh tổng hợp bằng WebAudio (không cần file âm thanh => cực nhẹ).
let ctx = null, master = null, noiseBuf = null;
let volume = 0.5;

export function initAudio() {
  if (ctx) { if (ctx.state !== 'running') ctx.resume(); return; }   // iOS: cuộc gọi/chuyển app để ctx ở 'interrupted'
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolume(v) { volume = v; if (master) master.gain.value = v; }

function env(g, t, a, peak, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone(type, f0, f1, dur, vol, out) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, 0.01, vol, dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, vol, out, filter = 'lowpass', f0 = 2000, f1 = 300, q = 1) {
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = filter; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, 0.005, vol, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}

// vol giảm theo khoảng cách tới camera
function bus(dist = 0) {
  const g = ctx.createGain();
  g.gain.value = Math.max(0, 1 - dist / 45);
  g.connect(master);
  return g;
}

const SFX = {
  swing: o => noise(0.15, 0.5, o, 'bandpass', 3000, 900, 2),
  punch: o => { noise(0.1, 0.6, o, 'lowpass', 1500, 200); tone('sine', 160, 60, 0.12, 0.5, o); },
  hit: o => { noise(0.12, 0.7, o, 'lowpass', 3000, 300); tone('square', 220, 70, 0.1, 0.25, o); },
  bigHit: o => { noise(0.3, 0.8, o, 'lowpass', 2500, 100); tone('sine', 120, 40, 0.3, 0.7, o); },
  throw: o => noise(0.12, 0.35, o, 'highpass', 4000, 2000, 1),
  blast: o => { tone('sawtooth', 600, 120, 0.25, 0.25, o); noise(0.2, 0.3, o, 'bandpass', 2000, 500, 1); },
  beam: o => { tone('sawtooth', 110, 90, 1.3, 0.3, o); tone('square', 220, 180, 1.3, 0.12, o); noise(1.2, 0.35, o, 'bandpass', 1200, 900, 0.7); },
  charge: o => { tone('sine', 200, 900, 0.7, 0.25, o); },
  explosion: o => { noise(0.9, 1.0, o, 'lowpass', 1800, 60); tone('sine', 90, 30, 0.8, 0.8, o); },
  fire: o => { noise(0.5, 0.6, o, 'bandpass', 900, 300, 0.6); tone('sawtooth', 140, 70, 0.4, 0.15, o); },
  ice: o => { tone('triangle', 1800, 2600, 0.25, 0.2, o); tone('sine', 2400, 1200, 0.35, 0.15, o); noise(0.2, 0.3, o, 'highpass', 6000, 3000, 1); },
  wind: o => noise(0.8, 0.5, o, 'bandpass', 600, 1800, 1.5),
  jump: o => tone('sine', 300, 700, 0.12, 0.2, o),
  dash: o => noise(0.2, 0.4, o, 'bandpass', 800, 3000, 1),
  heal: o => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => ctx && tone('sine', f, f, 0.35, 0.18, o), i * 80)); },
  die: o => { tone('sawtooth', 400, 60, 0.8, 0.3, o); noise(0.6, 0.5, o, 'lowpass', 1500, 100); },
  respawn: o => { [392, 523, 784].forEach((f, i) => setTimeout(() => ctx && tone('triangle', f, f, 0.3, 0.2, o), i * 90)); },
  ui: o => tone('sine', 880, 1200, 0.06, 0.15, o),
  // ---- Bắn súng ----
  pistol: o => { noise(0.12, 0.7, o, 'bandpass', 2200, 500, 0.8); tone('square', 320, 80, 0.07, 0.2, o); },
  heavy: o => { noise(0.22, 0.9, o, 'lowpass', 2600, 150); tone('sine', 180, 45, 0.18, 0.6, o); },
  smg: o => { noise(0.07, 0.55, o, 'bandpass', 2600, 900, 0.8); tone('square', 260, 120, 0.04, 0.12, o); },
  rifle: o => { noise(0.16, 0.8, o, 'lowpass', 3200, 220); tone('sine', 160, 50, 0.12, 0.45, o); },
  rifle2: o => { noise(0.14, 0.7, o, 'lowpass', 2600, 300); tone('triangle', 200, 70, 0.1, 0.35, o); },
  shotgun: o => { noise(0.35, 1.0, o, 'lowpass', 2200, 70); tone('sine', 120, 35, 0.3, 0.7, o); },
  sniper: o => { noise(0.55, 1.0, o, 'lowpass', 4000, 60); tone('sine', 110, 30, 0.5, 0.8, o); noise(0.05, 0.6, o, 'highpass', 6000, 4000); },
  knife: o => noise(0.12, 0.45, o, 'bandpass', 4000, 1500, 2),
  empty: o => tone('square', 1400, 1300, 0.03, 0.12, o),
  reload: o => { tone('square', 700, 500, 0.04, 0.12, o); setTimeout(() => ctx && tone('square', 900, 700, 0.05, 0.14, o), 350); },
  step: o => noise(0.06, 0.25, o, 'lowpass', 500, 120),
  beep: o => tone('sine', 1650, 1650, 0.09, 0.25, o),
  plant: o => { [900, 1100, 1300].forEach((f, i) => setTimeout(() => ctx && tone('square', f, f, 0.05, 0.1, o), i * 120)); },
  headshot: o => { tone('sine', 2200, 1800, 0.15, 0.25, o); noise(0.08, 0.5, o, 'highpass', 5000, 3000); },
  hitmark: o => tone('triangle', 1600, 1200, 0.05, 0.18, o),
  buy: o => { tone('sine', 660, 990, 0.08, 0.15, o); },
  clink: o => { tone('triangle', 2400, 1800, 0.06, 0.12, o); tone('square', 900, 700, 0.03, 0.05, o); },
  toss: o => noise(0.18, 0.35, o, 'bandpass', 900, 2500, 1.2),
  flashbang: o => { noise(0.25, 1.0, o, 'highpass', 3000, 1500); tone('sine', 3800, 3600, 2.2, 0.12, o); },
  smokepop: o => { noise(1.4, 0.45, o, 'lowpass', 1200, 200); },
  pickup: o => { tone('square', 500, 800, 0.05, 0.12, o); setTimeout(() => ctx && tone('square', 800, 1000, 0.05, 0.1, o), 70); },
  error: o => tone('square', 200, 150, 0.12, 0.12, o),
};

export function sfx(name, dist = 0) {
  if (!ctx || !SFX[name]) return;
  if (dist > 45) return;
  try { SFX[name](bus(dist)); } catch { /* bỏ qua */ }
}

// Âm thanh theo loại hiệu ứng chiêu
export function skillSound(skill) {
  const k = skill.fx.kind;
  if (skill.bigCharge) return 'charge';   // tuyệt kỹ dị biến: tiếng tụ lực
  if (skill.type === 'melee') return k === 'impact' || k === 'quakePunch' ? 'punch' : 'swing';
  if (k === 'kiFist') return 'punch';
  if (k === 'spearRod' || k === 'pillarThrow') return 'throw';
  if (skill.type === 'wall') return 'wind';
  if (/winter|tomb/i.test(k)) return 'ice';
  if (k === 'beam' || /bolt|lightning|thunder/i.test(k)) return 'beam';
  if (/rock|quake|meteor|stone/i.test(k)) return k === 'rock' ? 'throw' : k === 'rockRoll' ? 'dash' : 'blast';
  if (/thorn|vine|bloom|petal|mist|seed|tree|stealth|shadow|flower/i.test(k)) return 'wind';
  if (k === 'flurry') return 'dash';
  if (k === 'stoneSkin') return 'charge';
  if (/fire|flame|phoenix|crescent/i.test(k)) return 'fire';
  if (/ice|frost|icicle/i.test(k)) return 'ice';
  if (/tornado|blade|shuriken/i.test(k)) return k === 'shuriken' ? 'throw' : 'wind';
  if (k === 'bigBomb') return 'charge';
  if (skill.type === 'dash') return 'dash';
  return 'blast';
}
