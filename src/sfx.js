// Звук без файлов: всё синтезируется в браузере.
// Включается после первого нажатия – так требуют браузеры.
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);

    // фон – мягкий ветер пустой планеты. Без тона: прежний низкий гул из трёх нот
    // давил и «бился», шум ветра не давит и не надоедает.
    const wlen = ctx.sampleRate * 6;
    const wbuf = ctx.createBuffer(1, wlen, ctx.sampleRate);
    const w = wbuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < wlen; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; w[i] = last * 3.5; }
    const fade = ctx.sampleRate * 0.5;                // мягкая склейка петли
    for (let i = 0; i < fade; i++) { const k = i / fade; w[i] = w[i] * k + w[wlen - fade + i] * (1 - k); }
    const wind = ctx.createBufferSource(); wind.buffer = wbuf; wind.loop = true;
    wind.loopStart = fade / ctx.sampleRate; wind.loopEnd = wlen / ctx.sampleRate;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420; wf.Q.value = 0.4;
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    wind.connect(wf); wf.connect(wg); wg.connect(this.master); wind.start();
    // порывы: ветер то стихает, то чуть усиливается
    const gust = ctx.createOscillator(); gust.frequency.value = 0.05;
    const gg = ctx.createGain(); gg.gain.value = 0.025;
    gust.connect(gg); gg.connect(wg.gain); gust.start();
    const tone = ctx.createOscillator(); tone.frequency.value = 0.031;
    const tg = ctx.createGain(); tg.gain.value = 140;
    tone.connect(tg); tg.connect(wf.frequency); tone.start();

    // шум для шагов и приземления
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  noise(dur, freq, q, gain, type = 'bandpass') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.3, dur + 0.02);
  }

  tone(f0, f1, dur, gain, type = 'sine') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  step() { this.noise(0.06, 380 + Math.random() * 220, 0.9, 0.05); }   // мягкие шаги по пыли
  land() { this.noise(0.16, 180, 0.8, 0.3, 'lowpass'); }
  jump() { this.tone(280, 620, 0.16, 0.12); }
  ui() { this.tone(660, 880, 0.08, 0.06, 'triangle'); }
  pop() { this.tone(330, 990, 0.22, 0.12, 'triangle'); }
}
