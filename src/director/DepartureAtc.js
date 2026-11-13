import { DEPARTURE_ATC } from '../config/departureAtc.js';
import { DEPARTURE_RADIO } from '../config/departureRadio.js';

const readingSeconds = text => Math.max(3, text.split(/\s+/).length / 2.5);
export const TRAFFIC_WAIT_LIMIT_SECONDS = 120;

/** Deterministic caption exchanges surrounding the existing voiced radio calls.
 * Pause follows simulation time; a voiced block also waits for actual audio end.
 * Optional `traffic` ({ plan, radio }) interleaves another aircraft's voiced exchanges on the
 * same frequency; such a block may wait for that traffic to reach a phase before it is spoken.
 */
export class DepartureAtc {
  constructor(stage, playVoice = () => {}, atcConfig = DEPARTURE_ATC, radioConfig = DEPARTURE_RADIO, traffic = null) {
    const plan = atcConfig[stage] ?? {};
    const trafficPlan = traffic?.plan?.[stage] ?? {};
    this.blocks = [];
    if (plan.waitForTug) {
      const waitLines = plan.waitForTugLines ?? [['crew', 'Pushback complete. Set parking brake. Stand by for equipment clearance.']];
      this.blocks.push({ waitForTug: true, seconds: 0, lines: waitLines });
    }
    const append = lines => {
      for (const line of lines ?? []) this.blocks.push({ lines: [line], seconds: readingSeconds(line[1]) });
    };
    const appendTraffic = entries => {
      for (const { voiceKey, waitForTraffic = null } of entries ?? []) {
        const lines = traffic.radio?.[voiceKey];
        if (!lines?.length) continue;
        this.blocks.push({ lines, voice: `traffic:${voiceKey}`, waitForTraffic,
          seconds: lines.reduce((sum, line) => sum + readingSeconds(line[1]), 0) });
      }
    };
    append(plan.before);
    appendTraffic(trafficPlan.before);
    if (radioConfig && radioConfig[stage]) this.blocks.push({ lines: radioConfig[stage],
      voice: stage,
      seconds: radioConfig[stage].reduce((sum, line) => sum + readingSeconds(line[1]), 0) });
    appendTraffic(trafficPlan.after);
    append(plan.after);
    this.index = 0; this.elapsed = 0; this.waited = 0; this.playVoice = playVoice;
    this.activate();
  }

  get current() { return this.blocks[this.index] ?? null; }
  get busy() { return this.current !== null; }
  /** True while the current block is waiting for traffic rather than being read. */
  get waitingForTraffic() { return Boolean(this.current?.waitForTraffic && !this.current.started); }
  activate() {
    const block = this.current;
    if (!block || block.waitForTraffic) return;
    block.started = true;
    if (block.voice) this.playVoice(block.voice);
  }

  update(dt, voiceBusy = false, tugClear = true, trafficReady = () => true) {
    const block = this.current;
    if (!block || (block.waitForTug && !tugClear)) return;
    if (block.waitForTraffic && !block.started) {
      this.waited += Math.max(0, dt);
      // Another clip on the shared frequency must finish before this exchange keys up.
      if (voiceBusy || !(trafficReady(block.waitForTraffic) || this.waited >= TRAFFIC_WAIT_LIMIT_SECONDS)) return;
      block.started = true; this.waited = 0;
      if (block.voice) this.playVoice(block.voice);
      return;
    }
    this.elapsed += Math.max(0, dt);
    // Do not skip unread exchanges on a long frame, or overrun a just-started clip.
    if (this.elapsed >= block.seconds && !(block.voice && voiceBusy)) {
      this.index++; this.elapsed = 0; this.activate();
    }
  }

  caption(speakerLabel = speaker => speaker) {
    let block = this.current ?? this.blocks.at(-1);
    // While waiting for traffic, keep showing the exchange that was read last.
    if (block && block.waitForTraffic && !block.started) block = this.blocks[this.index - 1] ?? null;
    return (block?.lines ?? []).map(([speaker, text]) => `${speakerLabel(speaker)}: ${text}`).join(' ');
  }
}
