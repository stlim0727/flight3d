// Saved airports and map cruise points for the lobby search UI.
// Bookmarks are user data: validate on read and write, and never let unavailable
// browser storage break the current session.
export const BOOKMARKS_KEY = 'flight3d.bookmarks.v1';

const MAX_BOOKMARKS = 50;
const MAX_TEXT_LENGTH = 120;
const VALID_KINDS = new Set(['airport', 'point']);

function safeStorage(storage) {
  try { return storage === undefined ? globalThis.localStorage : storage; }
  catch { return null; }
}

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function isInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validateBookmark(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!VALID_KINDS.has(value.kind)) return null;
  if (!isNonEmptyText(value.id) || !isNonEmptyText(value.label)) return null;
  if (!isInRange(value.latitude, -90, 90) || !isInRange(value.longitude, -180, 180)) return null;

  const bookmark = {
    kind: value.kind,
    id: value.id,
    label: value.label,
    latitude: value.latitude,
    longitude: value.longitude,
  };
  for (const field of ['code', 'iata']) {
    if (typeof value[field] === 'string' && value[field].length <= MAX_TEXT_LENGTH) {
      bookmark[field] = value[field];
    }
  }
  if (typeof value.tileId === 'string' && /^\d{1,2}-\d{1,2}$/.test(value.tileId)) {
    bookmark.tileId = value.tileId;
  }
  return bookmark;
}

/** Stable identity for a saved airport or cruise point. */
export function bookmarkKey(bookmark) {
  return `${bookmark?.kind}:${bookmark?.id}`;
}

function normalizeBookmarks(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const entry of value) {
    const bookmark = validateBookmark(entry);
    if (!bookmark) continue;
    const key = bookmarkKey(bookmark);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(bookmark);
    if (result.length >= MAX_BOOKMARKS) break;
  }
  return result;
}

function persist(bookmarks, storage) {
  try { safeStorage(storage)?.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks)); }
  catch { /* Storage is optional; keep the current session usable. */ }
}

/** Read the saved list, dropping anything malformed, duplicated or over the cap. */
export function loadBookmarks(storage) {
  try {
    const raw = safeStorage(storage)?.getItem(BOOKMARKS_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed = JSON.parse(raw);
    return normalizeBookmarks(Array.isArray(parsed) ? parsed : parsed?.bookmarks);
  } catch { return []; }
}

/** Replace the saved list with a validated, deduplicated, capped copy. */
export function saveBookmarks(bookmarks, storage) {
  const normalized = normalizeBookmarks(bookmarks);
  persist(normalized, storage);
  return normalized;
}

/** Add a bookmark or remove the matching one; return the resulting list. */
export function toggleBookmark(bookmark, storage) {
  const current = loadBookmarks(storage);
  const candidate = validateBookmark(bookmark);
  if (!candidate) return current;
  const key = bookmarkKey(candidate);
  const next = current.some(entry => bookmarkKey(entry) === key)
    ? current.filter(entry => bookmarkKey(entry) !== key)
    : [...current, candidate].slice(0, MAX_BOOKMARKS);
  persist(next, storage);
  return next;
}

/** Remove a bookmark by its `kind:id` key; return the resulting list. */
export function removeBookmark(key, storage) {
  const next = loadBookmarks(storage).filter(entry => bookmarkKey(entry) !== key);
  persist(next, storage);
  return next;
}

export function isBookmarked(bookmark, storage) {
  const candidate = validateBookmark(bookmark);
  if (!candidate) return false;
  const key = bookmarkKey(candidate);
  return loadBookmarks(storage).some(entry => bookmarkKey(entry) === key);
}
