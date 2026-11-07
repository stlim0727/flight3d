/** Install a scenario before committing its flight selection and start event. */
export class ScenarioStartCoordinator {
  constructor({ prepare, installers, commit }) {
    Object.assign(this, { prepare, installers, commit });
  }

  async start(options = {}) {
    const request = this.prepare(options);
    const kind = ['demo', 'valley'].includes(request.scenario) ? request.scenario : 'preset';
    let installed = this.installers[kind](request);
    // Ordinary preset installation and commitment stay inside the click task.
    if (installed?.then) installed = await installed;
    if (installed === false) throw new Error('Scenario installation was rejected.');
    this.commit(request);
  }
}
