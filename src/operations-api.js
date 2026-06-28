import { supabase } from './supabase-client.js';

const SELECT_COLUMNS = 'id,legacy_id,account,typeflux,cat1,cat2,cat3,compte,season,nature,libelle,op_date,debit,credit,adherent,justif,comment,orig_status,is_prev,status,manual_order,created_at,updated_at,lettrage,pointage,source_payload';

export function fromDb(row){
  return {
    id: row.id,
    legacyId: row.legacy_id || '',
    account: row.account || 'CC',
    typeflux: row.typeflux || '',
    cat1: row.cat1 || '',
    cat2: row.cat2 || '',
    cat3: row.cat3 || '',
    compte: row.compte || '',
    season: row.season || '',
    nature: row.nature || '',
    libelle: row.libelle || '',
    date: row.op_date || '',
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
    adherent: row.adherent || '',
    justif: row.justif || '',
    comment: row.comment || '',
    origStatus: row.orig_status || '',
    isPrev: Boolean(row.is_prev),
    status: row.status || '',
    manualOrder: row.manual_order ?? null,
    lettrage: row.lettrage || '',
    pointage: row.pointage || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourcePayload: row.source_payload || {}
  };
}

export function toDb(op){
  return {
    legacy_id: op.legacyId || op.legacy_id || `web_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    account: op.account || 'CC',
    typeflux: op.typeflux || '',
    cat1: op.cat1 || '',
    cat2: op.cat2 || '',
    cat3: op.cat3 || '',
    compte: op.compte || '',
    season: op.season || '',
    nature: op.nature || '',
    libelle: op.libelle || '',
    op_date: op.date || null,
    debit: Number(op.debit || 0),
    credit: Number(op.credit || 0),
    adherent: op.adherent || '',
    justif: op.justif || '',
    comment: op.comment || '',
    orig_status: op.origStatus || '',
    is_prev: Boolean(op.isPrev),
    status: op.status || '',
    manual_order: op.manualOrder ?? null,
    lettrage: op.lettrage || '',
    pointage: op.pointage || '',
    source_payload: op.sourcePayload || {}
  };
}

export async function fetchAllOperations(){
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while(true){
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('operations')
      .select(SELECT_COLUMNS)
      .order('op_date', { ascending:false, nullsFirst:true })
      .order('manual_order', { ascending:true, nullsFirst:false })
      .range(from, to);
    if(error) throw error;
    rows.push(...(data || []));
    if(!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows.map(fromDb);
}

export async function upsertOperation(op){
  const payload = toDb(op);
  let query;
  if(op.id){
    query = supabase.from('operations').update(payload).eq('id', op.id).select(SELECT_COLUMNS).single();
  }else{
    query = supabase.from('operations').insert(payload).select(SELECT_COLUMNS).single();
  }
  const { data, error } = await query;
  if(error) throw error;
  return fromDb(data);
}

export async function deleteOperation(id){
  const { error } = await supabase.from('operations').delete().eq('id', id);
  if(error) throw error;
}
