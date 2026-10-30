import { DEPARTURE_ATC } from '../config/departureAtc.js';
import { DEPARTURE_RADIO } from '../config/departureRadio.js';

const readingSeconds = text => Math.max(3, text.split(/\s+/).length / 2.5);

/** Deterministic caption exchanges surrounding the existing voiced radio calls.
 * Pause follows simulation time; a voiced block also waits for actual audio end.
 */
export class DepartureAtc {
  constructor(stage, playVoice = () => {}) {
    const plan = DEPARTURE_ATC[stage] ?? {};
    this.blocks = [];
    if (plan.waitForTug) this.blocks.push({ waitForTug: true, seconds: 0,
      lines: [['crew', 'Pushback complete. Set parking brake. Stand by for equipment clearance.']] });
    const append = lines => {
      for (const line of lines ?? []) this.blocks.push({ lines: [line], seconds: readingSeconds(line[1]) });
    };
    append(plan.before);
    if (DEPARTURE_RADIO[stage]) this.blocks.push({ lines: DEPARTURE_RADIO[stage],
      voice: stage,
      seconds: DEPARTURE_RADIO[stage].reduce((sum, line) => sum + readingSeconds(line[1]), 0) });
    append(plan.after);
    this.index = 0; this.elapsed = 0; this.playVoice = playVoice;
    this.activate();
  }

  get current() { return this.blocks[this.index] ?? null; }
  get busy() { return this.current !== null; }
  activate() { if (this.current?.voice) this.playVoice(this.current.voice); }

  update(dt, voiceBusy = false, tugClear = true) {
    if (!this.current || (this.current.waitForTug && !tugClear)) return;
    this.elapsed += Math.max(0, dt);
    // Do not skip unread exchanges on a long frame, or overrun a just-started clip.
    if (this.elapsed >= this.current.seconds && !(this.current.voice && voiceBusy)) {
      this.index++; this.elapsed = 0; this.activate();
    }
  }

  caption(speakerLabel = speaker => speaker) {
    const block = this.current ?? this.blocks.at(-1);
    return (block?.lines ?? []).map(([speaker, text]) => `${speakerLabel(speaker)}: ${text}`).join(' ');
  }
}
