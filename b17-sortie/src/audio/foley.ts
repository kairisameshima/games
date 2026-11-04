/**
 * Stop-motion foley, synthesised: the engines' drone under everything, gun bursts that land on the exposures, flak
 * thumps as each burst goes off, and the camera's shutter clicking once per exposure. Off until switched on, since a
 * browser only lets audio start from a click.
 */

/** The four Wright R-1820s' firing notes, a little apart so they beat against each other, in Hz. */
const ENGINE_NOTES = [38, 38.7, 39.5, 40.2];
const LEVELS = { master: 0.5, engine: 0.06, engineRumble: 0.09, gun: 0.22, flak: 0.5, shutter: 0.035 } as const;
const GUN_BURST_SECONDS = 0.07;
const FLAK_SECONDS = 0.9;
const SHUTTER_SECONDS = 0.012;

interface Engines { gains: GainNode[]; rumble: GainNode }

/** What the film did this exposure, for the foley to answer. */
export interface ExposureSounds {
  /** How many of the four engines are running. */
  enginesRunning: number;
  /** 0..1 how hard the gunners are firing. */
  gunfire: number;
  flakBursts: number;
}

export class Foley {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engines: Engines | null = null;

  get enabled(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /** Switches the sound on or off; on the first call it builds the audio graph, so call it from a click. */
  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.context?.suspend();
      return;
    }
    if (!this.context) this.build();
    await this.context?.resume();
  }

  /** Answers one exposure. Does nothing while the sound is off. */
  expose(sounds: ExposureSounds, random: () => number): void {
    if (!this.enabled || !this.context || !this.engines) return;
    const now = this.context.currentTime;
    this.engines.gains.forEach((gain, index) => gain.gain.setTargetAtTime(index < sounds.enginesRunning ? LEVELS.engine : 0, now, 0.4));
    this.engines.rumble.gain.setTargetAtTime((sounds.enginesRunning / ENGINE_NOTES.length) * LEVELS.engineRumble, now, 0.4);
    this.burst(SHUTTER_SECONDS, LEVELS.shutter, 'highpass', 3000);
    // Each gunner's burst is a few rounds; on an exposure, a burst goes off with the fire's strength.
    if (random() < sounds.gunfire) this.burst(GUN_BURST_SECONDS, LEVELS.gun * (0.6 + random() * 0.4), 'bandpass', 900 + random() * 500);
    for (let burst = 0; burst < sounds.flakBursts; burst++) this.burst(FLAK_SECONDS, LEVELS.flak, 'lowpass', 140);
  }

  private build(): void {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = LEVELS.master;
    master.connect(context.destination);
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;

    const engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 240;
    engineFilter.connect(master);
    const gains = ENGINE_NOTES.map(() => {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(engineFilter);
      return gain;
    });
    ENGINE_NOTES.forEach((note, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = note;
      oscillator.connect(gains[index]);
      oscillator.start();
    });
    const rumbleSource = context.createBufferSource();
    rumbleSource.buffer = noise;
    rumbleSource.loop = true;
    const rumbleFilter = context.createBiquadFilter();
    rumbleFilter.type = 'bandpass';
    rumbleFilter.frequency.value = 110;
    const rumble = context.createGain();
    rumble.gain.value = 0;
    rumbleSource.connect(rumbleFilter).connect(rumble).connect(master);
    rumbleSource.start();

    this.context = context;
    this.master = master;
    this.noise = noise;
    this.engines = { gains, rumble };
  }

  /** A short filtered noise burst with a fast decay. */
  private burst(seconds: number, level: number, type: BiquadFilterType, frequency: number): void {
    if (!this.context || !this.master || !this.noise) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now, Math.random() * 1.5, seconds);
  }
}
