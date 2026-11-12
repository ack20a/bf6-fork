/**
 * Procedural WebAudio Battlefield Sound Synthesizer.
 * Zero external audio files required — generates punchy gunshots, explosions,
 * hitmarkers, C4 clackers, miniguns, and Conquest objective stings in real time.
 */

export class SoundFX {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;

  public unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.noiseBuf = this.createNoiseBuffer(1.8);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  private createNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  public playRifleShot(pitchScale = 1.0, volume = 0.28): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    // Punchy low-mid transient thump
    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(195 * pitchScale, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.075);
    oGain.gain.setValueAtTime(volume * 0.9, t);
    oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(oGain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.085);

    // Supersonic crack noise burst
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1650 * pitchScale, t);
    filter.Q.value = 0.85;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(volume, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(filter).connect(nGain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + 0.14);
  }

  public playSniperShot(): void {
    this.playRifleShot(0.72, 0.44);
  }

  public playRocketLaunch(): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(420, t);
    filter.frequency.exponentialRampToValueAtTime(1400, t + 0.25);
    filter.Q.value = 1.2;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.36, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + 0.5);
  }

  public playExplosion(scale = 1.0): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const dur = Math.min(1.7, 0.85 * scale);

    // Sub-bass shockwave
    const sub = this.ctx.createOscillator();
    const subG = this.ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(92, t);
    sub.frequency.exponentialRampToValueAtTime(22, t + dur * 0.75);
    subG.gain.setValueAtTime(Math.min(0.65, 0.45 * scale), t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8);
    sub.connect(subG).connect(this.ctx.destination);
    sub.start(t);
    sub.stop(t + dur * 0.82);

    // Rumble & debris roar
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(980, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.6, 0.42 * scale), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(lp).connect(g).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  public playHitmarker(isKill = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(isKill ? 1480 : 2100, t);
    if (isKill) {
      osc.frequency.setValueAtTime(1960, t + 0.045);
    }
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (isKill ? 0.13 : 0.045));
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + (isKill ? 0.14 : 0.05));
  }

  public playC4Beep(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(2650, t);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  public playReloadClick(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.setValueAtTime(920, t + 0.04);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.095);
  }

  public playFlagCaptured(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [330, 440, 554.37, 659.25];
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, t + idx * 0.07);
      g.gain.setValueAtTime(0.08, t + idx * 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.07 + 0.35);
      osc.connect(g).connect(this.ctx!.destination);
      osc.start(t + idx * 0.07);
      osc.stop(t + idx * 0.07 + 0.36);
    });
  }
}
