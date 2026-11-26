import { AddonPicker } from './AddonPicker.js';
import { validateCatalog } from '../addons/addonContract.js';
import { profileShareParams } from '../addons/regionPackBinding.js';

export function installAddonPicker(parent, options = {}) {
  if (!parent || typeof document === 'undefined') return null;
  const picker = new AddonPicker({
    catalogUrl: options.catalogUrl ?? '',
    coreVersion: options.coreVersion,
    fetchImpl: options.fetchImpl,
    profileShareParams,
    validateCatalog,
  });
  picker.mount(parent);
  return picker;
}
