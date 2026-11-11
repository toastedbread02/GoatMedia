/**
 * The sound that arrives with the glitch. It is built at call time rather than
 * loaded from a file: a falling rumble under two detuned tones that beat against
 * each other, and one short breath of filtered noise on top. Roughly a second
 * and a half, low in the mix, and silent if the browser will not give us audio.
 */

let context: AudioContext | null = null;

type AudioContextCtor = typeof AudioContext;

function getContext(): AudioContext | null {
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  context = context ?? new Ctor();
  return context;
}

export function playProfileGlitch() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    master.connect(ctx.destination);

    // The floor of it: a tone that sinks out of hearing.
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.setValueAtTime(74, now);
    rumble.frequency.exponentialRampToValueAtTime(31, now + 1.3);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.55, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.02, now + 1.4);
    rumble.connect(rumbleGain).connect(master);

    // Two tones a hair apart, so they beat instead of settling.
    [196, 207.65].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(frequency, now);
      osc.detune.setValueAtTime(index === 0 ? -11 : 13, now);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(430, now);
      band.frequency.exponentialRampToValueAtTime(210, now + 0.9);
      band.Q.value = 7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.085, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
      osc.connect(band).connect(gain).connect(master);
      osc.start(now);
      osc.stop(now + 1.05);
    });

    // One breath of tape hiss, swept down and gone.
    const frames = Math.floor(ctx.sampleRate * 0.62);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      const falloff = 1 - i / frames;
      data[i] = (Math.random() * 2 - 1) * falloff * falloff;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const sweep = ctx.createBiquadFilter();
    sweep.type = 'highpass';
    sweep.frequency.setValueAtTime(2400, now);
    sweep.frequency.exponentialRampToValueAtTime(180, now + 0.58);
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.14;
    noise.connect(sweep).connect(noiseGain).connect(master);
    noise.start(now);

    rumble.start(now);
    rumble.stop(now + 1.45);
  } catch {
    /* sound is a bonus; the page never depends on it */
  }
}
