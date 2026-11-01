/** Resolve dependent selectors in order, retaining only supported choices.
 * rows remain the source of truth; a selection can never invent a URL case.
 */
export function selectFlightLink(rows, selection, keys) {
  let candidates = rows;
  const options = {};
  for (const key of keys) {
    options[key] = [...new Set(candidates.map(row => row[key]))];
    const value = options[key].find(value => String(value) === String(selection[key])) ?? options[key][0];
    candidates = candidates.filter(row => row[key] === value);
  }
  return { row: candidates[0] ?? null, options };
}
