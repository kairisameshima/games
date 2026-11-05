/**
 * Stop-motion foley, synthesised: the engines' drone under everything, gun bursts that land on the exposures, flak
 * thumps as each burst goes off, and the camera's shutter clicking once per exposure. Off until switched on, since a
 * browser only lets audio start from a click.
 */

/** The four Wright R-1820s' firing notes, a little apart so they beat against each other, in Hz. */
const ENGINE_NOTES = [38, 38.7, 39.5, 40.2];
const LEVELS = {
  master: 0.5, engine: 0.06, engineRumble: 0.09, gun: 0.22, flak: 0.5, shutter: 0.035, crackle: 0.18,
  fighter: 0.12, fighterGuns: 0.2, bombBurst: 0.35, crash: 0.6,
} as const;
/**
 * A fighter's BMW 801: its note, how far off it is heard (world units from the camera), and how much its pitch rises per
 * world unit a second it closes, overdone as a model's would be, so the pass reads as a pass.
 */
const FIGHTER_ENGINE = { note: 92, heardWithin: 22, dopplerPerUnit: 0.03, maxShift: 0.35, filter: 900 } as const;
const BOMB_BURST_SECONDS = 1.3;
const CRASH_SECONDS = 1.8;
/** A fire's crackle: pops this short, up to this many an exposure at full blaze. */
const CRACKLE = { seconds: 0.025, perExposure: 4 } as const;
const GUN_BURST_SECONDS = 0.07;
const FLAK_SECONDS = 0.9;
const SHUTTER_SECONDS = 0.012;

/** `value` held within 0..1. */
function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

interface Engines { gains: GainNode[]; rumble: GainNode; fighter: { gain: GainNode; oscillator: OscillatorNode } }

/** What the film did this exposure, for the foley to answer. */
export interface ExposureSounds {
  /** How many of the four engines are running. */
  enginesRunning: number;
  /** The last running engine catches and misses: hit and not yet feathered. */
  sputtering: boolean;
  /** How hard an engine is burning, 0 to 1: its crackle. */
  fire: number;
  /** 0..1 how hard the gunners are firing. */
  gunfire: number;
  flakBursts: number;
  /** The nearest fighter's distance from the camera, world units, and how fast it is closing (negative opening). */
  fighter: { distance: number; closing: number } | null;
  /** A fighter's guns flashed this exposure. */
  fighterGuns: boolean;
  /** Bombs that burst on the floor this exposure. */
  bombBursts: number;
  /** The hit fighter struck the floor this exposure. */
  crashed: boolean;
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
    this.engines.gains.forEach((gain, index) => {
      if (sounds.sputtering && index === sounds.enginesRunning - 1) {
        // Misfiring: cutting in and out from exposure to exposure.
        gain.gain.setValueAtTime(random() < 0.5 ? LEVELS.engine * 1.3 : 0, now);
        return;
      }
      gain.gain.setTargetAtTime(index < sounds.enginesRunning ? LEVELS.engine : 0, now, 0.4);
    });
    for (let pop = 0; pop < CRACKLE.perExposure; pop++) {
      if (random() < sounds.fire * 0.6) this.burst(CRACKLE.seconds, LEVELS.crackle * (0.4 + random() * 0.6), 'highpass', 1800 + random() * 2500);
    }
    this.engines.rumble.gain.setTargetAtTime((sounds.enginesRunning / ENGINE_NOTES.length) * LEVELS.engineRumble, now, 0.4);
    this.burst(SHUTTER_SECONDS, LEVELS.shutter, 'highpass', 3000);
    // Each gunner's burst is a few rounds; on an exposure, a burst goes off with the fire's strength.
    if (random() < sounds.gunfire) this.burst(GUN_BURST_SECONDS, LEVELS.gun * (0.6 + random() * 0.4), 'bandpass', 900 + random() * 500);
    for (let burst = 0; burst < sounds.flakBursts; burst++) this.burst(FLAK_SECONDS, LEVELS.flak, 'lowpass', 140);
    // The fighter howls up as it closes and drops away as it opens, louder the nearer it is.
    const { fighter } = this.engines;
    const near = sounds.fighter ? clampUnit(1 - sounds.fighter.distance / FIGHTER_ENGINE.heardWithin) ** 2 : 0;
    const shift = sounds.fighter ? Math.max(-FIGHTER_ENGINE.maxShift, Math.min(FIGHTER_ENGINE.maxShift, sounds.fighter.closing * FIGHTER_ENGINE.dopplerPerUnit)) : 0;
    fighter.gain.gain.setTargetAtTime(near * LEVELS.fighter, now, 0.08);
    fighter.oscillator.frequency.setTargetAtTime(FIGHTER_ENGINE.note * (1 + shift), now, 0.08);
    if (sounds.fighterGuns) this.burst(GUN_BURST_SECONDS, LEVELS.fighterGuns * (0.4 + near * 0.6), 'bandpass', 600 + random() * 300);
    for (let burst = 0; burst < sounds.bombBursts; burst++) this.burst(BOMB_BURST_SECONDS, LEVELS.bombBurst * (0.7 + random() * 0.3), 'lowpass', 90 + random() * 40);
    if (sounds.crashed) this.burst(CRASH_SECONDS, LEVELS.crash, 'lowpass', 220);
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

    const fighterOscillator = context.createOscillator();
    fighterOscillator.type = 'sawtooth';
    fighterOscillator.frequency.value = FIGHTER_ENGINE.note;
    const fighterFilter = context.createBiquadFilter();
    fighterFilter.type = 'lowpass';
    fighterFilter.frequency.value = FIGHTER_ENGINE.filter;
    const fighterGain = context.createGain();
    fighterGain.gain.value = 0;
    fighterOscillator.connect(fighterFilter).connect(fighterGain).connect(master);
    fighterOscillator.start();

    this.context = context;
    this.master = master;
    this.noise = noise;
    this.engines = { gains, rumble, fighter: { gain: fighterGain, oscillator: fighterOscillator } };
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
