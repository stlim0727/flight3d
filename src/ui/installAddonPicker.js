import { AddonPicker } from './AddonPicker.js';
import { validateCatalog } from '../addons/addonContract.js';
import { profileShareParams } from '../addons/regionPackBinding.js';
import { loadSavedAddonCatalogUrl } from '../addons/savedAddonProfile.js';

export function installAddonPicker(parent, options = {}) {
  if (!parent || typeof document === 'undefined') return null;
  const defaultCatalogUrl = options.defaultCatalogUrl ?? '';
  const picker = new AddonPicker({
    catalogUrl: options.catalogUrl ?? loadSavedAddonCatalogUrl(options.storage) ?? defaultCatalogUrl,
    defaultCatalogUrl,
    coreVersion: options.coreVersion,
    fetchImpl: options.fetchImpl,
    prLoader: options.prLoader,
    storage: options.storage,
    profileShareParams,
    validateCatalog,
    onApplied: options.onApplied,
  });
  picker.mount(parent);
  const startupError = globalThis.window?.addonStartupError;
  if (startupError && picker.status) {
    picker.status.textContent = `${picker.labels.saveError}: ${startupError}`;
    picker.status.dataset.addonStartupError = startupError;
  }
  const dialog = typeof options.dialog === 'undefined'
    ? document.getElementById('lobby-addon-dialog')
    : options.dialog;
  const openButton = typeof options.openButton === 'undefined'
    ? document.getElementById('lobby-addon-open')
    : options.openButton;
  const closeButton = typeof options.closeButton === 'undefined'
    ? document.getElementById('lobby-addon-dialog-close')
    : options.closeButton;
  const open = () => {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute?.('open', '');
  };
  const close = () => {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute?.('open');
  };
  openButton?.addEventListener?.('click', open);
  closeButton?.addEventListener?.('click', close);
  dialog?.addEventListener?.('click', event => {
    if (event.target === dialog) close();
  });
  picker.open = open;
  picker.close = close;
  return picker;
}
