// All sound is synthesized with WebAudio after the first user gesture — no audio files.
// Engine hum, police siren, gunshot, pickup chime and a slow sunset pad.
export function createAudio() {
  let ctx = null, master = null, muted = false;
  let engineOsc = null, engineGain = null, sirenOsc = null, sirenGain = null, padNodes = null;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch { return false; }
  }

  function unlock() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
    startPad();
  }

  function startPad() {
    if (!ctx || padNodes) return;
    // Slow two-chord pad: Am9 -> Fmaj7, one chord every 8 seconds.
    const chords = [[220, 261.63, 329.63, 493.88], [174.61, 220, 261.63, 329.63]];
    const gains = [];
    const oscs = chords[0].map((f) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.0;
      o.connect(g); g.connect(master); o.start();
      gains.push(g);
      return o;
    });
    padNodes = { oscs, gains, chords, idx: 0, next: ctx.currentTime + 0.1 };
    const tick = () => {
      if (!ctx || !padNodes) return;
      const now = ctx.currentTime;
      if (now >= padNodes.next - 0.5) {
        const ch = padNodes.chords[padNodes.idx % 2];
        padNodes.oscs.forEach((o, i) => {
          o.frequency.setTargetAtTime(ch[i], now, 1.2);
          padNodes.gains[i].gain.setTargetAtTime(0.035, now, 1.5);
        });
        padNodes.idx += 1;
        padNodes.next = now + 8;
      }
      setTimeout(tick, 500);
    };
    tick();
  }

  function engine(speed01) {
    if (!ctx) return;
    if (!engineOsc) {
      engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      engineGain = ctx.createGain(); engineGain.gain.value = 0;
      engineOsc.connect(lp); lp.connect(engineGain); engineGain.connect(master);
      engineOsc.start();
    }
    engineOsc.frequency.setTargetAtTime(55 + speed01 * 110, ctx.currentTime, 0.08);
    engineGain.gain.setTargetAtTime(0.05 + speed01 * 0.05, ctx.currentTime, 0.1);
  }

  function engineOff() { if (engineGain) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1); }

  function siren(on) {
    if (!ctx) return;
    if (on && !sirenOsc) {
      sirenOsc = ctx.createOscillator(); sirenOsc.type = 'sine';
      sirenGain = ctx.createGain(); sirenGain.gain.value = 0.045;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 320;
      lfo.connect(lfoGain); lfoGain.connect(sirenOsc.frequency);
      sirenOsc.frequency.value = 780;
      sirenOsc.connect(sirenGain); sirenGain.connect(master);
      sirenOsc.start(); lfo.start();
      sirenOsc._lfo = lfo;
    } else if (!on && sirenOsc) {
      const o = sirenOsc, l = sirenOsc._lfo;
      sirenOsc = null;
      try { o.stop(); l.stop(); } catch { /* already stopped */ }
    }
  }

  function blip(freq, dur, type, vol, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type || 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, vol) {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = vol || 0.25;
    src.connect(g); g.connect(master);
    src.start();
  }

  return {
    unlock,
    engine, engineOff, siren,
    shot() { noiseBurst(0.12, 0.3); blip(180, 0.08, 'square', 0.1); },
    chime() { blip(660, 0.12, 'sine', 0.14); blip(880, 0.18, 'sine', 0.14, 0.1); blip(1320, 0.25, 'sine', 0.1, 0.2); },
    thud() { blip(70, 0.2, 'sine', 0.25); noiseBurst(0.08, 0.15); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() { return muted; },
  };
}
