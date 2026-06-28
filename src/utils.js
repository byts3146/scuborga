export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value){
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

export function euro(value){
  const n = Number(value || 0);
  return n.toLocaleString('fr-FR', { style:'currency', currency:'EUR' });
}

export function fmtDate(value){
  if(!value) return '—';
  const d = new Date(value + 'T00:00:00');
  if(Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('fr-FR');
}

export function todayIso(){ return new Date().toISOString().slice(0,10); }

export function seasonFromDate(date){
  if(!date) return '';
  const d = new Date(date + 'T00:00:00');
  if(Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const start = m >= 9 ? y : y - 1;
  return `${start}-${start + 1}`;
}

export function downloadJson(filename, payload){
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json;charset=utf-8' });
  downloadBlob(filename, blob);
}

export function downloadCsv(filename, rows){
  const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8' });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function debounce(fn, delay=180){
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

export function groupBy(items, keyFn){
  const map = new Map();
  for(const item of items){
    const key = keyFn(item);
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}
