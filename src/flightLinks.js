import { flightCombinations, flightUrl } from './config/flightUrls.js';
import { pilotCases, pilotCaseUrl } from './config/pilotCases.js';
import { selectFlightLink } from './config/flightLinkSelection.js';

// Include readable source from this deployment, including newly added pilots.
const sourceUrls = import.meta.glob('./pilot/examples/*.js', {
  eager: true, query: '?url&no-inline', import: 'default',
});
const base = new URL('./', location.href);
const labels = {
  B738: 'Boeing 737-800', C172: 'Cessna 172', F16: 'F-16',
  coastal: '해안 · Coastal', lukla: '루클라 · Lukla', incheon: '인천 · Incheon',
  neon: '네온 시티 · Neon', hangang: '한강 · Hangang', runway: '활주로 이륙',
  approach: '착륙 접근', cruise: '순항', cliff: '절벽 이륙', demo: '자동 비행 데모',
  takeoff: 'B738 · 이륙', landing: 'B738 · 착륙', valley: 'F-16 · 루클라 계곡 저공',
  'calm-debug-v1': '무풍 기준', 'mild-disturbance-v1': '약한 측풍·돌풍',
};

function selectors(target, rows, fields, initial, onSelect) {
  let selection = { ...initial };
  const selects = {};
  for (const [key, title] of fields) {
    const label = document.createElement('label');
    label.textContent = `${title} `;
    const select = document.createElement('select');
    selects[key] = select;
    select.addEventListener('change', () => { selection[key] = select.value; render(); });
    label.append(select);
    target.append(label);
  }
  function render() {
    const result = selectFlightLink(rows, selection, fields.map(([key]) => key));
    for (const [key] of fields) {
      const select = selects[key];
      select.replaceChildren(...result.options[key].map(value => new Option(
        key === 'seed' ? `seed ${value}` : labels[value] ?? value, String(value),
      )));
      select.disabled = result.options[key].length < 2;
      if (result.row) select.value = String(result.row[key]);
    }
    if (result.row) {
      selection = { ...result.row };
      onSelect(result.row);
    }
  }
  render();
}

selectors(document.getElementById('filters'), flightCombinations(),
  [['airport', '지형'], ['aircraft', '기종'], ['scenario', '시나리오']],
  { airport: 'coastal', aircraft: 'B738', scenario: 'runway' }, row => {
    const link = document.getElementById('flight-gameplay');
    link.href = flightUrl(row, base);
    document.getElementById('flight-url').textContent = link.href;
  });

selectors(document.getElementById('pilot-filters'), pilotCases(),
  [['type', '미션'], ['environmentProfile', '환경'], ['seed', '시드']], {}, row => {
    document.getElementById('pilot-gameplay').href = pilotCaseUrl(row, base);
    document.getElementById('pilot-description').textContent = row.label;
    const code = document.getElementById('pilot-code');
    const source = sourceUrls[`./pilot/examples/${row.type}.js`];
    code.hidden = !source;
    if (source) code.href = source;
    else code.removeAttribute('href');
  });
