import { AIRPORTS, AIRCRAFT, SCENARIOS, cleanName } from './protocol.js';

export const MULTIPLAYER_PREFERENCES_KEY = 'flight3d.multiplayer.preferences.v1';
const choices = { airport: AIRPORTS, aircraft: AIRCRAFT, scenario: SCENARIOS };

/** Remember setup fields only; room membership and microphone state stay transient. */
export function bindMultiplayerPreferences(root = document, storage) {
  let saved = {};
  try {
    storage ??= globalThis.localStorage;
    const value = JSON.parse(storage?.getItem(MULTIPLAYER_PREFERENCES_KEY) ?? 'null');
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
  } catch { /* Storage may be blocked or contain malformed data. */ }
  const fields = Object.fromEntries(['name', ...Object.keys(choices)].map(key => [key, root.getElementById(`mp-${key}`)]));
  if (typeof saved.name === 'string') fields.name.value = cleanName(saved.name);
  for (const [key, values] of Object.entries(choices)) {
    if (values.includes(saved[key])) fields[key].value = saved[key];
  }
  const save = () => {
    const value = { name: cleanName(fields.name.value) };
    for (const [key, values] of Object.entries(choices)) {
      if (values.includes(fields[key].value)) value[key] = fields[key].value;
    }
    try { storage?.setItem(MULTIPLAYER_PREFERENCES_KEY, JSON.stringify(value)); }
    catch { /* Saving must never prevent creating or joining a room. */ }
  };
  fields.name.addEventListener('input', save);
  for (const key of Object.keys(choices)) fields[key].addEventListener('change', save);
  return { save };
}
