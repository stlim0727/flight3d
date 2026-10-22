import en from './en.js';
import ko from './ko.js';

// Register additional locales here. Missing translations fall back to English.
export const locales = {
  en: { label: 'English', messages: en },
  ko: { label: '한국어', messages: ko },
};
export const STORAGE_KEY = 'flight3d.language';
let language = 'ko';
const bindings = new Map();

export function resolveLanguage(saved, preferred = []) {
  if (Object.hasOwn(locales, saved)) return saved;
  for (const candidate of preferred) {
    const base = String(candidate).toLowerCase().split('-')[0];
    if (Object.hasOwn(locales, base)) return base;
  }
  return 'en';
}

export function getLanguage() { return language; }

export function t(key, values = {}) {
  const text = locales[language]?.messages[key] ?? en[key] ?? key;
  return text.replace(/\{([a-zA-Z]\w*)\}/g, (placeholder, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}

/** Keep a localized label current without resetting simulation or DOM state. */
export function bindText(element, render, attribute = 'textContent') {
  if (!element) return;
  let properties = bindings.get(element);
  if (!properties) bindings.set(element, properties = new Map());
  properties.set(attribute, render);
  const value = render();
  if (attribute === 'textContent') element.textContent = value;
  else element.setAttribute(attribute, value);
}

export function translateDOM(root) {
  for (const attribute of ['textContent', 'title', 'aria-label']) {
    const marker = attribute === 'textContent' ? 'data-i18n' : `data-i18n-${attribute}`;
    const elements = [...root.querySelectorAll(`[${marker}]`)];
    if (root.matches?.(`[${marker}]`)) elements.unshift(root);
    for (const element of elements) {
      const key = element.getAttribute(marker);
      bindText(element, () => t(key), attribute);
    }
  }
}

export function setLanguage(next, storage) {
  if (!Object.hasOwn(locales, next)) return false;
  language = next;
  try { (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, next); } catch { /* Storage may be unavailable. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const [element, properties] of bindings) {
    if (element.isConnected === false) { bindings.delete(element); continue; }
    for (const [attribute, render] of properties) {
      const value = render();
      if (attribute === 'textContent') element.textContent = value;
      else element.setAttribute(attribute, value);
    }
  }
  return true;
}

export function initLocalization() {
  let saved;
  try { saved = globalThis.localStorage?.getItem(STORAGE_KEY); } catch { /* Use browser preferences. */ }
  language = resolveLanguage(saved, globalThis.navigator?.languages);
  translateDOM(document);
  document.documentElement.lang = language;
}
