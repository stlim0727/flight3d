// Fixed, category-driven SVG icons. Names never come from data, only the kind key.
const ICONS = Object.freeze({
  station: '<rect x="2" y="3" width="12" height="10" rx="3"/><path d="M2 8h12"/><circle cx="5" cy="14" r="1.5"/><circle cx="11" cy="14" r="1.5"/>',
  tower: '<path d="M6 2h4v14H6z"/><path d="M7 5h2M7 8h2M7 11h2"/>',
  peak: '<path d="M1 14 6 4l3 6 2-3 4 7z"/>',
  dam: '<path d="M2 4h12v4H2z"/><path d="M3 9c3 2 7 2 10 0"/>',
  airport: '<path d="M8 2 6 8 2 10v2l4-1v3L4 15v1l4-1 4 1v-1l-2-1v-3l4 1v-2z"/>',
  attraction: '<path d="m8 2 1.8 3.7 4.2.6-3 2.9.7 4.1L8 11.4 4.3 13.3l.7-4.1-3-2.9 4.2-.6z"/>',
  corporate: '<path d="M3 14V3h7v11M10 7h4v7M5 5h2M5 8h2M5 11h2"/>',
  default: '<path fill-rule="evenodd" d="M8 1a5 5 0 0 0-5 5c0 3.6 5 9 5 9s5-5.4 5-9a5 5 0 0 0-5-5zm0 3.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z"/>',
});

const ALIASES = Object.freeze({ subway: 'station', rail: 'station', train: 'station', building: 'corporate', office: 'corporate' });

/** First recognized kind wins; unrecognized kinds get the generic pin icon. */
export function landmarkPinIcon(record) {
  const kinds = Array.isArray(record?.kinds) ? record.kinds : [];
  const key = kinds.map(kind => ALIASES[kind] ?? kind).find(kind => Object.hasOwn(ICONS, kind)) ?? 'default';
  return `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONS[key]}</svg>`;
}
