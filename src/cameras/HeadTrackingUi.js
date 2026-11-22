/**
 * HeadTrackingUi — minimal mobile-friendly panel for webcam head tracking.
 * Created lazily by FlightSimulator; no index.html changes required.
 */
export class HeadTrackingUi {
  constructor(controller) {
    this.controller = controller;
    this.root = document.createElement('div');
    this.root.id = 'head-tracking-panel';
    this.root.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:60;display:flex;flex-direction:column;gap:6px;'
      + 'padding:8px 10px;background:rgba(8,12,18,0.86);border:1px solid rgba(255,255,255,0.18);'
      + 'border-radius:8px;color:#e8eef7;font:12px/1.35 system-ui,sans-serif;max-width:min(280px,80vw);';

    this.status = document.createElement('div');
    this.status.textContent = 'Head tracking off';
    this.status.style.cssText = 'opacity:0.85;min-height:16px;';
    this.root.appendChild(this.status);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    this.toggleButton = this._button('Enable head look', () => this.controller.toggle());
    this.resetButton = this._button('Reset', () => this.controller.reset());
    this.calibrateButton = this._button('Calibrate', () => this.controller.calibrate());
    buttons.append(this.toggleButton, this.resetButton, this.calibrateButton);
    this.root.appendChild(buttons);

    document.body.appendChild(this.root);
    this.update(controller.getStatus());
  }

  _button(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'min-height:32px;padding:5px 9px;border:1px solid rgba(255,255,255,0.25);'
      + 'border-radius:5px;background:rgba(255,255,255,0.08);color:inherit;cursor:pointer;font:inherit;';
    button.addEventListener('click', onClick);
    return button;
  }

  update(status) {
    this.status.textContent = status.message || '';
    const active = status.state === 'active';
    this.toggleButton.textContent = active ? 'Disable head look' : 'Enable head look';
    this.resetButton.disabled = !active || !status.detected;
    this.calibrateButton.disabled = !active || !status.calibration || status.calibration.samples < 2;
    for (const button of [this.resetButton, this.calibrateButton]) {
      button.style.opacity = button.disabled ? '0.4' : '1';
    }
  }

  dispose() {
    this.root.remove();
  }
}

export default HeadTrackingUi;
