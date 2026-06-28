import { groupBy } from './utils.js';

export function getSeasons(ops){
  return Array.from(new Set(ops.map(o => o.season).filter(Boolean))).sort().reverse();
}

export function amount(op){ return Number(op.credit || 0) - Number(op.debit || 0); }
export function isCharge(op){ return Number(op.debit || 0) > 0 || op.typeflux === 'CHARGES'; }
export function isProduct(op){ return Number(op.credit || 0) > 0 || op.typeflux === 'PRODUITS'; }

export function summarize(ops){
  const debit = ops.reduce((s,o)=>s+Number(o.debit||0),0);
  const credit = ops.reduce((s,o)=>s+Number(o.credit||0),0);
  return { count: ops.length, debit, credit, net: credit - debit };
}

export function filterBySeason(ops, season){
  return season ? ops.filter(o => o.season === season) : ops;
}

export function resultByCategory(ops){
  const map = groupBy(ops, o => [o.typeflux || '—', o.cat1 || '—', o.cat2 || '—'].join('||'));
  return Array.from(map.entries()).map(([key, rows]) => {
    const [typeflux, cat1, cat2] = key.split('||');
    return { typeflux, cat1, cat2, ...summarize(rows) };
  }).sort((a,b) => a.typeflux.localeCompare(b.typeflux) || a.cat1.localeCompare(b.cat1) || a.cat2.localeCompare(b.cat2));
}

export function byTrip(ops){
  const rows = ops.filter(o => o.cat3 && ['SORTIE EXPLO','SORTIE TEK','VOYAGE','PLONGEES','LOGEMENT','REPAS','TRANSPORT','ALLINCL'].includes(o.cat2));
  const map = groupBy(rows, o => o.cat3);
  return Array.from(map.entries()).map(([name, items]) => ({ name, ...summarize(items) }))
    .sort((a,b) => a.name.localeCompare(b.name));
}

export function byMember(ops){
  const rows = ops.filter(o => o.adherent);
  const map = groupBy(rows, o => o.adherent);
  return Array.from(map.entries()).map(([name, items]) => ({ name, ...summarize(items) }))
    .sort((a,b) => a.name.localeCompare(b.name));
}

export function findControls(ops){
  const duplicates = [];
  const seen = new Map();
  for(const op of ops){
    const key = [op.date || '', op.libelle || '', Number(op.debit || 0).toFixed(2), Number(op.credit || 0).toFixed(2)].join('|');
    if(!seen.has(key)) seen.set(key, []);
    seen.get(key).push(op);
  }
  for(const rows of seen.values()) if(rows.length > 1) duplicates.push(...rows);
  return {
    missingCategory: ops.filter(o => !o.typeflux || !o.cat1 || !o.cat2),
    missingSeason: ops.filter(o => !o.season),
    missingDate: ops.filter(o => !o.date),
    zeroAmount: ops.filter(o => Number(o.debit||0) === 0 && Number(o.credit||0) === 0),
    missingJustifCharges: ops.filter(o => !o.isPrev && isCharge(o) && !o.justif),
    unpointed: ops.filter(o => !o.isPrev && !o.pointage),
    previsional: ops.filter(o => o.isPrev),
    duplicates
  };
}
