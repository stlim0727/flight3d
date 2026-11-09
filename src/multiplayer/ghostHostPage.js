import { PeerRoom } from './PeerRoom.js';
import { VoiceLink } from './VoiceLink.js';
import { GhostPilot, GHOST_CONFIG } from './GhostPilot.js';

function createRadio(context) {
  const destination = context.createMediaStreamDestination();
  const osc = context.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 880;
  const gain = context.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(destination);
  osc.start();

  let stopTimeout = null;
  function playTone(durationMs = 1000, freq = 880) {
    if (context.state !== 'running') context.resume().catch(() => {});
    clearTimeout(stopTimeout);
    osc.frequency.setValueAtTime(freq, context.currentTime);
    gain.gain.setValueAtTime(0.5, context.currentTime);
    stopTimeout = setTimeout(() => {
      gain.gain.setValueAtTime(0, context.currentTime);
    }, durationMs);
  }

  return { destination, playTone };
}

/** Internal localhost entry for ghost player (host or guest); nothing is added to the simulator's UI or build. */
export function startGhostPlayer({ room: code, role = 'host', name, voice: voiceEnabled = false, options } = {}) {
  if (window.ghostHost) throw new Error('already-started');
  const isGuest = role === 'guest';
  const defaultName = isGuest ? 'Goose' : 'Maverick';
  const pilotName = name || defaultName;

  let room, pilot, reconnectTimer, startTimer, radioTimer, responseTimer;
  let stopped = false, generation = 0, last = performance.now(), snapshotAt = 0;
  let analyser = null, voice = null, radio = null;
  let lastHeardVoiceAt = 0;

  const status = {
    role,
    state: 'connecting',
    code,
    generation: 0,
    error: null,
    registered: false,
    talking: false,
    hearingVoice: false,
    audioInEnergy: 0,
    simSeconds: 0,
  };
  window.ghostHost = window.ghostPlayer = status;

  function transmit(durationMs = 1000, freq = 880) {
    if (!voice || stopped || voice.closed) return;
    status.talking = true;
    voice.setMuted(false);
    radio?.playTone(durationMs, freq);
    clearTimeout(radioTimer);
    radioTimer = setTimeout(() => {
      if (!stopped && voice && !voice.closed) {
        voice.setMuted(true);
        status.talking = false;
      }
    }, durationMs);
  }

  status.speak = (durationMs, freq) => transmit(durationMs, freq);

  function setupListening(remoteStream) {
    if (!remoteStream || !voice?.context) return;
    try {
      analyser = voice.context.createAnalyser();
      analyser.fftSize = 256;
      const source = voice.context.createMediaStreamSource(remoteStream);
      source.connect(analyser);
      const audio = new Audio();
      audio.srcObject = remoteStream;
      audio.play().catch(() => {});
    } catch (err) {
      console.warn('[Ghost] Listening setup failed:', err);
    }
  }

  const connect = async () => {
    if (stopped) return;
    clearTimeout(startTimer);
    clearTimeout(radioTimer);
    clearTimeout(responseTimer);
    room?.dispose();
    analyser = null;
    const current = ++generation;
    Object.assign(status, {
      state: 'connecting',
      registered: false,
      generation,
      error: null,
      transportError: null,
      talking: false,
      hearingVoice: false,
      audioInEnergy: 0,
    });

    voice = new VoiceLink({
      capture: async () => {
        radio = createRadio(voice.context);
        return radio.destination.stream;
      },
    });
    voice.context.resume().catch(() => {});
    await voice.enableMicrophone();
    voice.setMuted(true);
    if (stopped || current !== generation) {
      voice.close();
      return;
    }

    room = new PeerRoom({
      ...(isGuest ? { room: code } : { hostRoom: code }),
      name: pilotName,
      config: GHOST_CONFIG,
      voice,
      options,
      waitingMs: isGuest ? undefined : Infinity,
      prepare: (c, slot) => { pilot = new GhostPilot(c, slot); },
      fly: () => {
        last = performance.now();
        snapshotAt = 0;
        if (voiceEnabled) {
          setTimeout(() => {
            if (!stopped && room?.session?.state === 'flying') transmit(800, isGuest ? 980 : 880);
          }, 600);
        }
      },
      remoteStream: stream => setupListening(stream),
      changed: () => {
        if (current !== generation || !room) return;
        Object.assign(status, {
          state: room.session.state,
          registered: room.registered === true,
          generation,
          transportError: room.transportError,
          compatibilityFailure: room.session.compatibilityFailure,
          round: room.session.round,
          remoteName: room.session.remoteName,
        });
        if (!isGuest && room.session.state === 'connected' && !startTimer) {
          // Give the normal guest dialog time to show the host before preparation.
          startTimer = setTimeout(() => { startTimer = null; room.session.start(); }, 2000);
        }
      },
      ended: reason => {
        status.reason = reason;
        clearTimeout(startTimer); startTimer = null;
        clearTimeout(radioTimer);
        clearTimeout(responseTimer);
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      },
    });
  };

  const timer = setInterval(() => {
    const now = performance.now(), elapsed = (now - last) / 1000; last = now;

    if (analyser) {
      try {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const energy = Math.sqrt(sum / samples.length);
        status.audioInEnergy = energy;

        const isSpeakingNow = energy > 0.02;
        if (isSpeakingNow) {
          status.hearingVoice = true;
          lastHeardVoiceAt = now;
        } else if (status.hearingVoice && now - lastHeardVoiceAt > 600) {
          status.hearingVoice = false;
          if (voiceEnabled && !status.talking && room?.session?.state === 'flying') {
            clearTimeout(responseTimer);
            responseTimer = setTimeout(() => {
              if (!stopped && !status.talking && room?.session?.state === 'flying') {
                transmit(700, isGuest ? 1040 : 880);
              }
            }, 300);
          }
        }
      } catch {}
    }

    if (room?.session.state !== 'flying') return;
    try {
      pilot.advance(elapsed);
      if (now - snapshotAt >= 1000 / 15) {
        room.session.snapshot(pilot.snapshot(status.talking || voice.talking));
        snapshotAt = now;
        status.position = pilot.snapshot().p;
        status.simSeconds = pilot.sim.totalSimTime;
      }
    } catch (error) {
      status.error = error.message;
      room.close('connection');
    }
  }, 1000 / 60);

  status.stop = () => {
    stopped = true; ++generation;
    clearTimeout(reconnectTimer);
    clearTimeout(startTimer);
    clearTimeout(radioTimer);
    clearTimeout(responseTimer);
    clearInterval(timer);
    room?.dispose();
    voice?.close();
  };

  connect();
}

window.startGhostHost = window.startGhostPlayer = startGhostPlayer;
