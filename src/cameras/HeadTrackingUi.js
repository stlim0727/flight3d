/**
 * HeadTrackingUi — minimal mobile-friendly panel for webcam head tracking.
 * Created lazily by FlightSimulator; no index.html changes required.
 */
export class HeadTrackingUi {
  constructor(controller) {
    this.controller = controller;
    this.collapsed = false;

    this.root = document.createElement('div');
    this.root.id = 'head-tracking-panel';
    this.root.style.cssText = 'position:fixed;top:max(56px, calc(env(safe-area-inset-top, 0px) + 52px));'
      + 'left:max(12px, env(safe-area-inset-left, 0px));z-index:60;display:flex;flex-direction:column;gap:6px;'
      + 'padding:8px 10px;background:rgba(8,12,18,0.86);border:1px solid rgba(255,255,255,0.18);'
      + 'border-radius:8px;color:#e8eef7;font:12px/1.35 system-ui,sans-serif;max-width:min(280px,80vw);'
      + 'touch-action:manipulation;box-shadow:0 4px 16px rgba(0,0,0,0.35);';

    // Header bar with title and collapse toggle
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

    const title = document.createElement('span');
    title.textContent = 'Head Look';
    title.style.cssText = 'font-weight:600;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;opacity:0.9;';
    header.appendChild(title);

    this.collapseButton = document.createElement('button');
    this.collapseButton.type = 'button';
    this.collapseButton.setAttribute('aria-label', 'Toggle head tracking panel');
    this.collapseButton.textContent = '−';
    this.collapseButton.style.cssText = 'width:20px;height:20px;line-height:18px;text-align:center;padding:0;'
      + 'border:1px solid rgba(255,255,255,0.25);border-radius:4px;background:rgba(255,255,255,0.08);'
      + 'color:inherit;cursor:pointer;font:inherit;font-size:14px;';
    this.collapseButton.addEventListener('click', () => this.toggleCollapse());
    header.appendChild(this.collapseButton);

    this.root.appendChild(header);

    // Body container containing status and action buttons
    this.body = document.createElement('div');
    this.body.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

    this.status = document.createElement('div');
    this.status.textContent = 'Head tracking off';
    this.status.style.cssText = 'opacity:0.85;min-height:16px;';
    this.body.appendChild(this.status);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    this.toggleButton = this._button('Enable head look', () => this.controller.toggle());
    this.resetButton = this._button('Reset', () => this.controller.reset());
    this.calibrateButton = this._button('Calibrate', () => this.controller.calibrate());
    buttons.append(this.toggleButton, this.resetButton, this.calibrateButton);
    this.body.appendChild(buttons);

    this.root.appendChild(this.body);

    document.body.appendChild(this.root);
    this.update(controller.getStatus());
  }

  toggleCollapse(force) {
    this.collapsed = typeof force === 'boolean' ? force : !this.collapsed;
    this.body.style.display = this.collapsed ? 'none' : 'flex';
    this.collapseButton.textContent = this.collapsed ? '+' : '−';
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
