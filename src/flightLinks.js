import { flightCombinations, flightUrl } from './config/flightUrls.js';
import { pilotCases, pilotCaseUrl } from './config/pilotCases.js';
import takeoffCodeUrl from './pilot/examples/takeoff.js?url';
import landingCodeUrl from './pilot/examples/landing.js?url';

const rows = flightCombinations();
const labels = {
  B738: 'Boeing 737-800', C172: 'Cessna 172', F16: 'F-16',
  coastal: '해안 · Coastal', lukla: '루클라 · Lukla', incheon: '인천 · Incheon',
  neon: '네온 시티 · Neon', hangang: '한강 · Hangang', runway: '활주로 이륙',
  approach: '착륙 접근', cruise: '순항', cliff: '절벽 이륙', demo: '자동 비행 데모',
};
const filters = {};
for (const [key, name] of [['aircraft', '기종'], ['airport', '지형'], ['scenario', '시나리오']]) {
  const label = document.createElement('label');
  label.textContent = `${name} `;
  const select = document.createElement('select');
  select.add(new Option('전체', ''));
  for (const value of new Set(rows.map(row => row[key]))) select.add(new Option(labels[value] ?? value, value));
  filters[key] = select;
  select.addEventListener('change', render);
  label.append(select);
  document.getElementById('filters').append(label);
}
function render() {
  const visible = rows.filter(row => Object.entries(filters).every(([key, select]) => !select.value || row[key] === select.value));
  document.getElementById('count').textContent = `${visible.length} / ${rows.length}개 조합`;
  document.getElementById('flights').replaceChildren(...visible.map(row => {
    const tr = document.createElement('tr');
    for (const key of ['aircraft', 'airport', 'scenario']) {
      const td = document.createElement('td');
      td.textContent = `${labels[row[key]] ?? row[key]} (${row[key]})`;
      tr.append(td);
    }
    const td = document.createElement('td');
    const a = document.createElement('a');
    a.href = flightUrl(row);
    a.textContent = a.href;
    td.append(a); tr.append(td);
    return tr;
  }));
}
render();

document.getElementById('pilot-cases').replaceChildren(...pilotCases().map(row => {
  const tr = document.createElement('tr');
  const label = document.createElement('td');
  label.textContent = row.label;
  const td = document.createElement('td');
  const link = document.createElement('a');
  link.href = pilotCaseUrl(row, new URL('./', location.href));
  link.textContent = '게임에서 실시간으로 보기';
  td.append(link); tr.append(label, td);
  const codeCell = document.createElement('td');
  const codeLink = document.createElement('a');
  codeLink.href = row.type === 'takeoff' ? takeoffCodeUrl : landingCodeUrl;
  codeLink.textContent = `${row.type}.js`;
  codeLink.target = '_blank';
  codeLink.rel = 'noopener noreferrer';
  codeCell.append(codeLink); tr.append(codeCell);
  return tr;
}));
