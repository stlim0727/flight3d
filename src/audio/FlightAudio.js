import { DepartureRadio } from './DepartureRadio.js';
import { pistonSoundState } from './pistonSoundState.js';
import { exteriorDistanceGain, exteriorAirCutoff } from './distanceAcoustics.js';
import { t } from '../i18n/index.js';
/**
 * Aircraft-specific procedural Web Audio: turbofan or piston/propeller.
 * Synthesizes twin turbofan engines (combustion roar + N1/N2 turbine whine), aerodynamic airflow slipstream,
 * cockpit air conditioning & avionics cooling pack blower, runway rumble, touchdown tire screech & oleo thump,
 * stall horn, and Boeing GPWS voice callouts.
 * Uses dynamic range compression with normal-volume and muted output states.
 * Exterior camera views attenuate this mix by camera-to-aircraft distance.
 */
export class FlightAudio {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isPaused = false;
    this.isInitialized = false;

    this.volume = 1.0;

    this.departureRadio = new DepartureRadio({
      context: () => this.ctx, output: () => this.masterGain,
      muted: () => this.isMuted || this.volume === 0,
      baseUrl: import.meta.env?.BASE_URL ?? '/',
    });

    // Callout tracking
    this.lastRadioAlt = 9999;
    this.calledAltitudes = new Set();
    this.stallBeepTime = 0;
    this.loadAircraftConfig();
  }

  loadAircraftConfig(config = {}) {
    this.aircraftId = config.id || 'B738';
    const settings = config.audio || {};
    this.profile = {
      engineType: settings.engineType || 'jet',
      idleN1: config.propulsion?.idleN1Percent ?? 22,
      maxN1: config.propulsion?.togaN1Percent ?? 100,
      idleRpm: settings.idleRpm ?? 700,
      maxRpm: settings.maxRpm ?? 2700,
      cylinders: settings.cylinders ?? 4,
      propellerBlades: settings.propellerBlades ?? 2,
    };
    this.reset();
    // Do not wait for the next render frame to remove the previous aircraft's
    // signature. The same audio graph is reused across any number of switches.
    this.silenceEngines();
  }

  get isPiston() { return this.profile.engineType === 'piston'; }

  cancelSpeech() {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel?.();
  }

  reset() {
    this.crashed = false;
    this.lastTouchdownTime = -Infinity;
    this.touchdownActive = false;
    this.alertId = null;
    this.alertTimer = 0;
    this.alertElapsed = 0;
    this.lastRadioAlt = 9999;
    this.calledAltitudes.clear();
    this.stallBeepTime = 0;
    this.cancelSpeech();
    this.departureRadio.stop();
    if (this.packGain) this.packGain.gain.setTargetAtTime(this.isPiston ? 0 : 0.16, this.ctx.currentTime, 0.04);
    if (this.warningGain) this.warningGain.gain.setValueAtTime(0, this.ctx.currentTime);
  }

  silenceEngines() {
    if (!this.ctx) return;
    for (const name of ['engineGain', 'turbineGain', 'turbineGain2', 'pistonGain', 'propGain', 'propModGain']) {
      this[name]?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
  }

  get effectiveVolume() {
    if (this.isMuted || this.isPaused) return 0.0;
    return this.volume;
  }

  init(context = null) {
    if (this.isInitialized) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = context || new AudioContext();

      // Listen for audio route changes (e.g. Bluetooth connection/interruption)
      if (typeof this.ctx.onstatechange !== 'undefined') {
        this.ctx.onstatechange = () => {
          if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) {
            this.ctx.resume().catch(() => {});
          }
        };
      }

      // 1. Dynamic Range Compressor (Studio Mastering Limiter)
      // Controls loud transients (touchdown, explosions) while allowing overall mix to be loud
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(8, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.002, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.18, this.ctx.currentTime);

      // 2. Unity output stage (no volume boost)
      this.makeupGain = this.ctx.createGain();
      this.makeupGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

      // 3. Master Gain Node (user volume control)
      this.masterGain = this.ctx.createGain();
      const initialGain = this.effectiveVolume;
      this.masterGain.gain.setValueAtTime(initialGain, this.ctx.currentTime);

      // Mastering signal chain: sources -> cockpitFilter -> distanceGain -> masterGain -> compressor -> makeupGain -> destination
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.makeupGain);
      this.makeupGain.connect(this.ctx.destination);

      // 4. Cockpit Interior Acoustic Filter (muffles exterior roar inside cockpit)
      this.cockpitFilter = this.ctx.createBiquadFilter();
      this.cockpitFilter.type = 'lowpass';
      this.cockpitFilter.frequency.setValueAtTime(2800, this.ctx.currentTime);

      // 4b. Distance stage: exterior views attenuate with camera-to-aircraft range,
      // so a distant tower view hears a quieter, duller flyby than chase cam.
      this.distanceGain = this.ctx.createGain();
      this.distanceGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.cockpitFilter.connect(this.distanceGain);
      this.distanceGain.connect(this.masterGain);

      // 5. Cockpit Avionics Cooling Fan & Air Conditioning Packs (Continuous ambient hum)
      this.initPackSynth();

      // 6. Turbofan Jet Engine Synthesizer (Pink Noise Roar + Twin Spool Whine)
      this.initEngineSynth();
      this.initPistonSynth();

      // 7. Airflow / Wind Slipstream Synthesizer
      this.initWindSynth();

      // 8. Ground Roll Rumble & Touchdown Screech
      this.initGroundSynth();

      // 9. Cockpit Warning Tone Oscillator
      this.initWarningSynth();

      this.isInitialized = true;
      for (const name of ['engineGain', 'turbineGain', 'turbineGain2', 'pistonGain', 'propGain', 'propModGain']) {
        this[name].gain.setValueAtTime(0, this.ctx.currentTime);
      }
      this.packGain.gain.setValueAtTime(this.isPiston || this.crashed ? 0 : 0.16, this.ctx.currentTime);
    } catch (e) {
      console.warn('Web Audio initialization error:', e);
    }
  }

  ensureContextRunning() {
    if (this.ctx) {
      // iOS WebKit can be in 'interrupted' state on Bluetooth route switches
      if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
        this.ctx.resume().catch(() => {});
      }
    }
  }

  initPackSynth() {
    // Continuous cockpit air conditioning and avionics cooling fan airflow
    // Prevents dead silence when parked or at low idle on headphones/Bluetooth
    const bufferSize = this.ctx.sampleRate * 2;
    const packBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = packBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.45;
    }

    this.packNoise = this.ctx.createBufferSource();
    this.packNoise.buffer = packBuffer;
    this.packNoise.loop = true;

    this.packFilter = this.ctx.createBiquadFilter();
    this.packFilter.type = 'bandpass';
    this.packFilter.frequency.setValueAtTime(580, this.ctx.currentTime);
    this.packFilter.Q.setValueAtTime(0.8, this.ctx.currentTime);

    this.packGain = this.ctx.createGain();
    this.packGain.gain.setValueAtTime(0.16, this.ctx.currentTime);

    this.packNoise.connect(this.packFilter);
    this.packFilter.connect(this.packGain);
    this.packGain.connect(this.cockpitFilter);
    this.packNoise.start();
  }

  initEngineSynth() {
    // Generate pink noise buffer for turbofan combustion & bypass exhaust roar
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    let maxVal = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      if (Math.abs(output[i]) > maxVal) maxVal = Math.abs(output[i]);
    }
    // Normalize to peak 0.92 for robust healthy signal level across all audio gear
    if (maxVal > 0) {
      const norm = 0.92 / maxVal;
      for (let i = 0; i < bufferSize; i++) {
        output[i] *= norm;
      }
    }

    this.engineNoiseBuffer = noiseBuffer;

    // Engine Roar Source
    this.engineNoise = this.ctx.createBufferSource();
    this.engineNoise.buffer = noiseBuffer;
    this.engineNoise.loop = true;

    // Combustion low-pass filter: 280 Hz (idle) up to 950 Hz (TOGA)
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(320, this.ctx.currentTime);
    this.engineFilter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.38, this.ctx.currentTime);

    this.engineNoise.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.cockpitFilter);
    this.engineNoise.start();

    // Primary N1 Low-Pressure Fan Compressor Whine (Sine Oscillator)
    this.turbineWhine = this.ctx.createOscillator();
    this.turbineWhine.type = 'sine';
    this.turbineWhine.frequency.setValueAtTime(450, this.ctx.currentTime);

    this.turbineGain = this.ctx.createGain();
    this.turbineGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

    this.turbineWhine.connect(this.turbineGain);
    this.turbineGain.connect(this.cockpitFilter);
    this.turbineWhine.start();

    // Secondary N2 High-Pressure Core Compressor Whine & Harmonics (Triangle Oscillator)
    // Adds characteristic twin-spool buzz & harmonic clarity on mobile & Bluetooth headphones
    this.turbineWhine2 = this.ctx.createOscillator();
    this.turbineWhine2.type = 'triangle';
    this.turbineWhine2.frequency.setValueAtTime(900, this.ctx.currentTime);

    this.turbineGain2 = this.ctx.createGain();
    this.turbineGain2.gain.setValueAtTime(0.04, this.ctx.currentTime);

    this.turbineWhine2.connect(this.turbineGain2);
    this.turbineGain2.connect(this.cockpitFilter);
    this.turbineWhine2.start();
  }

  initPistonSynth() {
    // A short pressure pulse repeated at the four-stroke firing rate. Harmonics
    // provide the exhaust's throaty "putter", without N1/N2 whistle oscillators.
    const real = new Float32Array(33), imaginary = new Float32Array(33);
    for (let harmonic = 1; harmonic < real.length; harmonic++) {
      real[harmonic] = 1 / (1 + (harmonic / 5) ** 2);
      imaginary[harmonic] = -0.35 * real[harmonic];
    }
    this.pistonPulse = this.ctx.createOscillator();
    this.pistonPulse.setPeriodicWave(this.ctx.createPeriodicWave(real, imaginary));
    this.pistonPulse.frequency.setValueAtTime(24, this.ctx.currentTime);
    this.pistonFilter = this.ctx.createBiquadFilter();
    this.pistonFilter.type = 'lowpass';
    this.pistonFilter.frequency.setValueAtTime(1800, this.ctx.currentTime);
    this.pistonFilter.Q.setValueAtTime(0.7, this.ctx.currentTime);
    this.pistonGain = this.ctx.createGain();
    this.pistonGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.pistonPulse.connect(this.pistonFilter);
    this.pistonFilter.connect(this.pistonGain);
    this.pistonGain.connect(this.cockpitFilter);
    this.pistonPulse.start();

    // Propeller air noise is amplitude-modulated by blade passage, not pitched
    // up into a turbine whine. Reuse the existing noise buffer, without a download.
    this.propNoise = this.ctx.createBufferSource();
    this.propNoise.buffer = this.engineNoiseBuffer;
    this.propNoise.loop = true;
    this.propFilter = this.ctx.createBiquadFilter();
    this.propFilter.type = 'bandpass';
    this.propFilter.frequency.setValueAtTime(550, this.ctx.currentTime);
    this.propFilter.Q.setValueAtTime(0.6, this.ctx.currentTime);
    this.propGain = this.ctx.createGain();
    this.propGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.propNoise.connect(this.propFilter);
    this.propFilter.connect(this.propGain);
    this.propGain.connect(this.cockpitFilter);
    this.propBeat = this.ctx.createOscillator();
    this.propBeat.type = 'sine';
    this.propBeat.frequency.setValueAtTime(24, this.ctx.currentTime);
    this.propModGain = this.ctx.createGain();
    this.propModGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.propBeat.connect(this.propModGain);
    this.propModGain.connect(this.propGain.gain);
    this.propBeat.start();
    this.propNoise.start();
  }

  updatePiston(state, now) {
    const sound = pistonSoundState(state.engine1, state.iasKnots || 0, this.profile);
    const rotor = Math.min(1, sound.rpm / this.profile.maxRpm);
    this.pistonPulse.frequency.setTargetAtTime(Math.max(1, sound.firingHz), now, 0.06);
    this.pistonFilter.frequency.setTargetAtTime(1100 + sound.power * 1500, now, 0.08);
    this.pistonGain.gain.setTargetAtTime(sound.combustion * (0.32 + sound.power * 0.40), now, 0.10);
    this.propBeat.frequency.setTargetAtTime(Math.max(1, sound.bladeHz), now, 0.06);
    this.propFilter.frequency.setTargetAtTime(350 + rotor * 700, now, 0.10);
    const air = rotor * (sound.combustion ? 1 : 0.2);
    this.propGain.gain.setTargetAtTime(air * (0.08 + sound.power * 0.12), now, 0.10);
    this.propModGain.gain.setTargetAtTime(air * (0.04 + sound.power * 0.06), now, 0.10);
  }

  initWindSynth() {
    // Airflow noise buffer
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.55;
    }

    this.windNoise = this.ctx.createBufferSource();
    this.windNoise.buffer = noiseBuffer;
    this.windNoise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.setValueAtTime(800, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.cockpitFilter);
    this.windNoise.start();
  }

  initGroundSynth() {
    // Runway rolling rumble noise source
    const bufferSize = this.ctx.sampleRate * 2;
    const rumbleBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const rData = rumbleBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      rData[i] = (Math.random() * 2 - 1) * 0.6;
    }

    this.rumbleNoise = this.ctx.createBufferSource();
    this.rumbleNoise.buffer = rumbleBuffer;
    this.rumbleNoise.loop = true;

    this.rumbleFilter = this.ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.setValueAtTime(260, this.ctx.currentTime);
    this.rumbleFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.rumbleNoise.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.cockpitFilter);
    this.rumbleNoise.start();
  }

  initWarningSynth() {
    this.warningOsc = this.ctx.createOscillator();
    this.warningOsc.type = 'sawtooth';
    this.warningOsc.frequency.setValueAtTime(680, this.ctx.currentTime);

    this.warningGain = this.ctx.createGain();
    this.warningGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.warningOsc.connect(this.warningGain);
    this.warningGain.connect(this.masterGain);
    this.warningOsc.start();
  }

  // Broadband friction/structural transients: no pitched oscillators or
  // frequency sweeps, which sound like laser chirps rather than wheel contact.
  playContactNoise(duration, frequency, level, type = 'lowpass') {
    if (!this.ctx || this.effectiveVolume === 0) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    const buffer = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * duration), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const attack = 0.008;
    for (let i = 0; i < data.length; i++) {
      const time = i / this.ctx.sampleRate;
      const envelope = Math.min(1, time / attack) * Math.exp(-6 * time / duration);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, now);
    filter.Q.setValueAtTime(0.7, now);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level, now);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.cockpitFilter);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(now);
    source.stop(now + duration);
  }

  playTouchdownScreech(groundSpeedKnots = 100) {
    // Wheel spin-up is a brief dry scrub; at taxi speed it is barely audible.
    const speed = Math.min(1, Math.max(0, groundSpeedKnots) / 100);
    if (speed === 0) return;
    this.playContactNoise(0.12 + 0.08 * speed, 1800, 0.32 * speed, 'bandpass');
  }

  playTouchdownThump(sinkRate = 1.5) {
    const severity = Math.min(1, Math.max(0, sinkRate) / 3);
    if (severity === 0) return;
    this.playContactNoise(0.28, 180, 1.2 * severity);
    this.playContactNoise(0.09, 650, 0.35 * severity);
  }

  playDepartureRadio(stage) {
    this.ensureContextRunning();
    return this.departureRadio.play(stage);
  }

  // Real GPWS/RADALT pronounceers are English-language devices. Browser speech
  // synthesis otherwise follows the OS locale, so pin an en voice explicitly.
  pickSynthVoice(synthesis) {
    let voices = [];
    try { voices = synthesis.getVoices() ?? []; } catch (e) { return null; }
    if (!voices.length) return null;
    const score = (v) => {
      const lang = (v.lang || '').toLowerCase().replace('_', '-');
      if (!lang.startsWith('en')) return -1;
      const google = (v.name || '').toLowerCase().includes('google');
      const network = v.localService === false;
      return ((lang === 'en-us' || lang === 'en-gb') ? 4 : 2) + (google && network ? 2 : 0);
    };
    let best = null, bestScore = -1;
    for (const v of voices) {
      const s = score(v);
      if (s > bestScore) { best = v; bestScore = s; }
    }
    return bestScore >= 0 ? best : null;
  }

  playGpwsCallout(text) {
    if (this.isMuted || this.effectiveVolume === 0 || this.isPiston || this.crashed) return;
    if ('speechSynthesis' in window) {
      try {
        const synthesis = window.speechSynthesis;
        if (this.synthVoice === undefined) this.synthVoice = this.pickSynthVoice(synthesis);
        if (!this.synthVoice && synthesis.onvoiceschanged === null) {
          synthesis.onvoiceschanged = () => { this.synthVoice = undefined; };
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        if (this.synthVoice) u.voice = this.synthVoice;
        // Boeing pronouncer: measured cadence, low flat timbre.
        u.rate = 0.95;
        u.pitch = 0.5;
        u.volume = this.effectiveVolume;
        synthesis.speak(u);
      } catch (e) {}
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0.0, Math.min(1.0, vol));
    if (this.volume > 0.0) {
      this.isMuted = false;
    }
    if (this.volume === 0) { this.cancelSpeech(); this.departureRadio.stop(); }
    this.applyMasterGain();
  }

  setMuted(muted) {
    this.isMuted = !!muted;
    if (this.isMuted) { this.cancelSpeech(); this.departureRadio.stop(); }
    this.applyMasterGain();
  }

  /** Silence the bus while the sim is held off-screen, without touching the user's setting. */
  setPaused(paused) {
    this.isPaused = !!paused;
    if (this.isPaused) this.cancelSpeech();
    this.applyMasterGain();
  }

  applyMasterGain() {
    if (this.masterGain && this.ctx) {
      const targetGain = this.effectiveVolume;
      if (typeof this.masterGain.gain.setTargetAtTime === 'function') {
        this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
      } else {
        this.masterGain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
      }
    }
  }

  cycleVolume() {
    this.setMuted(!this.isMuted);
    this.volume = 1.0;
    this.applyMasterGain();
    return this.getVolumeState();
  }

  getVolumeState() {
    if (this.isMuted) {
      return { muted: true, level: 0, mode: 'muted', text: t('audio.muted'), icon: '🔇' };
    }
    return { muted: false, level: 1.0, mode: 'normal', text: t('normal.volume.100'), icon: '🔊' };
  }

  update(dt, state, isCockpitCam, cameraDistanceMeters = 0) {
    if (!this.isInitialized || !this.ctx || this.crashed) return;

    const now = this.ctx.currentTime;

    // Interior vs Exterior camera acoustics: the cockpit keeps a fixed muffled
    // level; exterior views attenuate volume and treble with camera-to-aircraft distance.
    if (isCockpitCam) {
      this.cockpitFilter.frequency.setTargetAtTime(2700, now, 0.1);
      this.distanceGain.gain.setTargetAtTime(1.0, now, 0.1);
    } else {
      this.cockpitFilter.frequency.setTargetAtTime(exteriorAirCutoff(cameraDistanceMeters), now, 0.1);
      this.distanceGain.gain.setTargetAtTime(exteriorDistanceGain(cameraDistanceMeters), now, 0.1);
    }

    if (this.isPiston) {
      this.updatePiston(state, now);
    } else {
      // 1. Turbofan Engines Pitch and Roar based on N1%
      const n1 = Math.max(20, (state.engine1 ? state.engine1.n1 : 22));
      const n1Ratio = Math.max(0.0, Math.min(1.0, (n1 - 20) / 80.0)); // 0.0 to 1.0

      // Cutoff: 280 Hz (idle) to 950 Hz (TOGA) -> directly in mobile & earphone sweet spot!
      const engineFreq = 280 + n1Ratio * 670;
      // Volume: 0.38 (idle) to 1.15 (TOGA) -> loud, powerful, audible on all Bluetooth gear
      const engineVol = 0.38 + Math.pow(n1Ratio, 1.3) * 0.77;
      this.engineFilter.frequency.setTargetAtTime(engineFreq, now, 0.08);
      this.engineGain.gain.setTargetAtTime(engineVol, now, 0.08);

      // Primary N1 Fan Compressor Whine: 420 Hz to 1800 Hz
      const turbineFreq = 420 + Math.pow(n1Ratio, 1.2) * 1380;
      const turbineVol = 0.08 + n1Ratio * 0.22;
      this.turbineWhine.frequency.setTargetAtTime(turbineFreq, now, 0.08);
      this.turbineGain.gain.setTargetAtTime(turbineVol, now, 0.08);

      // Secondary N2 Core Whine & Harmonics: 840 Hz to 3200 Hz
      if (this.turbineWhine2 && this.turbineGain2) {
        const turbineFreq2 = 840 + Math.pow(n1Ratio, 1.1) * 2360;
        const turbineVol2 = 0.04 + n1Ratio * 0.12;
        this.turbineWhine2.frequency.setTargetAtTime(turbineFreq2, now, 0.08);
        this.turbineGain2.gain.setTargetAtTime(turbineVol2, now, 0.08);
      }
    }

    // 2. Wind Slipstream Noise proportional to IAS
    const ias = state.iasKnots || 0;
    const windVol = Math.min(0.75, Math.pow(ias / 270.0, 1.5) * 0.70);
    const windCutoff = 450 + Math.min(3200, ias * 9.5);
    this.windGain.gain.setTargetAtTime(windVol, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(windCutoff, now, 0.1);

    // 3. Ground Roll Rumble (Active when wheels on ground and aircraft moving)
    if (this.rumbleGain && this.rumbleFilter) {
      const gndSpeed = state.groundSpeedKnots !== undefined ? state.groundSpeedKnots : (state.onGround ? (state.iasKnots || 0) : 0);
      if (state.onGround && gndSpeed > 3) {
        const rumbleVol = Math.min(0.60, (gndSpeed / 110.0) * 0.55);
        const rumbleCutoff = 180 + Math.min(260, gndSpeed * 1.8);
        this.rumbleGain.gain.setTargetAtTime(rumbleVol, now, 0.08);
        this.rumbleFilter.frequency.setTargetAtTime(rumbleCutoff, now, 0.08);
      } else {
        this.rumbleGain.gain.setTargetAtTime(0.0, now, 0.08);
      }
    }

    // Coalesce near-simultaneous gear contacts and contact chatter, while
    // allowing a later genuine bounce to produce another impact.
    if (state.touchdown && !this.touchdownActive && now - this.lastTouchdownTime >= 0.25) {
      this.lastTouchdownTime = now;
      this.playTouchdownScreech(state.groundSpeedKnots ?? state.iasKnots ?? 0);
      const sinkRate = state.touchdownSinkRate ?? Math.abs(state.vsiFpm ?? 0) / 196.85;
      this.playTouchdownThump(sinkRate);
    }
    this.touchdownActive = !!state.touchdown;

    // 5. Sensor warning is independent of the physical separation diagnostic.
    const stallWarning = state.isStallWarning ?? (state.isStalled || state.isPreStall);
    // Existing synthesized timbres approximate the warning devices.
    if (this.isPiston) {
      const horn = !state.onGround && stallWarning;
      this.warningGain.gain.setValueAtTime(horn ? 0.30 : 0, now);
    } else if (stallWarning && state.isStalled && !state.onGround) {
      this.stallBeepTime += dt;
      // Pulsing tone: 4 beeps per second
      const beepActive = (this.stallBeepTime % 0.25) < 0.14;
      this.warningGain.gain.setValueAtTime(beepActive ? 0.50 : 0.0, now);
    } else if (stallWarning && !state.onGround) {
      this.stallBeepTime += dt;
      // Shaker activation: rapid low-volume double chirp
      const chirpActive = (this.stallBeepTime % 0.3) < 0.05 || ((this.stallBeepTime % 0.3) > 0.09 && (this.stallBeepTime % 0.3) < 0.14);
      this.warningGain.gain.setValueAtTime(chirpActive ? 0.18 : 0.0, now);
    } else {
      this.stallBeepTime = 0;
      this.warningGain.gain.setValueAtTime(0.0, now);
    }

    const alert = state.warnings?.[0];
    this.alertTimer += dt;
    this.alertElapsed += dt;
    if (alert?.id !== this.alertId) {
      if (this.alertId || alert) this.cancelSpeech();
      this.alertId = alert?.id;
      this.alertTimer = 99;
      this.alertElapsed = 0;
    }
    if (alert?.voice && this.alertTimer >= 4) {
      this.cancelSpeech();
      this.playGpwsCallout(alert.voice);
      this.alertTimer = 0;
    }
    if ((alert?.id === 'overspeed' || alert?.id === 'takeoff-config') && !this.isPiston) {
      this.warningOsc.frequency.setValueAtTime(800, now);
      this.warningGain.gain.setValueAtTime((this.alertElapsed % 0.16) < 0.08 ? 0.35 : 0, now);
    } else if (alert?.id === 'engine' && this.aircraftId === 'B738' && this.alertElapsed < 0.18) {
      this.warningOsc.frequency.setValueAtTime(1000, now);
      this.warningGain.gain.setValueAtTime(0.25, now);
    } else this.warningOsc.frequency.setValueAtTime(680, now);

    // 6. Boeing GPWS Altitude Voice Callouts
    const rAlt = state.radioAltFt;
    if (this.aircraftId === 'B738' && !alert && rAlt !== undefined && !state.onGround && state.vsiFpm < -100) {
      // RADALT pronounce-up spelling; 500 and 100 are doubled like the real device.
      const callouts = [
        ['Five hundred, five hundred', 500],
        ['One hundred, one hundred', 100],
        ['Fifty', 50], ['Forty', 40], ['Thirty', 30], ['Twenty', 20], ['Ten', 10],
      ];
      for (const [text, call] of callouts) {
        if (this.lastRadioAlt > call && rAlt <= call && !this.calledAltitudes.has(call)) {
          this.calledAltitudes.add(call);
          this.playGpwsCallout(text);
          break;
        }
      }

    }
    if (rAlt > 1000) this.calledAltitudes.clear();
    this.lastRadioAlt = rAlt;
  }

  playExplosion(isWater = false) {
    this.crashed = true;
    this.cancelSpeech();
    this.departureRadio.stop();
    if (this.ctx) {
      for (const name of ['engineGain', 'turbineGain', 'turbineGain2', 'pistonGain', 'propGain', 'propModGain', 'windGain', 'rumbleGain', 'packGain', 'warningGain']) {
        this[name]?.gain.setValueAtTime(0, this.ctx.currentTime);
      }
    }
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    // 1. Deep Low-Frequency Subwoofer Detonation Thump
    const bufferSize = Math.floor(this.ctx.sampleRate * 3.5);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.7));
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const bassFilter = this.ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(isWater ? 180 : 320, now);
    bassFilter.frequency.exponentialRampToValueAtTime(32, now + 2.8);

    const bassGain = this.ctx.createGain();
    bassGain.gain.setValueAtTime(1.4, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 3.2);

    noiseSrc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(this.masterGain);
    noiseSrc.start(now);

    // 2. High-Frequency Metal Crunch / Debris Shatter (or Water Rush)
    const crunchBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 1.5), this.ctx.sampleRate);
    const cData = crunchBuffer.getChannelData(0);
    for (let i = 0; i < cData.length; i++) {
      cData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.3));
    }

    const crunchSrc = this.ctx.createBufferSource();
    crunchSrc.buffer = crunchBuffer;

    const crunchFilter = this.ctx.createBiquadFilter();
    crunchFilter.type = isWater ? 'bandpass' : 'highpass';
    crunchFilter.frequency.setValueAtTime(isWater ? 600 : 2200, now);
    crunchFilter.frequency.exponentialRampToValueAtTime(isWater ? 180 : 350, now + 1.2);

    const crunchGain = this.ctx.createGain();
    crunchGain.gain.setValueAtTime(isWater ? 1.0 : 0.85, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

    crunchSrc.connect(crunchFilter);
    crunchFilter.connect(crunchGain);
    crunchGain.connect(this.masterGain);
    crunchSrc.start(now);
  }
}
