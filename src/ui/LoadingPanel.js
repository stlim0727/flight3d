/** Ground loading editor. Fields describe the next atomic LMC; totals below
 * come from the committed state, never from half-edited inputs. */
export class LoadingPanel {
  constructor(sim) {
    this.sim = sim;
    this.model = null;
    this.button = document.createElement('button');
    this.button.className = 'btn';
    this.button.id = 'btn-loading';
    this.button.textContent = '중량 / Loading';
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', 'loading-panel');
    (document.getElementById('lobby-settings') || document.querySelector('.flight-toolbar'))?.append(this.button);
    this.panel = document.createElement('section');
    this.panel.id = 'loading-panel';
    this.panel.className = 'loading-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Weight and balance');
    this.panel.innerHTML = `<h2>중량·무게중심 / Weight & balance</h2>
      <p>지상 정지 중 적용 / Apply while stopped on ground</p>
      <form><div class="loading-fields"></div><button class="btn" type="submit">적용 / Apply</button>
      <button class="btn" type="button" data-close>닫기 / Close</button></form>
      <output aria-live="polite"></output><p data-summary></p>
      <p>탱크 위치·관성은 게임용 추정치입니다. VR~/V2~는 근사값이며 V1은 미지원입니다.<br>
      Game estimates; no runway accelerate-stop model for V1.</p>`;
    document.body.append(this.panel);
    this.button.onclick = () => {
      this.panel.hidden = !this.panel.hidden;
      this.button.setAttribute('aria-expanded', String(!this.panel.hidden));
      if (!this.panel.hidden) { this.rebuild(); this.update(); }
    };
    this.panel.querySelector('[data-close]').onclick = () => {
      this.panel.hidden = true;
      this.button.setAttribute('aria-expanded', 'false');
      this.button.focus();
    };
    this.panel.addEventListener('keydown', event => event.stopPropagation());
    this.panel.addEventListener('keyup', event => event.stopPropagation());
    this.panel.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const payloadKg = {};
      for (const s of this.model.stations) payloadKg[s.id] = Number(fields.get(s.id));
      try {
        this.sim.applyLoading({ fuelKg: Number(fields.get('fuel')), payloadKg });
        this.panel.querySelector('output').textContent = '적용 완료 / Loading applied';
      } catch (error) {
        this.panel.querySelector('output').textContent = error.message;
      }
      this.update();
    };
  }

  rebuild() {
    this.model = this.sim.aero.massProperties;
    const fields = this.panel.querySelector('.loading-fields');
    fields.replaceChildren();
    const add = (name, label, value, max) => {
      const wrapper = document.createElement('label');
      wrapper.textContent = label;
      const input = document.createElement('input');
      Object.assign(input, { name, type: 'number', min: '0', max: String(max), step: '0.1', value: value.toFixed(1), required: true });
      wrapper.append(input); fields.append(wrapper);
    };
    add('fuel', '연료 / Fuel (kg)', this.model.fuelKg, this.model.capacityKg);
    for (const s of this.model.stations) add(s.id, `${s.id} 적재 / payload (kg)`, s.massKg, s.capacityKg);
  }

  update() {
    if (this.panel.hidden) return;
    if (this.model !== this.sim.aero.massProperties) this.rebuild();
    const m = this.model, perf = this.sim.takeoff;
    const tanks = m.tanks.map(t => `${t.id}: ${t.massKg.toFixed(1)} kg`).join(' · ');
    const speeds = perf?.status === 'estimate' ? `VR~ ${perf.vr.toFixed(0)} / V2~ ${perf.v2.toFixed(0)} kt` : 'VR/V2 unavailable';
    this.panel.querySelector('[data-summary]').textContent =
      `ZFW ${m.zeroFuelMassKg.toFixed(1)} kg · 현재 / Gross ${m.massKg.toFixed(1)} kg\n` +
      `CG (m, X우측/Y위/Z뒤): ${m.cg.x.toFixed(3)}, ${m.cg.y.toFixed(3)}, ${m.cg.z.toFixed(3)}\n` +
      `${tanks}\n${speeds} · V1 —\n` +
      (perf ? `예상 TOW (지금 이륙): ${perf.massKg.toFixed(1)} kg\n` : '') +
      (this.sim.actualTakeoffMassKg !== null ? `실제 이륙중량: ${this.sim.actualTakeoffMassKg.toFixed(1)} kg` : '');
  }
}
