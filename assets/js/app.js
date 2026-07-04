/* Logique applicative ScubOrga : Store, CloudSync, UI, init */
/* ============ STORE (abstraction — migration Supabase facile) ============ */
const Store = {
  _k:'scuborga_v0_3_0_beta',
  _legacyKeys:['scuborga_v0_1_1_beta','scuborga_v0_1_0_beta','treso_v16'],
  data:{ tx:[], rules:[], season:null, mapping:null, seq:1 },
  load(){ try{
    let r=localStorage.getItem(this._k);
    if(!r){
      const legacy=this._legacyKeys.find(k=>localStorage.getItem(k));
      if(legacy) r=localStorage.getItem(legacy);
    }
    if(r)this.data=JSON.parse(r);
  }catch(e){} },
  save(){ localStorage.setItem(this._k, JSON.stringify(this.data)); },
  all(){ return this.data.tx; },
  add(t){ t.id='t'+(this.data.seq++); this.data.tx.push(t); this.save(); CloudSync.pushTx(t); CloudSync.pushSeq(); return t; },
  update(id,patch){ const t=this.data.tx.find(x=>x.id===id); if(t){Object.assign(t,patch);this.save();CloudSync.pushTx(t);} return t; },
  remove(id){ this.data.tx=this.data.tx.filter(x=>x.id!==id); this.save(); CloudSync.deleteTx(id); },
  addRule(r){ this.data.rules=this.data.rules.filter(x=>x.match!==r.match); this.data.rules.push(r); this.save(); CloudSync.pushRule(r); },
  rules(){ return this.data.rules; },
  saveRef(){ this.data.ref = REF; this.save(); }
};
/* Pour migrer vers Supabase: réimplémenter add/update/remove/all en appels async
   vers supabase.from('tx'), garder la même signature. Le reste du code ne change pas. */

/* ============ SYNCHRO CLOUD — ÉCRITURE (0.5.0) ============
   Stratégie "local d'abord" : le Store écrit en local immédiatement (synchrone,
   aucun await ailleurs dans le code), puis on pousse vers Supabase en arrière-plan.
   En cas d'échec réseau, l'opération reste en file et est retentée. */

const CloudSync = {
  queue: [],          // éléments: {kind:'upsert'|'delete', id, tx?}
  pending: 0,
  failed: 0,
  running: false,
  _qKey: 'scuborga_sync_queue',
  conflicts: [],
  _cKey: 'scuborga_sync_conflicts',

  // Persiste la file en localStorage : si l'onglet se ferme avant la fin
  // d'une synchro, on ne perd plus les changements en attente (0.8.4).
  persistQueue(){ try{ localStorage.setItem(this._qKey, JSON.stringify(this.queue)); }catch(e){} },
  // Restaure la file au démarrage, une fois la connexion cloud confirmée.
  restoreQueue(){
    try{
      const r = localStorage.getItem(this._qKey);
      if(!r) return;
      const q = JSON.parse(r);
      if(Array.isArray(q) && q.length){ this.queue = q; this.pending = q.length; }
    }catch(e){}
  },
  // Conflits détectés (0.8.5) : une opération modifiée localement avait déjà
  // été modifiée ou supprimée côté cloud par un autre appareil/utilisateur.
  // On ne l'écrase pas silencieusement ; on journalise pour arbitrage manuel.
  persistConflicts(){ try{ localStorage.setItem(this._cKey, JSON.stringify(this.conflicts)); }catch(e){} },
  restoreConflicts(){
    try{
      const r = localStorage.getItem(this._cKey);
      if(!r) return;
      const c = JSON.parse(r);
      if(Array.isArray(c)) this.conflicts = c;
    }catch(e){}
  },
  logConflict(id, reason){
    this.conflicts.push({ id, reason, when: new Date().toISOString() });
    this.persistConflicts();
    this.updateBadge();
    toast('⚠ Conflit de synchro sur '+id);
    console.warn('Conflit CloudSync', id, reason);
  },
  // Retire un conflit résolu (quelle que soit l'action choisie par l'utilisateur).
  clearConflict(id){
    this.conflicts=this.conflicts.filter(c=>c.id!==id);
    this.persistConflicts();
    this.updateBadge();
  },

  // Mappe une opération interne -> ligne Supabase (colonnes réelles de la table)
  txToRow(t){
    return {
      legacy_id: t.id,
      account: t.account || 'CC',
      typeflux: t.typeflux || '',
      cat1: t.cat1 || '', cat2: t.cat2 || '', cat3: t.cat3 || '',
      compte: t.compte || '',
      season: t.season || '',
      nature: t.nature || '',
      libelle: t.libelle || '',
      op_date: (t.date && String(t.date).trim()) ? t.date : null,
      debit: Number(t.debit || 0),
      credit: Number(t.credit || 0),
      adherent: t.adherent || '',
      justif: t.justif || '',
      comment: t.comment || '',
      lettrage: t.lettrage || '',
      pointage: t.pointage || '',
      orig_status: t.origStatus || '',
      is_prev: !!t.isPrev,
      status: t.status || ''
    };
  },

  enqueue(item){
    if(!sb) return;                       // hors-ligne total : on ne tente rien
    if(Store.data._fromCloud!==true) return; // sécurité : ne pousse que si on lit le cloud
    this.queue.push(item);
    this.pending=this.queue.length;
    this.persistQueue();
    this.updateBadge();
    this.run();
  },

  pushTx(t){ this.enqueue({kind:'upsert', id:t.id, row:this.txToRow(t), baseline:t._cloudUpdatedAt||null}); },
  deleteTx(id){ this.enqueue({kind:'delete', id}); },

  // Réglages (seq, realBalances, defaultSeason) -> table settings
  pushSetting(key, value){
    if(!sb) return;
    if(Store.data._fromCloud!==true) return;
    this.queue.push({kind:'setting', key, value});
    this.pending=this.queue.length;
    this.persistQueue();
    this.updateBadge();
    this.run();
  },
  pushSeq(){ this.pushSetting('seq', Store.data.seq); },
  pushBalances(){ this.pushSetting('realBalances', Store.data.realBalances||{}); },

  // Tables de classification -> table classification_sheets (upsert par nom)
  pushSheet(name){
    if(!sb) return;
    if(Store.data._fromCloud!==true) return;
    const sh = (Store.data.sheets && Store.data.sheets[name]) || (typeof SHEETS!=='undefined' && SHEETS[name]);
    if(!sh) return;
    this.queue.push({kind:'sheet', name, header: sh.header||[], rows: sh.rows||[]});
    this.pending=this.queue.length; this.persistQueue(); this.updateBadge(); this.run();
  },
  // Pousse toutes les tables (utile après un import/réorganisation globale)
  pushAllSheets(){
    const src = Store.data.sheets || (typeof SHEETS!=='undefined' ? SHEETS : {});
    Object.keys(src||{}).forEach(n=>this.pushSheet(n));
  },
  // Règles -> table rules (upsert par match)
  pushRule(r){
    if(!sb) return;
    if(Store.data._fromCloud!==true) return;
    this.queue.push({kind:'rule', rule:{match:r.match, typeflux:r.typeflux||'', cat1:r.cat1||'', cat2:r.cat2||'', cat3:r.cat3||''}});
    this.pending=this.queue.length; this.persistQueue(); this.updateBadge(); this.run();
  },
  deleteRule(match){
    if(!sb) return;
    if(Store.data._fromCloud!==true) return;
    this.queue.push({kind:'ruleDelete', match});
    this.pending=this.queue.length; this.persistQueue(); this.updateBadge(); this.run();
  },

  async run(){
    if(this.running || !sb) return;
    this.running=true;
    while(this.queue.length){
      const item=this.queue[0];
      try{
        if(item.kind==='upsert'){
          if(item.baseline){
            // La ligne existait déjà côté cloud lors de notre dernière lecture :
            // on vérifie qu'elle n'a pas été modifiée/supprimée entre-temps
            // par un autre appareil avant d'écraser (0.8.5).
            const { data:cur, error:qErr } = await sb.from('operations')
              .select('updated_at').eq('legacy_id', item.id).maybeSingle();
            if(qErr) throw qErr;
            if(!cur){
              this.logConflict(item.id, 'supprimée côté cloud pendant une modification locale');
              this.queue.shift(); this.pending=this.queue.length; this.persistQueue(); this.updateBadge();
              continue;
            }
            if(cur.updated_at!==item.baseline){
              this.logConflict(item.id, 'modifiée par ailleurs entre-temps (cloud plus récent)');
              this.queue.shift(); this.pending=this.queue.length; this.persistQueue(); this.updateBadge();
              continue;
            }
          }
          const { data:upd, error } = await sb.from('operations')
            .upsert(item.row, { onConflict:'legacy_id' })
            .select('legacy_id, updated_at').maybeSingle();
          if(error) throw error;
          if(upd){
            const t=Store.data.tx.find(x=>x.id===upd.legacy_id);
            if(t){ t._cloudUpdatedAt=upd.updated_at; Store.save(); }
          }
        } else if(item.kind==='delete'){
          const { error } = await sb.from('operations')
            .delete().eq('legacy_id', item.id);
          if(error) throw error;
        } else if(item.kind==='setting'){
          const { error } = await sb.from('settings')
            .upsert({ key:item.key, value:item.value, updated_at:new Date().toISOString() }, { onConflict:'key' });
          if(error) throw error;
        } else if(item.kind==='sheet'){
          const { error } = await sb.from('classification_sheets')
            .upsert({ name:item.name, header:item.header, rows:item.rows, updated_at:new Date().toISOString() }, { onConflict:'name' });
          if(error) throw error;
        } else if(item.kind==='rule'){
          const { error } = await sb.from('rules')
            .upsert({ ...item.rule, updated_at:new Date().toISOString() }, { onConflict:'match' });
          if(error) throw error;
        } else if(item.kind==='ruleDelete'){
          const { error } = await sb.from('rules')
            .delete().eq('match', item.match);
          if(error) throw error;
        }
        this.queue.shift();               // succès : on retire de la file
        this.failed=0;
        this.pending=this.queue.length;
        this.persistQueue();
        this.updateBadge();
      }catch(e){
        // Échec (réseau ?) : on s'arrête, on retentera au prochain déclenchement
        console.warn('Sync cloud échec, en attente de retry', e);
        this.failed=this.queue.length;
        this.running=false;
        this.updateBadge();
        setTimeout(()=>this.run(), 8000); // retry automatique dans 8s
        return;
      }
    }
    this.running=false;
    this.updateBadge();
  },

  updateBadge(){
    const el=document.getElementById('syncBadge');
    if(!el) return;
    if(this.conflicts.length>0){ el.textContent='⚠︎ '+this.conflicts.length+' conflit(s)'; el.className='sync-warn'; return; }
    if(this.queue.length===0){ el.textContent='☁︎ Synchronisé'; el.className='sync-ok'; }
    else if(this.failed>0){ el.textContent='⚠︎ '+this.queue.length+' en attente'; el.className='sync-warn'; }
    else { el.textContent='⟳ Envoi… ('+this.queue.length+')'; el.className='sync-busy'; }
  }
};

/* ============ SUPABASE — AUTHENTIFICATION (0.3.1) ============ */
const SB_URL = 'https://jwwxcdkmlpewbnnstyrc.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3d3hjZGttbHBld2JubnN0eXJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzEzMjUsImV4cCI6MjA5NzkwNzMyNX0.VkiEZfGTbOzvkP4CKTmspUOJE0alRmcwzY-pfwiPSE4';
let sb = null;
try { sb = window.supabase.createClient(SB_URL, SB_ANON); } catch(e){ console.warn('Supabase non chargé', e); }

function $a(id){ return document.getElementById(id); }

async function doLogin(){
  const email=($a('authEmail').value||'').trim();
  const pass=$a('authPass').value||'';
  const errEl=$a('authError'); errEl.style.color='var(--red)'; errEl.textContent='';
  if(!email||!pass){ errEl.textContent='Renseigne ton email et ton mot de passe.'; return; }
  if(!sb){ errEl.textContent='Connexion au serveur impossible (réseau ?).'; return; }
  const btn=$a('authBtn'); btn.disabled=true; btn.textContent='Connexion…';
  try{
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if(error){ errEl.textContent = traduireErreurAuth(error.message); btn.disabled=false; btn.textContent='Se connecter'; return; }
    onAuthOK();
  }catch(e){ errEl.textContent='Erreur réseau. Réessaie.'; btn.disabled=false; btn.textContent='Se connecter'; }
}

async function doReset(){
  const email=($a('authEmail').value||'').trim();
  const errEl=$a('authError');
  if(!email){ errEl.style.color='var(--red)'; errEl.textContent='Saisis d\u2019abord ton email, puis reclique sur « Mot de passe oublié ».'; return; }
  if(!sb){ errEl.textContent='Connexion au serveur impossible.'; return; }
  try{
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://byts3146.github.io/scuborga/' });
    errEl.style.color = error ? 'var(--red)' : 'var(--green)';
    errEl.textContent = error ? traduireErreurAuth(error.message) : 'Email de réinitialisation envoyé. Vérifie ta boîte mail.';
  }catch(e){ errEl.style.color='var(--red)'; errEl.textContent='Erreur réseau.'; }
}

async function doLogout(){
  if(sb){ try{ await sb.auth.signOut(); }catch(e){} }
  location.reload();
}

function traduireErreurAuth(msg){
  msg=(msg||'').toLowerCase();
  if(msg.includes('invalid login')) return 'Email ou mot de passe incorrect.';
  if(msg.includes('email not confirmed')) return 'Email non confirmé. Vérifie ta boîte mail.';
  if(msg.includes('rate limit')) return 'Trop de tentatives. Patiente un instant.';
  return 'Connexion impossible : '+msg;
}

function onAuthOK(){
  const gate=$a('authGate'); if(gate) gate.style.display='none';
  startApp();
}

// Restaure une session existante pour éviter de retaper le mot de passe à chaque ouverture.
async function checkSession(){
  if(!sb) return;
  try{
    const { data } = await sb.auth.getSession();
    if(data && data.session){ onAuthOK(); return; }
  }catch(e){}
}

// Entrée au clavier = se connecter (tant que l'écran de connexion est affiché)
document.addEventListener('keydown',e=>{
  const g=$a('authGate');
  if(e.key==='Enter' && g && g.style.display!=='none'){ doLogin(); }
});

/* ============ APP META ============ */
const APP_META={name:'Scuborga',version:'0.9.5',channel:'bêta',storageKey:'scuborga_v0_3_0_beta'};
document.title=`${APP_META.name} · ${APP_META.channel} ${APP_META.version}`;

/* ============ HELPERS ============ */
const $=s=>document.querySelector(s);
const eur=n=>(n<0?'-':'')+'€'+Math.abs(n).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const norm=s=>(s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),1800);}
function amt(t){ return (t.credit||0) - (t.debit||0); }
function isClassified(t){ return t.cat1 && t.cat2; }

/* seasons */
function allSeasons(){
  const s=new Set(Store.all().map(t=>t.season).filter(Boolean));
  ['2023-2024','2024-2025','2025-2026','2026-2027'].forEach(x=>s.add(x));
  (Store.data.extraSeasons||[]).forEach(x=>s.add(x));
  return [...s].sort();
}
function curSeason(){
  if(Store.data.season) return Store.data.season;
  const def = Store.data.defaultSeason || '2025-2026';
  return allSeasons().includes(def) ? def : (allSeasons().slice(-1)[0]);
}

/* ============ NAV ============ */
const titles={dash:'Tableau de bord',import:'Importer',classer:'À classer',ops:'Opérations',report:'Bilans',controls:'Contrôles',param:'Paramètres'};
function go(v){
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  $('#v-'+v).classList.add('active');
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  $('#hTitle').textContent=titles[v]||'';
  window.scrollTo(0,0);
  if(v==='dash')renderDash();
  if(v==='classer')renderClasser();
  if(v==='ops')renderOps();
  if(v==='report')renderReport();
  if(v==='controls')renderControls();
  if(v==='param'){ paramView=null; tableSheet=null; renderParam(); }
}

// Redessine la vue actuellement affichée (sans changer de page).
// Utile après une écriture pour que la liste se mette à jour immédiatement.
function refreshCurrent(){
  const act=document.querySelector('.view.active');
  if(!act) return;
  const v=act.id.replace('v-','');
  if(v==='dash')renderDash();
  else if(v==='classer')renderClasser();
  else if(v==='ops')renderOps();
  else if(v==='report')renderReport();
  else if(v==='controls')renderControls();
}

/* ============ DASHBOARD ============ */
function seasonTx(){ const s=curSeason(); return Store.all().filter(t=>!s||t.season===s); }
const ACCOUNTS={CC:'Compte courant', EP:'Livret épargne'};
function renderDash(){
  const sel=$('#seasonSel'); const seasons=allSeasons();
  sel.innerHTML=seasons.map(s=>`<option ${s===curSeason()?'selected':''}>${s}</option>`).join('');
  sel.onchange=()=>{Store.data.season=sel.value;Store.save();renderDash();};
  const tx=seasonTx();
  let prod=0,char=0,unc=0;
  tx.forEach(t=>{ if(isDraft(t)||isFuture(t))return; if(!isClassified(t)){unc++;return;} const a=amt(t); if(t.typeflux==='PRODUITS')prod+=a; else char+=a; });
  $('#kProd').textContent=eur(prod);
  $('#kChar').textContent=eur(char);
  const res=prod+char;
  $('#kRes').textContent=eur(res); $('#kRes').style.color=res>=0?'var(--green)':'var(--red)';
  $('#kUnc').textContent=unc;
  renderDashAttention();

  // Soldes de trésorerie = solde réel saisi (Réglages), affiché tel quel (source: relevé bancaire)
  const real=Store.data.realBalances||{};
  const accLast={};
  Store.all().forEach(t=>{ if(isDraft(t)||isFuture(t))return; const a=t.account||'CC';
    if(t.date && (!accLast[a]||t.date>accLast[a])) accLast[a]=t.date; });
  const accs=Object.keys(ACCOUNTS).filter(a=>accLast[a]||real[a]!=null);
  $('#soldesCard').innerHTML=`<h2>Trésorerie</h2>`+accs.map(a=>{
    const bal=parseFloat(real[a]); const has=!isNaN(bal);
    const last=accLast[a];
    return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line)">
      <div><div style="font-weight:600;font-size:14px">${ACCOUNTS[a]}</div>
        <div class="tag">${last?'maj '+fmtDateFull(last):'—'}</div></div>
      <div style="font-weight:700;font-size:17px;color:${!has?'var(--muted)':bal>=0?'var(--green)':'var(--red)'}">${has?eur(bal):'à renseigner'}</div>
    </div>`;
  }).join('')+`<div class="tag" style="margin-top:8px">Solde réel modifiable dans Paramètres → Soldes des comptes.</div>`;

  updateBadge();
  // Dernières opérations — toutes saisons, plus récentes d'abord
  const recent=sortRecent(Store.all().filter(t=>!isDraft(t))).slice(0,8);
  $('#recentList').innerHTML = recent.length? recent.map(txRow).join('') :
    '<div class="empty" style="padding:20px">Aucune opération. Importe un relevé ou ajoute un flux.</div>';
  attachTxClicks('#recentList');
}
function fmtDateFull(d){ if(!d)return''; const p=String(d).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d; }

/* ============ TX ROW ============ */
// Couleur sémantique par famille de Cat 2, croisée avec le sens (débit/crédit).
// Familles → teinte HSL. On choisit la famille selon la cat2 et le signe du montant.
const CAT_HUE={
  // crédits
  sortie_credit:140,   // vert : sorties explo/tek, voyage, baptêmes
  adhesion_credit:210, // bleu : adhésion, licence, assurance, formation (recettes)
  autre_credit:175,    // turquoise : repas, textiles, dons, autres recettes
  // débits
  sortie_debit:350,    // rouge/rose : sorties, plongées, logement, transport, repas (dépenses), all-in
  licence_debit:28,    // orange : licence, assurance (dépenses)
  cf_debit:48,         // jaune : charges fixes (frais, cotisations, AG, matériel…)
  autre_debit:8        // rouge profond : reste des charges variables
};
function catFamily(t){
  const c2=(t.cat2||'').toUpperCase();
  const credit=amt(t)>=0;
  if(credit){
    if(/SORTIE|VOYAGE|BAPTEME/.test(c2)) return 'sortie_credit';
    if(/ADHESION|LICENCE|ASSURANCE|FORMATION/.test(c2)) return 'adhesion_credit';
    return 'autre_credit';
  } else {
    if(t.cat1==='CF') return 'cf_debit';
    if(/LICENCE|ASSURANCE/.test(c2)) return 'licence_debit';
    if(/SORTIE|VOYAGE|BAPTEME|PLONGEE|LOGEMENT|TRANSPORT|REPAS|ALLINCL/.test(c2)) return 'sortie_debit';
    return 'autre_debit';
  }
}
function pillCat(t){
  if(!isClassified(t)) return '<span class="pill" style="background:rgba(154,103,0,.12);color:var(--amber)">À classer</span>';
  const hue=CAT_HUE[catFamily(t)]||210;
  const style2=`background:hsl(${hue} 65% 92%);color:hsl(${hue} 70% 30%);border:1px solid hsl(${hue} 45% 78%)`;
  const style3=`background:hsl(${hue} 55% 87%);color:hsl(${hue} 65% 24%);border:1px solid hsl(${hue} 40% 70%)`;
  return `<span class="pill catpill" style="${style2}">${esc(t.cat2)}</span>`+
    (t.cat3?`<span class="pill catpill cat3pill" style="${style3}">${esc(t.cat3)}</span>`:'');
}
function isFuture(t){ return !!(t.origStatus && String(t.origStatus).trim()) || t.isPrev; }
function isDraft(t){ return t.status==='draft'; }
function txRow(t,opts){
  opts=opts||{};
  const a=amt(t); const prev=isFuture(t);
  const handle = opts.drag ? `<div class="draghandle" title="Glisser pour réordonner" onclick="event.stopPropagation()">⠿</div>` : '';
  const running = (opts.running!=null) ? `<div class="run">${eur(opts.running)}</div>` : '';
  return `<div class="tx ${isClassified(t)?'':'unclassified'}" data-id="${t.id}" ${opts.drag?'draggable="true"':''}>
    ${handle}
    <div class="grow">
      <div class="lib">${esc(t.libelle||'(sans libellé)')}</div>
      <div class="meta">
        ${pillCat(t)}
        ${t.adherent && norm(t.adherent)!==norm(t.libelle||'') ? `<span class="tag adh">👤 ${esc(t.adherent)}</span>` : ''}
        ${t.nature?`<span class="tag">${t.nature}</span>`:''}
        ${t.date?`<span>${fmtDateY(t.date)}</span>`:''}
        ${prev?'<span class="pill prev">prévu</span>':''}
      </div>
    </div>
    <div style="text-align:right">
      <div class="amt ${a>=0?'pos':'neg'}">${eur(a)}</div>
      ${running}
    </div>
  </div>`;
}
function attachTxClicks(sel){ document.querySelectorAll(sel+' .tx').forEach(el=>el.onclick=()=>openTx(el.dataset.id)); }
const esc=s=>(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function fmtDate(d){ if(!d)return''; const p=String(d).split('-'); return p.length===3?`${p[2]}/${p[1]}`:d; }
function fmtDateY(d){ if(!d)return''; const p=String(d).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d; }

/* ============ CLASSER ============ */
function unclassifiedTx(){ return Store.all().filter(t=>!isClassified(t) && !isFuture(t)); }

/* Incohérences détectées sur les lignes classées :
   - compte ne correspond pas au compte attendu pour (type/cat1/cat2)
   - cat3 manquante alors que la catégorie propose des sous-catégories
   - débit ET crédit renseignés en même temps */
function incoherences(t){
  const issues=[];
  if(t.typeflux && t.cat1 && t.cat2){
    const expected=REF.compte[t.typeflux+'||'+t.cat1+'||'+t.cat2];
    if(expected && t.compte && t.compte!==expected) issues.push('compte ≠ catégorie');
    // cat3 requise seulement pour les catégories liées à une sortie/voyage/formation
    const C3REQ=['SORTIE EXPLO','SORTIE TEK','VOYAGE','BAPTEMES','FORMATION','ALLINCL',
      'LOGEMENT','PLONGEES','REPAS','TRANSPORT'];
    if(C3REQ.includes(t.cat2)){
      const c3opts=REF.cat3[t.typeflux+'||'+t.cat2]||[];
      if(c3opts.length && !t.cat3) issues.push('sous-catégorie manquante');
    }
  }
  if((t.debit||0)>0 && (t.credit||0)>0) issues.push('débit + crédit');
  return issues;
}
function incoherentTx(){ return Store.all().filter(t=>isClassified(t) && !isFuture(t) && !isDraft(t) && incoherences(t).length); }
function draftTx(){ return Store.all().filter(isDraft); }

let draftSel=new Set();
function draftRow(t){
  const checked=draftSel.has(t.id);
  const sug=!isClassified(t)?suggest(t):null;
  const inc=incoherences(t);
  const incTags=inc.map(x=>`<span class="pill" style="background:rgba(207,34,46,.12);color:var(--red)">${x}</span>`).join('');
  return `<div class="tx draftrow ${checked?'sel':''}" data-id="${t.id}">
    <input type="checkbox" class="drcheck" ${checked?'checked':''} onclick="event.stopPropagation();toggleDraft('${t.id}',this.checked)">
    <div class="grow" onclick="openTx('${t.id}','REEL')">
      <div class="lib">${esc(t.libelle||'(sans libellé)')}</div>
      <div class="meta"><span>${fmtDateY(t.date)}</span>${t.nature?`<span class="tag">${t.nature}</span>`:''}
        ${t.isPrev?'<span class="pill prev">future</span>':''}
        ${t.cat2?pillCat(t):'<span class="pill" style="background:rgba(154,103,0,.12);color:var(--amber)">à classer</span>'}
        ${sug?`<span class="pill prev">≈ ${esc(sug.cat2)}</span>`:''}
        ${incTags}</div>
    </div>
    <div class="amt ${amt(t)>=0?'pos':'neg'}" onclick="openTx('${t.id}','REEL')">${eur(amt(t))}</div>
  </div>`;
}

function renderClasser(){
  $('#incoherZone').innerHTML='';
  const list=sortRecent(draftTx());
  // nettoyer la sélection des ids disparus
  draftSel=new Set([...draftSel].filter(id=>list.some(t=>t.id===id)));
  $('#classerHead').textContent = list.length ? `Brouillon · ${list.length} ligne(s)` : '';
  $('#classerEmpty').style.display=list.length?'none':'block';
  $('#classerList').innerHTML=list.map(draftRow).join('');
  updateDraftBar();
  updateBadge();
}
function toggleDraft(id,on){ if(on)draftSel.add(id); else draftSel.delete(id);
  const row=document.querySelector(`.draftrow[data-id="${id}"]`); if(row)row.classList.toggle('sel',on);
  updateDraftBar(); }
function toggleAllDrafts(on){ draftSel = on ? new Set(draftTx().map(t=>t.id)) : new Set(); renderClasser(); }
function updateDraftBar(){
  const n=draftSel.size, total=draftTx().length;
  $('#draftActions').style.display=total?'flex':'none';
  $('#draftSelCount').textContent=n?`${n} sélectionnée(s)`:'';
  const all=$('#draftAll'); if(all){ all.checked=n>0&&n===total; all.indeterminate=n>0&&n<total; }
}
function draftAction(act){
  const ids=[...draftSel];
  if(!ids.length){ toast('Sélectionne au moins une ligne'); return; }
  const sel=ids.map(id=>Store.all().find(t=>t.id===id)).filter(Boolean);
  if(act==='add'){
    sel.forEach(t=>{
      const patch={status:''}; // n'est plus brouillon
      if(t.isPrev){ patch.origStatus=t.origStatus&&t.origStatus.trim()?t.origStatus:'ATT'; }
      else { patch.origStatus=''; }
      Store.update(t.id,patch);
    });
    draftSel.clear(); toast(`${sel.length} ajoutée(s) aux opérations`); renderClasser();
  } else if(act==='dup'){
    sel.forEach(t=>{ const c=JSON.parse(JSON.stringify(t)); delete c.id; c.status='draft'; Store.add(c); });
    toast(`${sel.length} dupliquée(s)`); renderClasser();
  } else if(act==='del'){
    confirmModal(`Supprimer ${sel.length} ligne(s) du brouillon ?`, ()=>{
      ids.forEach(id=>Store.remove(id)); draftSel.clear(); toast('Supprimé'); renderClasser();
    }, '🗑 Supprimer');
  } else if(act==='edit'){
    if(sel.length===1){ openTx(sel[0].id,'REEL'); }
    else openMultiEdit(sel);
  }
}
function updateBadge(){ const n=draftTx().length+unclassifiedTx().length+incoherentTx().length; const b=$('#navBadge');
  b.style.display=n?'flex':'none'; b.textContent=n; }

/* auto-classify suggestion via rules */
function suggest(t){
  const lib=norm(t.libelle);
  for(const r of Store.rules()){ if(lib.includes(norm(r.match))) return r; }
  return null;
}

/* ============ EDIT / CLASSIFY SHEET ============ */
let editId=null;
let newKind='PREV';
let _txPreset=null;
function saveTxAndNew(){ saveTx(true); }
function openTx(id,kind){
  editId=id; newKind = kind || 'PREV';
  const isFut = newKind==='PREV';
  const t = id ? Store.all().find(x=>x.id===id) : (_txPreset || {typeflux:'',cat1:'',cat2:'',cat3:'',compte:'',
     nature:'',libelle:'',date:new Date().toISOString().slice(0,10),debit:0,credit:0,
     season:curSeason(),adherent:'',justif:'',comment:'',isPrev:isFut,origStatus:isFut?'ATT':''});
  const isNew=!id;
  const sug = id && !isClassified(t) ? suggest(t) : null;
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="sheet-head"><div class="grab"></div><button type="button" class="sheet-close" onclick="closeSheet()" aria-label="Fermer">✕</button></div>
    <h2>${isNew?(isFut?'Nouveau flux futur':'Nouvelle opération'):'Classer / éditer'}</h2>
    ${sug?`<div class="rulehint">⚡ Suggestion: <b>${sug.cat2}</b>${sug.cat3?' / '+sug.cat3:''}
       &nbsp;<button class="btn sm" style="margin-left:auto" onclick="applySug('${sug.match}')">Appliquer</button></div>`:''}
    <div class="field"><label id="fLibLabel">Libellé</label>
      <input id="fLib" autocomplete="off" value="${esc(t.libelle||'').replace(/"/g,'&quot;')}">
      <div id="libNames"></div>
      <div id="libSug"></div></div>
    <div class="row">
      <div class="field"><label>Date</label><input id="fDate" type="date" value="${t.date||''}"></div>
      <div class="field"><label>Nature</label>
        <div class="combo"><input id="fNat" autocomplete="off" value="${esc(natureLabel(t.nature))}"><div class="combodrop" id="fNat_d"></div></div></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin:-4px 0 12px;font-weight:600">
      <input type="checkbox" id="fFuture" style="width:auto" ${(isNew?isFut:isFuture(t))?'checked':''}>
      Opération future / en attente (non encore passée en banque)</label>
    <div class="field"><label>Compte bancaire</label>
      <div class="seg-row" id="accSeg">
        <button type="button" class="seg-btn" data-acc="CC" onclick="setAccount('CC')">Compte courant</button>
        <button type="button" class="seg-btn" data-acc="EP" onclick="setAccount('EP')">Épargne</button>
      </div></div>
    <div class="field"><label>Montant</label>
      <div class="amount-row">
        <button type="button" id="fSign" class="sign-btn" onclick="toggleSign()">−</button>
        <input id="fAmount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" style="flex:1">
      </div>
      <div id="amountHint" class="amount-hint">Sortie (débit)</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--line);margin:6px 0 14px">
    <div class="field"><label>Type de flux</label>
      <div class="combo"><input id="fType" autocomplete="off" value="${esc(t.typeflux||'')}"><div class="combodrop" id="fType_d"></div></div></div>
    <div class="row">
      <div class="field"><label>Cat. 1</label>
        <div class="combo"><input id="fCat1" autocomplete="off" value="${esc(t.cat1||'')}"><div class="combodrop" id="fCat1_d"></div></div></div>
      <div class="field"><label>Cat. 2</label>
        <div class="combo"><input id="fCat2" autocomplete="off" value="${esc(t.cat2||'')}"><div class="combodrop" id="fCat2_d"></div></div></div>
    </div>
    <div class="field"><label>Cat. 3 (sous-cat / sortie)</label>
      <div class="combo"><input id="fCat3" autocomplete="off" value="${esc(t.cat3||'')}"><div class="combodrop" id="fCat3_d"></div></div></div>
    <button type="button" class="adv-toggle" onclick="toggleAdvancedTx()">▸ Détails avancés</button>
    <div class="adv-area" id="txAdvanced">
      <div class="field"><label>Compte (auto)</label><input id="fCompte" readonly value="${esc(t.compte||'')}"></div>
      <div class="row">
        <div class="field"><label>Saison</label>
          <div class="combo"><input id="fSeason" autocomplete="off" value="${esc(t.season||curSeason())}"><div class="combodrop" id="fSeason_d"></div></div></div>
        <div class="field"><label>Adhérent</label>
          <div class="combo"><input id="fAdh" autocomplete="off" value="${esc(t.adherent||'')}"><div class="combodrop" id="fAdh_d"></div></div></div>
      </div>
      <div class="field"><label>Justificatif</label><input id="fJustif" value="${esc(t.justif||'').replace(/"/g,'&quot;')}"></div>
      <div class="field"><label>Commentaire</label><input id="fComment" value="${esc(t.comment||'').replace(/"/g,'&quot;')}"></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin-bottom:14px">
        <input type="checkbox" id="fRule" style="width:auto" checked> Mémoriser une règle d'auto-classement pour ce libellé</label>
    </div>
    <button class="btn" onclick="saveTx()">${isNew?'Ajouter le flux':'Enregistrer'}</button>
    ${isNew?`<button class="btn ghost" style="margin-top:10px" onclick="saveTxAndNew()">Ajouter et saisir le suivant</button>`:''}
    ${id?`<button class="btn ghost" style="margin-top:10px" onclick="delTx('${id}')"><span class="del">Supprimer</span></button>`:''}`;

  // initialiser les combobox
  setupComboboxes(t);
  setupLibelleAssist();
  // initialiser le champ Montant unique (signe selon débit/crédit existant)
  initAmountField(t);
  initAccountField(t, isNew);
  setupFormKeyboard();
  // si l'adhérent actuel correspond au libellé, on le considère auto-rempli (modifiable au renommage)
  maybeAutofillAdh._last = (t.adherent && matchAdherent(t.libelle)===t.adherent) ? t.adherent : null;
  openSheet();
}
function natureLabel(n){ return n? (REF.natureLabels[n]||n) : ''; }

// --- Compte bancaire CC/EP (0.8.7) ---
// Corrige un manque : jusqu'ici, toute nouvelle opération était forcée
// sur CC sans aucun moyen de choisir EP depuis le formulaire.
let _txAccount = 'CC';
function initAccountField(t, isNew){
  _txAccount = isNew ? 'CC' : (t.account || 'CC');
  setAccount(_txAccount);
}
function setAccount(a){
  _txAccount = a;
  document.querySelectorAll('#accSeg .seg-btn').forEach(b=>b.classList.toggle('on', b.dataset.acc===a));
}

// --- Champ Montant unique avec signe (0.8.0) ---
// Convention : signe − = débit (sortie), + = crédit (entrée).
let _amountSign = -1;
let _saveAndNew = false;
function initAmountField(t){
  const cred=Number(t.credit||0), deb=Number(t.debit||0);
  let val='', sign=-1;
  if(cred>0){ sign=1; val=cred; }
  else if(deb>0){ sign=-1; val=deb; }
  else {
    sign = (t.typeflux==='PRODUITS') ? 1 : -1;
    val='';
  }
  _amountSign=sign;
  const inp=$('#fAmount'); if(inp) inp.value = (val===''?'':Math.abs(val));
  updateSignUI();
}
function toggleSign(){ _amountSign = -_amountSign; updateSignUI();
  if(setupLibelleAssist._refreshLabel) setupLibelleAssist._refreshLabel();
  maybeAutofillAdh();
}
function updateSignUI(){
  const btn=$('#fSign'), hint=$('#amountHint');
  if(!btn) return;
  if(_amountSign>0){ btn.textContent='+'; btn.className='sign-btn plus'; if(hint){hint.textContent='Entrée (crédit)'; hint.className='amount-hint plus';} }
  else { btn.textContent='−'; btn.className='sign-btn minus'; if(hint){hint.textContent='Sortie (débit)'; hint.className='amount-hint minus';} }
}
function readAmount(){
  const raw=parseFloat($('#fAmount') ? $('#fAmount').value : '')||0;
  const v=Math.abs(raw);
  return _amountSign>0 ? {debit:0, credit:v} : {debit:v, credit:0};
}

// --- Navigation clavier dans le formulaire (0.8.0) ---
function setupFormKeyboard(){
  const sheet=$('#sheet'); if(!sheet) return;
  sheet.onkeydown=(e)=>{
    if(e.key==='Escape'){ e.preventDefault(); closeSheet(); return; }
    if(e.key==='Enter'){
      // Combobox ouvert : laisser la sélection se faire
      const openDrop=e.target.parentElement && e.target.parentElement.querySelector && e.target.parentElement.querySelector('.combodrop.open');
      if(openDrop){ return; }
      // On passe au champ suivant si possible, mais on n'enregistre JAMAIS automatiquement
      // (sur mobile, la touche Entrée/OK du clavier ne doit pas valider l'opération).
      const focusables=[...sheet.querySelectorAll('input:not([readonly]):not([type=checkbox])')];
      const i=focusables.indexOf(e.target);
      if(i>-1 && i<focusables.length-1){
        e.preventDefault();
        focusables[i+1].focus();
      }
      // sinon : on ne fait rien (pas de saveTx automatique)
    }
  };
}

function natureFromLabel(v){
  v=(v||'').trim(); if(!v) return '';
  for(const n of REF.natures){ if(n===v || REF.natureLabels[n]===v) return n; }
  return v; // valeur libre
}

// Configure tous les combobox du formulaire (texte libre + liste filtrante + cascade)
function setupComboboxes(t){
  // options dynamiques calculées à la volée
  const optType=()=>REF.typeFlux.slice();
  const optC1=()=>REF.cat1ByType[$('#fType').value]||[];
  const optC2=()=>REF.cat2[$('#fType').value+'||'+$('#fCat1').value]||[];
  const optC3=()=>REF.cat3[$('#fType').value+'||'+$('#fCat2').value]||[];
  const optNat=()=>REF.natures.map(n=>REF.natureLabels[n]||n);
  const optSeason=()=>allSeasons();
  const optAdh=()=>REF.adherents.slice();
  function refreshCompte(){
    const key=$('#fType').value+'||'+$('#fCat1').value+'||'+$('#fCat2').value;
    $('#fCompte').value=REF.compte[key]||'';
  }
  combo('#fType', optType, ()=>{ /* reset enfants si hors liste */ });
  combo('#fCat1', optC1, ()=>{ refreshCompte(); });
  combo('#fCat2', optC2, ()=>{ refreshCompte(); });
  combo('#fCat3', optC3, ()=>{});
  combo('#fNat', optNat, ()=>{});
  combo('#fSeason', optSeason, ()=>{});
  combo('#fAdh', optAdh, ()=>{ });
  refreshCompte();
}

// Combobox générique : input #id + dropdown #id_d
function combo(sel, optsFn, onChange){
  const inp=$(sel); if(!inp) return;
  const drop=$(sel+'_d');
  function render(){
    const v=norm(inp.value);
    let opts=optsFn();
    const filtered=opts.filter(o=>norm(o).includes(v));
    const list=(filtered.length?filtered:opts).slice(0,40);
    drop.innerHTML=list.map(o=>`<button type="button" class="comboopt" onmousedown="event.preventDefault()"
      data-v="${esc(o).replace(/"/g,'&quot;')}">${esc(o)}</button>`).join('')
      || `<div class="comboopt empty">Nouvelle valeur — sera ajoutée</div>`;
    drop.querySelectorAll('.comboopt[data-v]').forEach(b=>b.onclick=()=>{
      inp.value=b.dataset.v; close(); inp.dispatchEvent(new Event('change',{bubbles:false})); if(onChange)onChange();
    });
  }
  function open(){ render(); drop.classList.add('open'); }
  function close(){ drop.classList.remove('open'); }
  inp.addEventListener('focus',open);
  inp.addEventListener('click',open);
  inp.addEventListener('input',()=>{ open(); if(onChange)onChange(); });
  inp.addEventListener('blur',()=>setTimeout(close,150));
}
function applySug(match){
  const r=Store.rules().find(x=>x.match===match); if(!r)return;
  applyCombo(r.typeflux,r.cat1,r.cat2,r.cat3||'');
  toast('Suggestion appliquée');
}
function saveTx(andNew){
  _saveAndNew = !!andNew;
  const g=s=>$(s).value;
  const amt=readAmount();
  const patch={
    libelle:g('#fLib'), date:g('#fDate'), nature:natureFromLabel(g('#fNat')),
    debit:amt.debit, credit:amt.credit, account:_txAccount,
    typeflux:g('#fType').toUpperCase().trim(), cat1:g('#fCat1').toUpperCase().trim(),
    cat2:g('#fCat2').toUpperCase().trim(), cat3:g('#fCat3').trim(),
    compte:g('#fCompte'), season:g('#fSeason').trim(), adherent:g('#fAdh').trim(),
    justif:g('#fJustif'), comment:g('#fComment')
  };
  patch.isPrev = $('#fFuture') && $('#fFuture').checked;
  // détecter les valeurs absentes des tables
  const news=detectNewValues();
  if(news.length){ showNewValuesModal(news, ()=>commitTx(patch)); return; }
  commitTx(patch);
}
function commitTx(patch){
  if(editId){
    const cur=Store.all().find(x=>x.id===editId);
    if(patch.isPrev){ patch.origStatus = (cur && cur.origStatus && cur.origStatus.trim()) ? cur.origStatus : 'ATT'; }
    else { patch.origStatus = ''; }
    Store.update(editId,patch);
  }
  else { patch.origStatus=''; patch.status='draft'; Store.add(patch); }
  if($('#fRule') && $('#fRule').checked && patch.cat1 && patch.cat2 && patch.libelle){
    const m=ruleKey(patch.libelle);
    Store.addRule({match:m,typeflux:patch.typeflux,cat1:patch.cat1,cat2:patch.cat2,cat3:patch.cat3});
  }
  // Saisie en série : on rouvre un formulaire pré-rempli (date/saison/catégories/type/nature)
  // en vidant libellé, montant et adhérent — sans fermer la feuille.
  if(_saveAndNew && !editId){
    _saveAndNew=false;
    toast('Ajouté ✓ — saisie suivante');
    const seed={
      typeflux:patch.typeflux, cat1:patch.cat1, cat2:patch.cat2, cat3:patch.cat3,
      compte:patch.compte, nature:patch.nature, season:patch.season, account:patch.account,
      date:patch.date, isPrev:patch.isPrev, origStatus:patch.isPrev?'ATT':'',
      libelle:'', debit:0, credit:0, adherent:'', justif:'', comment:''
    };
    reopenTxWith(seed);
    refreshCurrent();   // met à jour la liste en arrière-plan (ex: "À classer") sans fermer la feuille
    return;
  }
  closeSheet(); toast(editId?'Enregistré ✓':'Ajouté au brouillon');
  const active=document.querySelector('.view.active').id.replace('v-','');
  go(editId? (active==='import'?'dash':active) : 'classer');
}

// Rouvre le formulaire de saisie pré-rempli à partir d'un objet (pour la saisie en série)
function reopenTxWith(seed){
  editId=null; newKind = seed.isPrev?'PREV':'REAL';
  const t=Object.assign({typeflux:'',cat1:'',cat2:'',cat3:'',compte:'',nature:'',libelle:'',
    date:new Date().toISOString().slice(0,10),debit:0,credit:0,season:curSeason(),
    adherent:'',justif:'',comment:'',isPrev:false,origStatus:''}, seed);
  _txPreset=t; openTx(null, t.isPrev?'PREV':'REAL'); _txPreset=null;
  // la feuille reste ouverte ; on ne force pas le focus (sur mobile, ouvrir le clavier
  // automatiquement peut être déroutant — l'utilisateur tape le libellé quand il veut).
}

// Détecte les valeurs saisies absentes des tables
function detectNewValues(){
  const g=s=>($(s).value||'').trim();
  const news=[];
  const tf=g('#fType').toUpperCase(), c1=g('#fCat1').toUpperCase(), c2=g('#fCat2').toUpperCase(), c3=g('#fCat3');
  const season=g('#fSeason'), adh=g('#fAdh'), nat=g('#fNat');
  const has=(arr,v)=>(arr||[]).some(x=>norm(x)===norm(v));
  if(c2 && tf && c1 && !has(REF.cat2[tf+'||'+c1],c2)) news.push({kind:'cat2',label:'Cat 2',val:c2,ctx:{tf,c1,c2}});
  if(c3 && tf && c2 && !has(REF.cat3[tf+'||'+c2],c3)) news.push({kind:'cat3',label:'Cat 3',val:c3,ctx:{tf,c1,c2,c3}});
  if(season && !has(allSeasons(),season)) news.push({kind:'season',label:'Saison',val:season});
  if(adh && !has(REF.adherents,adh)) news.push({kind:'adh',label:'Adhérent',val:adh});
  const natCode=natureFromLabel(nat);
  if(natCode && !has(REF.natures,natCode)) news.push({kind:'nature',label:'Nature',val:natCode});
  return news;
}
// Modal custom (pas de confirm/prompt natifs, qui sont bloqués dans certains webviews mobiles)
function showNewValuesModal(news, onConfirm){
  const cat3Sheets=['ADHESION','SORTIE','TEXTILE','AUTRE'];
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="sheet-head"><div class="grab"></div><button type="button" class="sheet-close" onclick="closeSheet()" aria-label="Fermer">✕</button></div>
    <h2>Nouvelles valeurs</h2>
    <p class="note">Ces valeurs ne sont pas dans les tables. Confirme leur ajout :</p>
    ${news.map((n,i)=>`<div class="field">
      <label>${n.label}</label>
      <div style="font-weight:600;font-size:14px;padding:4px 0">${esc(n.val)}</div>
      ${n.kind==='cat3'?`<label style="margin-top:6px">Feuille de destination</label>
        <select id="nvdest_${i}">${cat3Sheets.map((s,k)=>`<option value="${s}" ${s==='SORTIE'?'selected':''}>${s}</option>`).join('')}</select>`:''}
    </div>`).join('')}
    <button class="btn" onclick="applyNewValues()">Ajouter et enregistrer</button>
    <button class="btn ghost" style="margin-top:10px" onclick="closeSheet()">Annuler</button>`;
  showNewValuesModal._news=news;
  showNewValuesModal._cb=onConfirm;
  openSheet();
}
function applyNewValues(){
  const news=showNewValuesModal._news||[];
  news.forEach((n,i)=>{
    if(n.kind==='season'){ Store.data.extraSeasons=Store.data.extraSeasons||[]; if(!Store.data.extraSeasons.includes(n.val))Store.data.extraSeasons.push(n.val); }
    else if(n.kind==='nature'){ REF.natures.push(n.val); REF.natureLabels[n.val]=n.val; }
    else if(n.kind==='adh'){ SHEETS['ADHERENTS'].rows.push([n.val]); }
    else if(n.kind==='cat2'){ SHEETS['TABLE COMPTE'].rows.push([n.ctx.tf,n.ctx.c1,n.ctx.c2,'']); }
    else if(n.kind==='cat3'){ const dest=($('#nvdest_'+i)&&$('#nvdest_'+i).value)||'AUTRE';
      SHEETS[dest].rows.push([n.ctx.tf,n.ctx.c1,n.ctx.c2,n.ctx.c3]); }
  });
  rebuildRefFromSheets(); persistSheets(); Store.saveRef();
  const cb=showNewValuesModal._cb; showNewValuesModal._cb=null;
  if(cb) cb();
}

function applyCombo(tf,c1,c2,c3){
  $('#fType').value=tf;
  $('#fCat1').value=c1;
  $('#fCat2').value=c2;
  if(c3) $('#fCat3').value=c3;
  // recalc compte
  const key=tf+'||'+c1+'||'+c2;
  $('#fCompte').value=REF.compte[key]||'';
  // aligner le signe du montant sur le type de flux (PRODUITS=+, CHARGES=−)
  if(tf==='PRODUITS' && _amountSign<0){ _amountSign=1; updateSignUI(); }
  else if(tf==='CHARGES' && _amountSign>0){ _amountSign=-1; updateSignUI(); }
  maybeAutofillAdh();
  if(setupLibelleAssist._refreshLabel) setupLibelleAssist._refreshLabel();
  toast('Champs pré-remplis');
}
function setupLibelleAssist(){
  const lib=$('#fLib'), amount=$('#fAmount'), lab=$('#fLibLabel');
  const seen=new Set();
  Store.all().forEach(t=>{ if(t.libelle) seen.add(t.libelle.trim()); });
  REF.adherents.forEach(a=>seen.add(a));
  setupLibelleAssist._names=[...seen].sort((a,b)=>a.localeCompare(b,'fr'));
  function refreshLabel(){
    const hasAmount=(parseFloat(amount&&amount.value)||0)>0;
    const isCredit=hasAmount && _amountSign>0;
    const isDebit=hasAmount && _amountSign<0;
    lab.textContent = isDebit ? 'Débiteur (qui paie)' : isCredit ? 'Créditeur (adhérent par défaut)' : 'Libellé (débiteur / créditeur)';
  }
  setupLibelleAssist._refreshLabel=refreshLabel;
  if(amount){ amount.addEventListener('input',()=>{ refreshLabel(); maybeAutofillAdh(); }); }
  lib.addEventListener('input',()=>{ showNameSug(); onLibInput(); });
  lib.addEventListener('blur',()=>{ setTimeout(()=>{ const b=$('#libNames'); if(b)b.innerHTML=''; },150); });
  refreshLabel();
}
// Liste déroulante custom de noms (évite le datalist natif qui ferme la fenêtre sur mobile)
function showNameSug(){
  const v=$('#fLib').value.trim(); const box=$('#libNames');
  if(!box) return;
  if(v.length<1){ box.innerHTML=''; return; }
  const nv=norm(v);
  const list=(setupLibelleAssist._names||[]).filter(n=>norm(n).includes(nv)).slice(0,6);
  if(!list.length || (list.length===1 && norm(list[0])===nv)){ box.innerHTML=''; return; }
  box.innerHTML=`<div class="namedrop">`+list.map(n=>
    `<button type="button" class="nameopt" onmousedown="event.preventDefault()" onclick="pickName('${esc(n).replace(/'/g,"\\\\'")}')">${esc(n)}</button>`).join('')+`</div>`;
}
function pickName(n){
  $('#fLib').value=n; $('#libNames').innerHTML='';
  onLibInput();
}

// Propose plusieurs opérations similaires et pré-remplit type/cat1/cat2/cat3
function onLibInput(){
  const lib=$('#fLib').value.trim();
  const box=$('#libSug');
  maybeAutofillAdh();
  if(lib.length<2){ box.innerHTML=''; return; }
  const nl=norm(lib);
  const matches=Store.all().filter(t=>isClassified(t) && norm(t.libelle).includes(nl));
  if(!matches.length){ box.innerHTML=''; return; }
  // combinaisons distinctes de classement, triées par fréquence
  const comboMap={};
  matches.forEach(t=>{ const k=[t.typeflux,t.cat1,t.cat2,t.cat3].join('|');
    comboMap[k]=comboMap[k]||{n:0,last:''};
    comboMap[k].n++; if((t.date||'')>comboMap[k].last)comboMap[k].last=t.date||''; });
  const ranked=Object.entries(comboMap).sort((a,b)=>b[1].n-a[1].n).slice(0,4);
  const chips=ranked.map(([k,info])=>{
    const [tf,c1,c2,c3]=k.split('|');
    return `<button class="sugchip" onclick="applyCombo('${esc(tf)}','${esc(c1)}','${esc(c2)}','${esc(c3)}')">
      <span class="sc-cat">${esc(c2)}${c3?' · '+esc(c3):''}</span>
      <span class="sc-n">${info.n}×</span></button>`;
  }).join('');
  box.innerHTML=`<div class="sugwrap"><div class="sug-h">⚡ Opérations similaires — touche pour pré-remplir</div>
    <div class="sug-chips">${chips}</div></div>`;
}

// Remplit le champ adhérent automatiquement :
// - crédit : le libellé est le créditeur = adhérent par défaut
// - débit lié aux adhérents (licence/assurance/formation) : le débiteur est un adhérent
function maybeAutofillAdh(){
  const adhF=$('#fAdh'); if(!adhF) return;
  const lib=$('#fLib').value.trim();
  const cred=(parseFloat($('#fAmount') && $('#fAmount').value)||0)>0 && _amountSign>0;
  const c2=($('#fCat2').value||'').toUpperCase();
  const isAdhDebit=/LICENCE|ASSURANCE|FORMATION/.test(c2);
  if(!(cred || isAdhDebit)) return;
  const m=matchAdherent(lib);
  const cur=adhF.value.trim();
  // On écrit l'adhérent si : champ vide, OU sa valeur actuelle vient d'un précédent
  // auto-remplissage (donc on ne piétine pas une saisie manuelle volontaire).
  if(!cur || cur===maybeAutofillAdh._last){
    if(m){ adhF.value=m; maybeAutofillAdh._last=m; }
    else if(!cur){ maybeAutofillAdh._last=''; }
  }
}
function matchAdherent(s){
  const c=norm(s); if(!c) return '';
  for(const a of REF.adherents){ const an=norm(a); if(c===an||c.startsWith(an)||an.startsWith(c)) return a; }
  return '';
}
function ruleKey(lib){ // strip trailing numbers/dates to generalize
  return norm(lib).replace(/\bFACT\b.*/,'').replace(/[0-9]{4,}/g,'').replace(/\s+/g,' ').trim().slice(0,24)||norm(lib);
}
function delTx(id){ confirmModal('Supprimer cette opération ?', ()=>{Store.remove(id);closeSheet();toast('Supprimé');go('classer');}, '🗑 Supprimer'); }

/* Édition multiple : champs identiques pré-remplis, champs différents = *MULTI* */
let multiIds=[];
function openMultiEdit(sel){
  multiIds=sel.map(t=>t.id);
  const MULTI='*MULTI*';
  const common=f=>{ const vals=[...new Set(sel.map(t=>String(t[f]==null?'':t[f])))]; return vals.length===1?vals[0]:MULTI; };
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="sheet-head"><div class="grab"></div><button type="button" class="sheet-close" onclick="closeSheet()" aria-label="Fermer">✕</button></div>
    <h2>Modifier ${sel.length} lignes</h2>
    <p class="note">Les champs marqués ${MULTI} ont des valeurs différentes. Modifie uniquement ce que tu veux appliquer à toutes les lignes ; laisse ${MULTI} pour ne pas y toucher.</p>
    <div class="field"><label>Libellé</label><input id="mLib" value="${esc(common('libelle'))}"></div>
    <div class="row">
      <div class="field"><label>Date</label><input id="mDate" type="${common('date')===MULTI?'text':'date'}" value="${esc(common('date'))}"></div>
      <div class="field"><label>Nature</label><input id="mNat" value="${esc(common('nature'))}"></div>
    </div>
    <div class="field"><label>Type de flux</label><input id="mType" value="${esc(common('typeflux'))}"></div>
    <div class="row">
      <div class="field"><label>Cat. 1</label><input id="mCat1" value="${esc(common('cat1'))}"></div>
      <div class="field"><label>Cat. 2</label><input id="mCat2" value="${esc(common('cat2'))}"></div>
    </div>
    <div class="field"><label>Cat. 3</label><input id="mCat3" value="${esc(common('cat3'))}"></div>
    <div class="row">
      <div class="field"><label>Saison</label><input id="mSeason" value="${esc(common('season'))}"></div>
      <div class="field"><label>Adhérent</label><input id="mAdh" value="${esc(common('adherent'))}"></div>
    </div>
    <div class="field"><label>Commentaire</label><input id="mComment" value="${esc(common('comment'))}"></div>
    <button class="btn" onclick="saveMultiEdit()">Appliquer aux ${sel.length} lignes</button>`;
  openSheet();
}
function saveMultiEdit(){
  const MULTI='*MULTI*';
  const map={libelle:'#mLib',date:'#mDate',nature:'#mNat',typeflux:'#mType',cat1:'#mCat1',
    cat2:'#mCat2',cat3:'#mCat3',season:'#mSeason',adherent:'#mAdh',comment:'#mComment'};
  const patch={};
  for(const f in map){ const v=$(map[f]).value; if(v!==MULTI) patch[f]=v; }
  // recalc compte si cat change
  multiIds.forEach(id=>{
    const t=Store.all().find(x=>x.id===id); if(!t)return;
    const merged=Object.assign({},t,patch);
    const ck=merged.typeflux+'||'+merged.cat1+'||'+merged.cat2;
    if(REF.compte[ck]) patch.compte=REF.compte[ck];
    Store.update(id,patch);
  });
  closeSheet(); toast(`${multiIds.length} lignes modifiées`); renderClasser();
}
function openSheet(){ $('#sheetBg').classList.add('open'); }
function closeSheet(){ $('#sheetBg').classList.remove('open'); }
// Confirmation custom (les confirm()/prompt() natifs sont bloqués dans certains webviews mobiles)
function confirmModal(message, onYes, yesLabel){
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="sheet-head"><div class="grab"></div><button type="button" class="sheet-close" onclick="closeSheet()" aria-label="Fermer">✕</button></div>
    <p style="font-size:15px;margin:8px 0 18px;line-height:1.4">${esc(message)}</p>
    <button class="btn" id="cmYes">${esc(yesLabel||'Confirmer')}</button>
    <button class="btn ghost" style="margin-top:10px" onclick="closeSheet()">Annuler</button>`;
  $('#cmYes').onclick=()=>{ closeSheet(); onYes&&onYes(); };
  openSheet();
}
$('#sheetBg').onclick=e=>{ if(e.target.id==='sheetBg')closeSheet(); };

/* ============ OPERATIONS ============ */
const FCOLS=[
  ['typeflux','Type de flux'],['cat1','Cat 1'],['cat2','Cat 2'],['cat3','Cat 3'],
  ['compte','Compte'],['season','Saison'],['nature','Nature'],['adherent','Adhérent'],
  ['origStatus','Statut'],['account','Compte bancaire']
];
let opsFilters={}; // col -> Set of allowed values
function dateKey(t){ return t.date || '0000-00-00'; }
function sortRecent(arr){ return [...arr].sort((a,b)=>{
  const d=dateKey(b).localeCompare(dateKey(a)); if(d!==0)return d;
  return (parseInt(b.id.slice(1))||0)-(parseInt(a.id.slice(1))||0); }); }

let opsAccount='CC'; // défaut compte courant; null = tous
let opsFuturesOpen=false;

function opsMatch(t){
  const q=norm($('#opsSearch').value);
  if(q && !norm([t.libelle,t.adherent,t.cat2,t.cat3,t.compte,t.nature,t.comment,t.justif].join(' ')).includes(q)) return false;
  if(opsAccount && (t.account||'CC')!==opsAccount) return false;
  for(const col in opsFilters){
    const set=opsFilters[col]; if(!set||!set.size)continue;
    const v=(t[col]==null?'':String(t[col]))||'(vide)';
    if(!set.has(v))return false;
  }
  return true;
}
function activeFilterCount(){ return Object.values(opsFilters).filter(s=>s&&s.size).length; }

function orderedList(arr){
  const mo=Store.data.manualOrder;
  if(mo && mo.length){
    const pos={}; mo.forEach((id,i)=>pos[id]=i);
    return [...arr].sort((a,b)=>{
      const pa=pos[a.id], pb=pos[b.id];
      if(pa!=null && pb!=null) return pa-pb;
      if(pa!=null) return -1; if(pb!=null) return 1;
      return sortRecent([a,b])[0]===a?-1:1;
    });
  }
  return sortRecent(arr); // date décroissante par défaut
}

function renderOps(){
  // chips comptes bancaires
  renderAcctChips();

  // zone futures, repliable (hors brouillons)
  const futures=sortRecent(Store.all().filter(t=>isFuture(t)&&!isDraft(t)).filter(opsMatch));
  const fz=$('#futureZone');
  if(futures.length){
    fz.innerHTML=`<details class="grp" ${opsFuturesOpen?'open':''} id="futDetails" style="margin-bottom:12px">
      <summary style="border-color:var(--accent);color:var(--accent)">
        <span>⏳ Opérations futures · ${futures.length}</span><span class="tag">détail ›</span></summary>
      <div class="body" id="futureList"></div></details>`;
    $('#futureList').innerHTML=futures.map(txRow).join('');
    attachTxClicks('#futureList');
    $('#futDetails').addEventListener('toggle',e=>{opsFuturesOpen=e.target.open;});
  } else fz.innerHTML='';

  // liste principale (réalisé), ordre manuel ou date (hors brouillons)
  const list=orderedList(Store.all().filter(t=>!isFuture(t)&&!isDraft(t)).filter(opsMatch));

  // solde courant cumulé : seulement si un seul compte sélectionné.
  // Ancré sur le solde réel (Réglages) à la dernière opération, en remontant le temps.
  const note=$('#opsBalNote');
  let runningById={};
  if(opsAccount){
    const real=(Store.data.realBalances||{})[opsAccount];
    const chrono=sortRecent(Store.all().filter(t=>!isFuture(t) && !isDraft(t) && (t.account||'CC')===opsAccount)); // récent -> ancien
    if(real!=null && !isNaN(parseFloat(real))){
      let run=parseFloat(real);
      chrono.forEach(t=>{ runningById[t.id]=run; run-=amt(t); });
      note.innerHTML=`<div class="tag" style="margin-bottom:8px">Solde après chaque opération (${ACCOUNTS[opsAccount]||opsAccount}, solde réel ${eur(parseFloat(real))} au plus récent).</div>`;
    } else {
      note.innerHTML=`<div class="tag" style="margin-bottom:8px">Renseigne le solde de ce compte dans Paramètres pour voir le solde cumulé.</div>`;
    }
  } else {
    note.innerHTML=`<div class="tag" style="margin-bottom:8px">Glisse ⠿ pour réordonner. Sélectionne un seul compte pour voir le solde cumulé.</div>`;
  }

  $('#opsList').innerHTML=list.length?list.map(t=>txRow(t,{running:runningById[t.id],drag:true})).join(''):
    (futures.length?'':'<div class="empty">Aucun résultat</div>');
  attachTxClicks('#opsList');
  enableDrag('#opsList');

  const c=activeFilterCount();
  $('#filterCount').textContent=c?` (${c})`:'';
  const btnReset=$('#btnResetFilters');
  if(btnReset) btnReset.style.display=(opsAccount||c)?'':'none';
}

function renderAcctChips(){
  const accs=[...new Set(Store.all().map(t=>t.account||'CC'))];
  const bar=$('#acctChips');
  bar.innerHTML=accs.map(a=>`<button class="${opsAccount===a?'on':''}" onclick="setOpsAccount('${a}')">${a}</button>`).join('');
}
function setOpsAccount(a){ opsAccount = (opsAccount===a) ? null : a; renderOps(); }
function clearFilters(){ opsFilters={}; opsAccount=null; $('#opsSearch').value=''; renderOps(); }

/* Drag & drop pour réordonner manuellement */
let dragId=null;
function enableDrag(sel){
  const cont=document.querySelector(sel); if(!cont)return;
  cont.querySelectorAll('.tx[draggable]').forEach(el=>{
    el.addEventListener('dragstart',e=>{ dragId=el.dataset.id; el.style.opacity='.4'; });
    el.addEventListener('dragend',e=>{ el.style.opacity=''; });
    el.addEventListener('dragover',e=>{ e.preventDefault(); });
    el.addEventListener('drop',e=>{ e.preventDefault(); dropOn(el.dataset.id); });
  });
}
function dropOn(targetId){
  if(!dragId || dragId===targetId) return;
  // construire l'ordre courant visible puis déplacer dragId avant targetId
  const visible=orderedList(Store.all().filter(t=>!isFuture(t)).filter(opsMatch)).map(t=>t.id);
  const from=visible.indexOf(dragId), to=visible.indexOf(targetId);
  if(from<0||to<0)return;
  visible.splice(from,1); visible.splice(visible.indexOf(targetId),0,dragId);
  // fusionner avec l'ordre manuel global existant
  const others=(Store.data.manualOrder||[]).filter(id=>!visible.includes(id));
  Store.data.manualOrder=[...visible,...others];
  Store.save(); dragId=null; renderOps(); toast('Ordre mis à jour');
}

/* Filter sheet: one collapsible per column with distinct values + counts */
function openFilters(){
  const all=Store.all();
  const sheet=$('#sheet');
  let html=`<div class="sheet-head"><div class="grab"></div><button type="button" class="sheet-close" onclick="closeSheet()" aria-label="Fermer">✕</button></div><h2>Filtrer les opérations</h2>
    <p class="note">Coche les valeurs à conserver. Sans coche = tout.</p>`;
  FCOLS.forEach(([col,label])=>{
    const counts={};
    all.forEach(t=>{ const v=(t[col]==null?'':String(t[col]))||'(vide)'; counts[v]=(counts[v]||0)+1; });
    const vals=Object.keys(counts).sort((a,b)=>a.localeCompare(b,'fr'));
    if(!vals.length)return;
    const sel=opsFilters[col]||new Set();
    const nsel=sel.size;
    html+=`<details class="grp"><summary><span>${label}${nsel?` · ${nsel}`:''}</span>
      <span class="tag">${vals.length}</span></summary>
      <div class="body" style="max-height:240px;overflow-y:auto">
      ${vals.map(v=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px">
        <input type="checkbox" style="width:auto" data-col="${esc(col)}" value="${esc(v)}" ${sel.has(v)?'checked':''}>
        <span style="flex:1">${esc(v)}</span><span class="tag">${counts[v]}</span></label>`).join('')}
      </div></details>`;
  });
  html+=`<div class="row" style="margin-top:14px">
    <button class="btn sec" onclick="clearFilters();closeSheet()">Tout effacer</button>
    <button class="btn" onclick="applyFilters()">Appliquer</button></div>`;
  sheet.innerHTML=html;
  openSheet();
}
function applyFilters(){
  const next={};
  document.querySelectorAll('#sheet input[type=checkbox][data-col]').forEach(cb=>{
    if(cb.checked){ const c=cb.dataset.col; (next[c]=next[c]||new Set()).add(cb.value); }
  });
  opsFilters=next; closeSheet(); renderOps();
}

/* ============ REPORTING (TCD-like) ============ */
let repMode='cr';
let repSeason=null; // null = toutes saisons
function renderReport(){
  // populate season selector
  const sel=$('#repSeason');
  if(sel && !sel.dataset.init){ sel.dataset.init=1;
    sel.onchange=()=>{ repSeason=sel.value||null; renderReport(); };
  }
  if(sel){
    const seasons=allSeasons();
    if(repSeason===null) repSeason=curSeason();
    sel.innerHTML='<option value="">Toutes les saisons</option>'+
      seasons.map(s=>`<option value="${s}" ${s===repSeason?'selected':''}>${s}</option>`).join('');
    sel.value=repSeason||'';
  }
  const tx=Store.all().filter(t=>isClassified(t) && !isFuture(t) && !isDraft(t) && (!repSeason || t.season===repSeason));
  if(repMode==='cr')reportCR(tx);
  else if(repMode==='cacvcf')reportCACVCF(tx);
  else if(repMode==='adh')reportAdh(tx);
  else reportSortie(tx);
}
function reportCACVCF(tx){
  // Regroupe par Cat 1 (CA, CF, CV) puis par Cat 2, puis détail Cat 3
  const groups={CA:{tot:0,cat2:{}},CF:{tot:0,cat2:{}},CV:{tot:0,cat2:{}}};
  tx.forEach(t=>{ const g=groups[t.cat1]; if(!g)return; const a=amt(t);
    g.tot+=a;
    g.cat2[t.cat2]=g.cat2[t.cat2]||{tot:0,cat3:{}};
    g.cat2[t.cat2].tot+=a;
    const c3=t.cat3||'(sans sous-catégorie)';
    g.cat2[t.cat2].cat3[c3]=(g.cat2[t.cat2].cat3[c3]||0)+a; });
  const labels={CA:"Chiffre d'affaires (CA)",CF:'Charges fixes (CF)',CV:'Charges variables (CV)'};
  let html='';
  const ca=groups.CA.tot, cf=groups.CF.tot, cv=groups.CV.tot;
  html+=`<div class="kpis"><div class="kpi"><div class="lab">CA</div><div class="val" style="color:var(--green)">${eur(ca)}</div></div>
    <div class="kpi"><div class="lab">CF + CV</div><div class="val" style="color:var(--red)">${eur(cf+cv)}</div></div></div>`;
  const res=ca+cf+cv;
  html+=`<div class="kpi" style="margin-bottom:16px"><div class="lab">Résultat</div>
    <div class="val" style="color:${res>=0?'var(--green)':'var(--red)'}">${eur(res)}</div></div>`;
  ['CA','CF','CV'].forEach(k=>{
    const g=groups[k];
    const sub=Object.entries(g.cat2).sort((a,b)=>Math.abs(b[1].tot)-Math.abs(a[1].tot))
      .map(([c2,d])=>{
        const c3rows=Object.entries(d.cat3).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))
          .map(([c3,v])=>`<tr><td style="color:var(--muted);padding-left:14px">${esc(c3)}</td><td class="num" style="color:${v>=0?'var(--green)':'var(--red)'}">${eur(v)}</td></tr>`).join('');
        const onlyEmpty=Object.keys(d.cat3).length===1 && d.cat3['(sans sous-catégorie)']!=null;
        if(onlyEmpty) return `<tr><td>${esc(c2)}</td><td class="num" style="color:${d.tot>=0?'var(--green)':'var(--red)'}">${eur(d.tot)}</td></tr>`;
        return `<tr><td colspan="2" style="padding:0"><details class="grp" style="margin:0"><summary style="border:none;background:none;padding:7px 0">
          <span>${esc(c2)}</span><span class="num" style="color:${d.tot>=0?'var(--green)':'var(--red)'}">${eur(d.tot)}</span></summary>
          <table style="margin:2px 0 6px">${c3rows}</table></details></td></tr>`;
      }).join('');
    html+=`<details class="grp" open><summary><span>${labels[k]}</span>
      <span class="num" style="color:${g.tot>=0?'var(--green)':'var(--red)'}">${eur(g.tot)}</span></summary>
      <div class="body"><table>${sub||'<tr><td class="tag">—</td></tr>'}</table></div></details>`;
  });
  $('#repBody').innerHTML=`<p class="note">Répartition CA / Charges fixes / Charges variables ${repSeason?'(saison '+repSeason+')':'(toutes saisons)'}. Touche une catégorie pour le détail.</p>`+html;
}
function reportCR(tx){
  // group by compte, split produit/charge
  const byCompte={};
  tx.forEach(t=>{ const c=t.compte||'(sans compte)'; byCompte[c]=byCompte[c]||{prod:0,char:0,cat2:{}};
    const a=amt(t);
    if(t.typeflux==='PRODUITS')byCompte[c].prod+=a; else byCompte[c].char+=a;
    byCompte[c].cat2[t.cat2]=(byCompte[c].cat2[t.cat2]||0)+a; });
  let prod=0,char=0;
  const prodRows=[],charRows=[];
  Object.entries(byCompte).sort().forEach(([c,d])=>{
    const tot=d.prod+d.char;
    const sub=Object.entries(d.cat2).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))
      .map(([k,v])=>`<tr><td style="padding-left:18px;color:var(--muted)">${esc(k)}</td><td class="num">${eur(v)}</td></tr>`).join('');
    const block=`<details class="grp"><summary><span>${esc(c)}</span><span class="num">${eur(tot)}</span></summary>
      <div class="body"><table>${sub}</table></div></details>`;
    if(d.prod>=Math.abs(d.char)){prodRows.push(block);prod+=tot;}else{charRows.push(block);char+=tot;}
  });
  // simpler: produits = comptes 7xx, charges = 6xx
  const pR=[],cR=[];prod=0;char=0;
  Object.entries(byCompte).sort().forEach(([c,d])=>{
    const tot=d.prod+d.char;
    const sub=Object.entries(d.cat2).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))
      .map(([k,v])=>`<tr><td style="padding-left:18px;color:var(--muted)">${esc(k)}</td><td class="num">${eur(v)}</td></tr>`).join('');
    const block=`<details class="grp"><summary><span>${esc(c)}</span><span class="num" style="color:${tot>=0?'var(--green)':'var(--red)'}">${eur(tot)}</span></summary>
      <div class="body"><table>${sub}</table></div></details>`;
    if(/^7/.test(c)){pR.push(block);prod+=tot;}else{cR.push(block);char+=tot;}
  });
  const res=prod+char;
  $('#repBody').innerHTML=`
    <div class="kpis">
      <div class="kpi"><div class="lab">Produits</div><div class="val" style="color:var(--green)">${eur(prod)}</div></div>
      <div class="kpi"><div class="lab">Charges</div><div class="val" style="color:var(--red)">${eur(char)}</div></div>
    </div>
    <div class="kpi" style="margin-bottom:16px"><div class="lab">Résultat de l'exercice</div>
      <div class="val" style="color:${res>=0?'var(--green)':'var(--red)'}">${eur(res)}</div></div>
    <h3 style="color:var(--muted);font-size:13px;text-transform:uppercase">Produits</h3>${pR.join('')||'<p class="note">—</p>'}
    <h3 style="color:var(--muted);font-size:13px;text-transform:uppercase;margin-top:16px">Charges</h3>${cR.join('')||'<p class="note">—</p>'}`;
}
// Résout l'adhérent d'une ligne : champ adherent, sinon nom trouvé dans le commentaire
function adhListNorm(){ if(!adhListNorm._c){ adhListNorm._c=REF.adherents.map(a=>[a,norm(a)]); } return adhListNorm._c; }
function resolveAdh(t){
  if(t.adherent) return t.adherent;
  const c=norm(t.comment); if(!c) return '';
  for(const [a,an] of adhListNorm()){ if(c===an || c.startsWith(an) || an.startsWith(c)) return a; }
  return '';
}
function reportAdh(tx){
  const by={};
  tx.forEach(t=>{ const a=resolveAdh(t); if(!a)return;
    by[a]=by[a]||{prod:0,char:0,lines:[]};
    const v=amt(t);
    if(t.typeflux==='PRODUITS')by[a].prod+=v; else by[a].char+=v;
    by[a].lines.push(t); });
  const rows=Object.entries(by).sort((a,b)=>(b[1].prod+b[1].char)-(a[1].prod+a[1].char)).map(([a,d])=>{
    const net=d.prod+d.char;
    // Détail regroupé par intitulé, recettes et dépenses séparées
    const recettes={}, depenses={};
    d.lines.forEach(l=>{ const v=amt(l);
      const lab=esc(l.cat2)+(l.cat3?' · '+esc(l.cat3):'');
      const tgt=v>=0?recettes:depenses; tgt[lab]=(tgt[lab]||0)+v; });
    const lineRows=(obj,color)=>Object.entries(obj).sort((x,y)=>x[0].localeCompare(y[0],'fr'))
      .map(([lab,v])=>`<div class="dline"><span>${lab}</span><span class="num" style="color:${color}">${eur(v)}</span></div>`).join('');
    const recHtml=Object.keys(recettes).length?lineRows(recettes,'var(--green)'):'<div class="dline empty-d">Aucune</div>';
    const depHtml=Object.keys(depenses).length?lineRows(depenses,'var(--red)'):'<div class="dline empty-d">Aucune</div>';
    return `<details class="grp"><summary><span>${esc(a)}</span><span class="num" style="color:${net>=0?'var(--green)':'var(--red)'};font-weight:700">${eur(net)}</span></summary>
      <div class="body adh-detail">
        <div class="adh-recap">
          <div class="adh-rc"><div class="lab">Recettes</div><div class="v" style="color:var(--green)">${eur(d.prod)}</div></div>
          <div class="adh-rc"><div class="lab">Dépenses</div><div class="v" style="color:var(--red)">${eur(d.char)}</div></div>
          <div class="adh-rc"><div class="lab">Net</div><div class="v" style="color:${net>=0?'var(--green)':'var(--red)'}">${eur(net)}</div></div>
        </div>
        <div class="adh-block"><div class="adh-bh" style="color:var(--green)">▸ Recettes</div>${recHtml}</div>
        <div class="adh-block"><div class="adh-bh" style="color:var(--red)">▸ Dépenses</div>${depHtml}</div>
      </div></details>`;
  }).join('');
  $('#repBody').innerHTML=`<p class="note">Recettes / dépenses / net par adhérent ${repSeason?'(saison '+repSeason+')':'(toutes saisons)'}. Les dépenses incluent les lignes dont le nom figure en commentaire (licences, assurances…).</p>`+(rows||'<div class="empty">Aucun adhérent renseigné</div>');
}
function reportSortie(tx){
  // Une sortie/voyage est identifiée par sa Cat 3 (nom + date). On regroupe TOUT
  // ce qui porte cette Cat 3 (recettes ET dépenses : transport, repas, logement, plongées…).
  const tripRe=/\b(PALAMOS|ESTARTIT|CERBERE|BANYULS|DJIBOUTI|MARTINIQUE|BALI|EGYPTE|AFS|EL PORT|LA CIOTAT|FOSSES|RIFAP)\b/i;
  const by={};
  tx.forEach(t=>{
    const k=(t.cat3||'').trim();
    if(!k || !tripRe.test(k)) return;
    by[k]=by[k]||{prod:0,char:0,payeurs:{},depcat:{},attente:{}};
    const v=amt(t);
    if(t.typeflux==='PRODUITS'){
      by[k].prod+=v;
      const a=resolveAdh(t)||t.libelle||'(non identifié)';
      by[k].payeurs[a]=(by[k].payeurs[a]||0)+v;
    } else {
      by[k].char+=v;
      by[k].depcat[t.cat2]=(by[k].depcat[t.cat2]||0)+v;
    }
  });
  // Paiements en attente : lignes futures (ATT/FMY/HA), recettes positives, rattachées à une sortie
  Store.all().forEach(t=>{
    if(!isFuture(t) || isDraft(t)) return;
    if(repSeason && t.season!==repSeason) return;
    const k=(t.cat3||'').trim();
    if(!k || !tripRe.test(k)) return;
    const v=amt(t);
    if(v<=0) return; // seules les recettes attendues d'adhérents
    by[k]=by[k]||{prod:0,char:0,payeurs:{},depcat:{},attente:{}};
    const a=resolveAdh(t)||t.libelle||'(non identifié)';
    by[k].attente[a]=(by[k].attente[a]||0)+v;
  });
  const entries=Object.entries(by).sort((a,b)=>a[0].localeCompare(b[0],'fr'));
  const blocks=entries.map(([k,d])=>{
    const net=d.prod+d.char;
    const payeurs=Object.entries(d.payeurs).sort((a,b)=>a[0].localeCompare(b[0],'fr'))
      .map(([a,v])=>`<tr><td style="color:var(--muted)">${esc(a)}</td>
        <td class="num" style="color:var(--green)">${eur(v)}</td></tr>`).join('');
    const deps=Object.entries(d.depcat).sort((a,b)=>a[0].localeCompare(b[0],'fr'))
      .map(([c,v])=>`<tr><td style="color:var(--muted)">${esc(c)}</td>
        <td class="num" style="color:var(--red)">${eur(v)}</td></tr>`).join('');
    const attEntries=Object.entries(d.attente).sort((a,b)=>a[0].localeCompare(b[0],'fr'));
    const attTot=attEntries.reduce((s,[,v])=>s+v,0);
    const attente=attEntries.map(([a,v])=>`<tr><td style="color:var(--muted)">${esc(a)}</td>
      <td class="num" style="color:var(--amber)">${eur(v)}</td></tr>`).join('');
    const attBlock = attEntries.length ? `
        <div class="tag" style="margin:10px 0 4px;color:var(--amber)">⏳ En attente de paiement (${attEntries.length}) · ${eur(attTot)}</div>
        <table style="margin-bottom:10px">${attente}</table>` : '';
    return `<details class="grp"><summary><span>${esc(k)}${attEntries.length?' <span class="pill prev">'+attEntries.length+' en attente</span>':''}</span>
        <span class="num" style="color:${net>=0?'var(--green)':'var(--red)'};font-weight:600">${eur(net)}</span></summary>
      <div class="body">
        <table style="margin-bottom:10px">
          <tr><td class="tag">Recettes</td><td class="num" style="color:var(--green)">${eur(d.prod)}</td></tr>
          <tr><td class="tag">Dépenses</td><td class="num" style="color:var(--red)">${eur(d.char)}</td></tr>
          <tr><td class="tag">Net</td><td class="num" style="font-weight:700;color:${net>=0?'var(--green)':'var(--red)'}">${eur(net)}</td></tr>
        </table>
        <div class="tag" style="margin-bottom:4px">Qui a payé (${Object.keys(d.payeurs).length})</div>
        <table style="margin-bottom:10px">${payeurs||'<tr><td class="tag">—</td></tr>'}</table>
        ${attBlock}
        <div class="tag" style="margin-bottom:4px">Dépenses par catégorie</div>
        <table>${deps||'<tr><td class="tag">—</td></tr>'}</table>
      </div></details>`;
  }).join('');
  $('#repBody').innerHTML=`<p class="note">Recettes, dépenses et net par sortie / voyage ${repSeason?'(saison '+repSeason+')':'(toutes saisons)'}. Touche une sortie pour voir qui a payé et qui reste à payer.</p>`+
    (blocks||'<div class="empty">Aucune sortie</div>');
}
document.querySelectorAll('#repSeg button').forEach(b=>b.onclick=()=>{
  repMode=b.dataset.r;document.querySelectorAll('#repSeg button').forEach(x=>x.classList.toggle('on',x===b));renderReport();});
function exportReport(){
  toast('Export à venir (Excel / PDF)');
}

/* ============ CSV IMPORT ============ */
let csvRows=null, csvHead=null;
$('#csvFile').onchange=e=>{
  const f=e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    let text=rd.result;
    // si caractères de remplacement (mauvais décodage), relire en Latin-1
    if(text.indexOf('\uFFFD')>=0){
      const rd2=new FileReader();
      rd2.onload=()=>parseCsv(rd2.result);
      rd2.readAsText(f,'ISO-8859-1');
    } else parseCsv(text);
  };
  rd.readAsText(f,'utf-8');
};
// Remplit un <select> à partir de paires [valeur, libellé]
function fillSel(sel,opts,val,blank){
  const el=$(sel); if(!el) return;
  el.innerHTML=(blank?'<option value="">—</option>':'')+
    opts.map(([v,l])=>`<option value="${esc(String(v))}" ${String(v)===String(val)?'selected':''}>${esc(String(l))}</option>`).join('');
}
function parseCsv(text){
  // detect delimiter
  const firstLine=text.split(/\r?\n/)[0];
  const delim=(firstLine.split(';').length>firstLine.split(',').length)?';':',';
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  const parse=l=>{const out=[];let cur='',q=false;
    for(let i=0;i<l.length;i++){const c=l[i];
      if(c==='"'){q=!q;} else if(c===delim&&!q){out.push(cur);cur='';} else cur+=c;}
    out.push(cur);return out.map(x=>x.trim().replace(/^"|"$/g,''));};
  csvHead=parse(lines[0]);
  csvRows=lines.slice(1).map(parse);
  const opts=csvHead.map((h,i)=>[i,h||('Col '+(i+1))]);
  ['#mDate','#mLib','#mDeb','#mCred','#mAmt'].forEach(s=>fillSel(s,opts.map(([i,h])=>[i,h]),null,true));
  // restore mapping
  const m=Store.data.mapping;
  if(m){ if(m.date!=null)$('#mDate').value=m.date; if(m.lib!=null)$('#mLib').value=m.lib;
    if(m.mode==='single'){setAmtMode('single');if(m.amt!=null)$('#mAmt').value=m.amt;}
    else{if(m.deb!=null)$('#mDeb').value=m.deb;if(m.cred!=null)$('#mCred').value=m.cred;}}
  else autoGuess();
  $('#mapArea').style.display='block';
  $('#impCount').textContent=csvRows.length+' ligne(s) détectée(s)';
}
let ceCols=null; // colonnes spécifiques Caisse d'Épargne si détectées
function autoGuess(){
  const h=csvHead.map(x=>norm(x));
  const find=keys=>{for(let i=0;i<h.length;i++)if(keys.some(k=>h[i].includes(k)))return i;return null;};
  const d=find(['DATE COMPTABLE','DATE']),
    l=find(['LIBELLE SIMPLIFIE','LIBELLE','LABEL','OPERATION','MOTIF']),
    deb=find(['DEBIT']),cr=find(['CREDIT']),mt=find(['MONTANT','AMOUNT']);
  if(d!=null)$('#mDate').value=d; if(l!=null)$('#mLib').value=l;
  if(deb!=null&&cr!=null){setAmtMode('split');$('#mDeb').value=deb;$('#mCred').value=cr;}
  else if(mt!=null){setAmtMode('single');$('#mAmt').value=mt;}
  // colonnes Caisse d'Épargne supplémentaires (infos complémentaires, type opération)
  ceCols={
    info: find(['INFORMATIONS COMPLEMENTAIRES','INFORMATION']),
    typeop: find(['TYPE OPERATION','TYPE D OPERATION']),
    dateop: find(['DATE OPERATION'])
  };
  // détection format Caisse d'Épargne
  const isCE = h.includes(norm('Libelle simplifie')) && h.includes(norm('Informations complementaires'));
  if(isCE){ $('#impFormat').textContent='Format détecté : Caisse d\u2019Épargne ✓'; $('#impFormat').style.display='block'; }
  else { $('#impFormat').style.display='none'; }
}
let amtMode='split';
function setAmtMode(m){ amtMode=m;
  document.querySelectorAll('#amtMode button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  $('#splitCols').style.display=m==='split'?'flex':'none';
  $('#singleCol').style.display=m==='single'?'block':'none'; }
document.querySelectorAll('#amtMode button').forEach(b=>b.onclick=()=>setAmtMode(b.dataset.m));
function parseDate(s){
  s=(s||'').trim();
  let m=s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if(m){let y=m[3];if(y.length===2)y='20'+y;return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
  m=s.match(/(\d{4})-(\d{2})-(\d{2})/); if(m)return s.slice(0,10);
  return '';
}
function parseNum(s){ if(!s)return 0; s=String(s).replace(/\s/g,'').replace(/\./g,(s.includes(',')?'':'.')).replace(',','.').replace(/[^0-9.\-]/g,''); return parseFloat(s)||0; }
function doImport(){
  const m={date:+$('#mDate').value, lib:+$('#mLib').value, mode:amtMode,
    deb:+$('#mDeb').value, cred:+$('#mCred').value, amt:+$('#mAmt').value};
  Store.data.mapping=m; Store.save();
  const cc=ceCols||{};
  let n=0,auto=0,adhn=0;
  csvRows.forEach(r=>{
    if(!r||r.length<2)return;
    const lib=(r[m.lib]||'').trim(); if(!lib && !r[m.date])return;
    let debit=0,credit=0;
    if(amtMode==='single'){const v=parseNum(r[m.amt]); if(v<0)debit=-v;else credit=v;}
    else{debit=Math.abs(parseNum(r[m.deb]));credit=Math.abs(parseNum(r[m.cred]));}
    if(!debit&&!credit)return;
    const info = (cc.info!=null && r[cc.info]) ? r[cc.info].trim() : '';
    const typeop = (cc.typeop!=null && r[cc.typeop]) ? r[cc.typeop].trim() : '';
    const t={libelle:lib,date:parseDate(r[m.date]),debit,credit,
      season:curSeason(),typeflux:'',cat1:'',cat2:'',cat3:'',compte:'',
      nature:guessNatureCE(typeop,lib),
      adherent:'',justif:'',comment:info,status:'draft'};
    // détecter l'adhérent depuis le libellé puis les infos complémentaires
    const a=matchAdherent(lib)||matchAdherent(info)||matchAdherentLoose(lib)||matchAdherentLoose(info);
    if(a){ t.adherent=a; adhn++; }
    // auto-classement via règles apprises
    const sug=suggest(t);
    if(sug){t.typeflux=sug.typeflux;t.cat1=sug.cat1;t.cat2=sug.cat2;t.cat3=sug.cat3||'';
      const ck=t.typeflux+'||'+t.cat1+'||'+t.cat2;t.compte=REF.compte[ck]||'';auto++;}
    Store.add(t); n++;
  });
  toast(`${n} importées en brouillon · ${auto} pré-classées · ${adhn} adhérents`);
  go('classer');
}
// Nature à partir du "Type operation" Caisse d'Épargne, sinon du libellé
function guessNatureCE(typeop,lib){
  const t=norm(typeop);
  if(t.includes('PAIEMENT CB')||t.includes('CARTE'))return'CB';
  if(t.includes('PRELEV'))return'PRLV';
  if(t.includes('CHEQUE'))return'CHQ';
  if(t.includes('VIREMENT')||t.includes('VIR')){ // affiner via libellé
    const l=norm(lib);
    if(l.includes('ANCV'))return'ANCV';
    if(l.includes('HELLOASSO')||l.includes('HELLO ASSO'))return'HA';
    return'VRT';
  }
  return guessNature(lib);
}
// Matching tolérant pour l'import : gère l'ordre Prénom/Nom, civilités, bruit
function matchAdherentLoose(text){
  if(!text) return '';
  const t=' '+norm(text).replace(/\b(MME|MR|MLE|MLLE|MADAME|MONSIEUR|MADEMOISELLE|VIR|SEPA|INST|DE|DU)\b/g,' ')+' ';
  for(const a of REF.adherents){
    const parts=norm(a).split(/\s+/).filter(p=>p.length>=3);
    if(parts.length<2) continue;
    const hits=parts.filter(p=>t.includes(' '+p+' ')).length;
    if(hits>=2) return a;
  }
  return '';
}
function guessNature(lib){const l=norm(lib);
  if(l.includes('CB ')||l.startsWith('CB'))return'CB';
  if(l.includes('PRLV')||l.includes('PRELEV'))return'PRLV';
  if(l.includes('VIR'))return'VRT';
  if(l.includes('ANCV'))return'ANCV';
  if(l.includes('HELLOASSO')||l.includes('HELLO ASSO'))return'HA';
  if(l.includes('CHEQUE')||l.includes('CHQ'))return'CHQ';
  return'';}

/* ============ PARAMÈTRES ============ */
/* Le référentiel REF est dérivé des feuilles SHEETS (comme l'Excel Classification).
   Toute édition modifie SHEETS puis reconstruit REF. */
function rebuildRefFromSheets(){
  const compte={}, cat2={}, cat3={}, adherents=[];
  // TABLE COMPTE -> compte + cat2 lists
  (SHEETS['TABLE COMPTE'].rows||[]).forEach(r=>{
    const [tf,c1,c2,cpt]=r; if(!tf||!c1||!c2)return;
    compte[tf+'||'+c1+'||'+c2]=cpt||'';
    const k=tf+'||'+c1; (cat2[k]=cat2[k]||[]); if(!cat2[k].includes(c2))cat2[k].push(c2);
  });
  // cat3 from ADHESION/SORTIE/TEXTILE/AUTRE
  ['ADHESION','SORTIE','TEXTILE','AUTRE'].forEach(sn=>{
    (SHEETS[sn].rows||[]).forEach(r=>{
      const [tf,c1,c2,c3]=r; if(!tf||!c2)return;
      const k=tf+'||'+c2; cat3[k]=cat3[k]||[];
      if(c3 && !cat3[k].includes(c3))cat3[k].push(c3);
    });
  });
  (SHEETS['ADHERENTS'].rows||[]).forEach(r=>{ if(r[0])adherents.push(r[0]); });
  REF.compte=compte; REF.cat2=cat2; REF.cat3=cat3; REF.adherents=adherents;
  adhListNorm._c=null; // reset cache
  Store.data.sheets=SHEETS; Store.data.ref=REF; Store.save();
}

const PARAM_MENU=[
  ['season','Saison par défaut','Choisir la saison affichée à l\u2019ouverture'],
  ['tables','Tables de classification','Comptes, sorties, adhérents… (1 volet par feuille)'],
  ['soldes','Soldes des comptes','Solde réel de chaque compte bancaire'],
  ['io','Import / sauvegarde','CSV bancaire, export et restauration JSON'],
  ['controls','Contrôles','Incohérences, doublons, champs manquants'],
  ['sync','Synchro & conflits','File d\u2019attente et conflits de synchronisation cloud'],
  ['about','À propos','Version, statut bêta et limites connues']
];
let paramView=null;
function renderParam(){ paramView?paramOpen(paramView):paramHome(); }
function paramHome(){
  paramView=null;
  $('#paramHome').style.display='block'; $('#paramSub').style.display='none';
  $('#paramHome').innerHTML=PARAM_MENU.map(([k,t,d])=>`
    <div class="card" style="cursor:pointer;display:flex;align-items:center;gap:12px" onclick="paramOpen('${k}')">
      <div style="flex:1"><div style="font-weight:600;font-size:15px">${t}${k==='sync'&&CloudSync.conflicts.length?` <span class="tag" style="background:var(--red,#e5484d);color:#fff">${CloudSync.conflicts.length}</span>`:''}</div>
        <div class="tag" style="margin-top:2px">${d}</div></div>
      <span style="color:var(--muted);font-size:20px">›</span></div>`).join('')
    + `<div class="card" id="accountCard" style="margin-top:16px">
        <div style="font-weight:600;font-size:15px;margin-bottom:4px">Compte</div>
        <div class="tag" id="accountEmail">—</div>
        <button class="btn ghost" style="margin-top:10px" onclick="doLogout()">Se déconnecter</button>
      </div>`;
  if(sb){ sb.auth.getUser().then(({data})=>{ const u=data&&data.user; if(u&&$('#accountEmail')) $('#accountEmail').textContent=u.email; }).catch(()=>{}); }
}
function paramGoHome(){ paramHome(); }
function paramOpen(k){
  paramView=k;
  $('#paramHome').style.display='none'; $('#paramSub').style.display='block';
  if(k==='season')paramSeason();
  else if(k==='tables')paramTables();
  else if(k==='soldes')paramSoldes();
  else if(k==='io')paramIO();
  else if(k==='controls'){ go('controls'); return; }
  else if(k==='sync')paramSync();
  else if(k==='about')paramAbout();
}

// Libellé lisible d'une opération pour l'affichage dans l'écran de conflits.
function txLabel(t){
  if(!t) return '(opération introuvable localement)';
  const d=fmtDateFull(t.date)||'—';
  const lib=t.libelle||t.adherent||'(sans libellé)';
  return `${d} · ${lib} · ${eur(amt(t))}`;
}

function paramSync(){
  const q=CloudSync.queue.length, c=CloudSync.conflicts;
  $('#paramSubBody').innerHTML=`<h2 style="font-size:16px">Synchro & conflits</h2>
    <div class="card">
      <div class="about-grid">
        <div class="about-k"><div class="lab">En attente d'envoi</div><div class="v">${q}</div></div>
        <div class="about-k"><div class="lab">Conflits non résolus</div><div class="v">${c.length}</div></div>
      </div>
      <p class="note" style="margin-top:8px">Un conflit apparaît quand une opération modifiée sur cet appareil a été modifiée ou supprimée ailleurs (autre appareil/utilisateur) avant l'envoi. Rien n'est jamais écrasé automatiquement dans ce cas.</p>
    </div>
    ${c.length===0?'<p class="note" style="margin-top:14px">Aucun conflit en attente. 👍</p>':
      c.map(cf=>{
        const t=Store.data.tx.find(x=>x.id===cf.id);
        return `<div class="card" style="margin-top:12px">
          <div style="font-weight:600;font-size:14px">${txLabel(t)}</div>
          <div class="tag" style="margin-top:4px">${cf.reason} — détecté le ${fmtDateFull(cf.when.slice(0,10))}</div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn" onclick="conflictReload('${cf.id}')">Reprendre la version cloud</button>
            <button class="btn ghost" onclick="conflictForce('${cf.id}')">Garder ma version locale</button>
            <button class="btn ghost" onclick="conflictDismiss('${cf.id}')">Ignorer</button>
          </div>
        </div>`;
      }).join('')}`;
}

// "Reprendre la version cloud" : écrase la version locale par celle du serveur.
async function conflictReload(id){
  if(!sb){ toast('Connexion cloud indisponible'); return; }
  try{
    const { data, error } = await sb.from('operations').select('*').eq('legacy_id', id).maybeSingle();
    if(error) throw error;
    if(!data){
      // La ligne n'existe plus côté cloud : on retire aussi la version locale.
      Store.data.tx = Store.data.tx.filter(x=>x.id!==id);
      toast('Opération supprimée côté cloud — retirée localement');
    } else {
      const fresh = cloudRowToTx(data);
      const idx = Store.data.tx.findIndex(x=>x.id===id);
      if(idx>=0) Store.data.tx[idx]=fresh; else Store.data.tx.push(fresh);
      toast('Version cloud reprise');
    }
    Store.save();
    CloudSync.clearConflict(id);
    paramSync();
    refreshCurrent();
  }catch(e){
    toast('Échec du rechargement : '+(e.message||e));
  }
}

// "Garder ma version locale" : renvoie la version locale en écrasant le cloud,
// en ignorant délibérément la vérification de conflit cette fois.
function conflictForce(id){
  const t=Store.data.tx.find(x=>x.id===id);
  if(!t){ toast('Opération introuvable localement'); CloudSync.clearConflict(id); paramSync(); return; }
  t._cloudUpdatedAt=null; // baseline nulle = pas de re-vérification, upsert direct
  Store.save();
  CloudSync.clearConflict(id);
  CloudSync.pushTx(t);
  toast('Version locale renvoyée au cloud');
  paramSync();
}

// "Ignorer" : referme juste l'alerte sans rien renvoyer ni recharger.
function conflictDismiss(id){
  CloudSync.clearConflict(id);
  toast('Conflit ignoré');
  paramSync();
}

function paramAbout(){
  $('#paramSubBody').innerHTML=`<h2 style="font-size:16px">À propos de ${APP_META.name}</h2>
    <p class="note">Application de gestion financière pour association de plongée. Connexion sécurisée active. Les données vivent dans le cloud (Supabase) : elles sont chargées au démarrage et tes saisies y sont renvoyées automatiquement. L'application ne contient plus de données intégrées — le cloud est l'unique source. L'indicateur en haut à droite montre l'état de synchronisation.</p>
    <div class="about-grid">
      <div class="about-k"><div class="lab">Application</div><div class="v">${APP_META.name}</div></div>
      <div class="about-k"><div class="lab">Version</div><div class="v">${APP_META.channel} ${APP_META.version}</div></div>
      <div class="about-k"><div class="lab">Synchro</div><div class="v">Lecture + écriture cloud</div></div>
      <div class="about-k"><div class="lab">Sauvegarde</div><div class="v">Cloud sécurisé (Supabase)</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <h2 style="font-size:15px">État du cloud</h2>
      <p class="note">Vérifie en direct les données enregistrées côté serveur (indépendamment de l'affichage local).</p>
      <button class="btn" id="cloudCheckBtn" style="margin-top:10px" onclick="cloudCheck()">Vérifier le cloud</button>
      <div id="cloudCheckResult" style="margin-top:12px"></div>
    </div>
    <div class="card" style="margin-top:14px">
      <h2>Limites bêta</h2>
      <p class="note">L'application nécessite une connexion Internet : les données sont dans le cloud, plus en dur dans le fichier. Si le cloud est injoignable au démarrage, l'appli affiche les données de la dernière session si elles sont en cache, sinon elle invite à recharger. Toutes tes modifications — opérations, tables de classification, règles, soldes et saison — sont renvoyées au cloud en arrière-plan (file d'attente + retry si le réseau manque). Pense à exporter de temps en temps via Paramètres → Import / sauvegarde.</p>
    </div>`;
}

// Interroge Supabase en direct et affiche les compteurs réels côté serveur.
async function cloudCheck(){
  const box=$('#cloudCheckResult'); const btn=$('#cloudCheckBtn');
  if(!sb){ box.innerHTML='<p class="note" style="color:var(--red)">Client cloud non chargé (vérifie ta connexion Internet).</p>'; return; }
  btn.disabled=true; btn.textContent='Vérification…';
  box.innerHTML='<p class="note">Interrogation du serveur…</p>';
  try{
    const tables=[
      ['operations','Opérations'],
      ['classification_sheets','Tables de classification'],
      ['rules','Règles'],
      ['settings','Réglages']
    ];
    const rows=[];
    for(const [t,label] of tables){
      const { count, error } = await sb.from(t).select('*',{count:'exact',head:true});
      rows.push({label, count: error?'—':count, err: error?error.message:null});
    }
    let solde='';
    try{
      const { data } = await sb.from('settings').select('value').eq('key','realBalances').single();
      if(data && data.value){ solde=`CC ${eur(data.value.CC)} · EP ${eur(data.value.EP)}`; }
    }catch(e){}
    const anyErr=rows.some(r=>r.err);
    box.innerHTML=`
      <div class="about-grid">
        ${rows.map(r=>`<div class="about-k"><div class="lab">${r.label}</div><div class="v">${r.count}</div></div>`).join('')}
      </div>
      ${solde?`<p class="note" style="margin-top:8px">Soldes enregistrés : ${solde}</p>`:''}
      <p class="note" style="margin-top:8px;color:${anyErr?'var(--red)':'var(--green)'}">
        ${anyErr?'Connexion établie mais accès partiel — vérifie que tu es bien connecté.':'✓ Connexion au cloud opérationnelle. Ces chiffres viennent directement du serveur.'}
      </p>`;
  }catch(e){
    box.innerHTML='<p class="note" style="color:var(--red)">Échec de la vérification : '+(e.message||e)+'</p>';
  }finally{
    btn.disabled=false; btn.textContent='Vérifier le cloud';
  }
}

/* --- Saison par défaut --- */
function paramSeason(){
  const cur=Store.data.defaultSeason||'2025-2026';
  $('#paramSubBody').innerHTML=`<h2 style="font-size:16px">Saison par défaut</h2>
    <p class="note">Saison sélectionnée automatiquement à l'ouverture de l'appli.</p>
    <select id="defSeason" style="margin-top:8px">${allSeasons().map(s=>`<option ${s===cur?'selected':''}>${s}</option>`).join('')}</select>`;
  $('#defSeason').onchange=e=>{ Store.data.defaultSeason=e.target.value; Store.data.season=null; Store.save(); CloudSync.pushSetting('defaultSeason', Store.data.defaultSeason); toast('Saison par défaut: '+e.target.value); };
}

/* --- Tables de classification : 1 volet par feuille --- */
let tableSheet=null;
function paramTables(){
  if(tableSheet){ paramSheetEdit(tableSheet); return; }
  const names=Object.keys(SHEETS);
  $('#paramSubBody').innerHTML=`<h2 style="font-size:16px">Tables de classification</h2>
    <p class="note">Une feuille = un volet, comme dans le fichier Excel Classification.</p>`+
    names.map(sn=>`<div class="card" style="cursor:pointer;display:flex;align-items:center;gap:12px" onclick="tableSearch='';paramSheetEdit('${esc(sn)}')">
      <div style="flex:1"><div style="font-weight:600;font-size:14px">${esc(sn)}</div>
      <div class="tag">${(SHEETS[sn].rows||[]).length} lignes</div></div>
      <span style="color:var(--muted)">›</span></div>`).join('');
}
let tableSel=new Set();
let tableSearch='';
function paramSheetEdit(sn){
  tableSheet=sn; 
  const sh=SHEETS[sn]; const hdr=sh.header; const rows=sh.rows;
  tableSel=new Set([...tableSel].filter(i=>i<rows.length));
  let html=`<button class="btn ghost sm" style="margin-bottom:10px" onclick="tableSheet=null;tableSel=new Set();tableSearch='';paramTables()">‹ Toutes les feuilles</button>
    <h2 style="font-size:16px">${esc(sn)}</h2>
    <div class="draftbar" style="position:static;margin-bottom:10px;flex-wrap:wrap">
      <label class="selall"><input type="checkbox" id="tblAll" onchange="tblToggleAll('${esc(sn)}',this.checked)"> Tout</label>
      <span id="tblSelCount" class="tag"></span><span style="flex:1"></span>
      <button class="btn sm" onclick="tblMove('${esc(sn)}',-1)" title="Monter">↑</button>
      <button class="btn sm" onclick="tblMove('${esc(sn)}',1)" title="Descendre">↓</button>
      <button class="btn sec sm" onclick="tblDup('${esc(sn)}')">⎘</button>
      <button class="btn sec sm" onclick="tblDel('${esc(sn)}')"><span class="del">🗑</span></button>
    </div>
    <div class="sortbar">Trier : ${hdr.map((h,ci)=>`<button class="sortbtn" onclick="tblSort('${esc(sn)}',${ci})">${esc(h)} ⇅</button>`).join('')}</div>
    <div class="searchbar"><input id="tblSearch" placeholder="🔍 Rechercher dans ${esc(sn)}…" value="${esc(tableSearch)}" oninput="tableSearch=this.value;paramSheetEdit('${esc(sn)}')"></div>
    <div class="lrows">`;
  const q=norm(tableSearch);
  let shown=0;
  rows.forEach((r,ri)=>{
    if(q && !norm(r.join(' ')).includes(q)) return;
    shown++;
    const checked=tableSel.has(ri)?'checked':'';
    // dernière colonne non vide mise en avant (souvent Cat 3 / nom)
    const main = (r[hdr.length-1]||'').trim() || (r[hdr.length-2]||'').trim() || (r[0]||'');
    const ctx = hdr.length>1 ? r.slice(0,hdr.length-1).filter(Boolean).join(' › ') : '';
    html+=`<div class="lrow ${tableSel.has(ri)?'sel':''}" data-ri="${ri}">
      <input type="checkbox" ${checked} onclick="event.stopPropagation();tblToggle('${esc(sn)}',${ri},this.checked)">
      <div class="lrow-main" onclick="tblEdit('${esc(sn)}',${ri})">
        <div class="lrow-t">${main? esc(main) : '<span class="muted-i">(vide)</span>'}</div>
        ${ctx?`<div class="lrow-c">${esc(ctx)}</div>`:''}
      </div>
      <button class="lrow-edit" onclick="tblEdit('${esc(sn)}',${ri})">✎</button>
    </div>`;
  });
  if(q && !shown) html+=`<div class="empty" style="padding:24px">Aucun résultat pour « ${esc(tableSearch)} »</div>`;
  html+=`</div>
    <button class="btn sec sm" style="margin-top:12px" onclick="addRow('${esc(sn)}')">＋ Ajouter une ligne</button>`;
  $('#paramSubBody').innerHTML=html;
  // refocus search if active
  if(tableSearch){ const si=$('#tblSearch'); if(si){ si.focus(); si.setSelectionRange(si.value.length,si.value.length); } }
  tblUpdateBar(sn);
}
// Panneau d'édition d'une ligne de table (au tap)
function tblEdit(sn,ri){
  const sh=SHEETS[sn]; const hdr=sh.header; const r=sh.rows[ri];
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="sheet-head"><div class="grab"></div><button type="button" class="sheet-close" onclick="closeSheet()" aria-label="Fermer">✕</button></div><h2>Modifier la ligne #${ri+1}</h2>
    ${hdr.map((h,ci)=>`<div class="field"><label>${esc(h)}</label>
      <input id="te_${ci}" value="${esc(r[ci]||'').replace(/"/g,'&quot;')}"></div>`).join('')}
    <button class="btn" onclick="tblEditSave('${esc(sn)}',${ri})">Enregistrer</button>
    <button class="btn ghost" style="margin-top:10px" onclick="closeSheet()">Annuler</button>`;
  openSheet();
}
function tblEditSave(sn,ri){
  const sh=SHEETS[sn]; const hdr=sh.header;
  hdr.forEach((h,ci)=>{ sh.rows[ri][ci]=($('#te_'+ci).value||'').trim(); });
  rebuildRefFromSheets(); persistSheets(); closeSheet(); paramSheetEdit(sn); toast('Ligne modifiée');
}
function tblToggle(sn,ri,on){ if(on)tableSel.add(ri); else tableSel.delete(ri); tblUpdateBar(sn);
  const rows=document.querySelectorAll('#paramSubBody .lrow'); if(rows[ri])rows[ri].classList.toggle('sel',on); }
function tblToggleAll(sn,on){ tableSel = on ? new Set(SHEETS[sn].rows.map((_,i)=>i)) : new Set(); paramSheetEdit(sn); }
function tblUpdateBar(sn){ const n=tableSel.size, total=SHEETS[sn].rows.length;
  $('#tblSelCount').textContent=n?`${n} sélectionnée(s)`:'';
  const all=$('#tblAll'); if(all){ all.checked=n>0&&n===total; all.indeterminate=n>0&&n<total; } }
function tblDel(sn){ const idx=[...tableSel].sort((a,b)=>b-a); if(!idx.length){toast('Sélectionne des lignes');return;}
  confirmModal(`Supprimer ${idx.length} ligne(s) ?`, ()=>{
    idx.forEach(i=>SHEETS[sn].rows.splice(i,1)); tableSel=new Set(); rebuildRefFromSheets(); persistSheets(); paramSheetEdit(sn); toast('Supprimé');
  }, '🗑 Supprimer'); }
function tblDup(sn){ const idx=[...tableSel].sort((a,b)=>a-b); if(!idx.length){toast('Sélectionne des lignes');return;}
  const copies=idx.map(i=>SHEETS[sn].rows[i].slice());
  const insAt=Math.max(...idx)+1; SHEETS[sn].rows.splice(insAt,0,...copies);
  tableSel=new Set(); rebuildRefFromSheets(); persistSheets(); paramSheetEdit(sn); toast('Dupliqué'); }
function tblMove(sn,dir){ const rows=SHEETS[sn].rows; let idx=[...tableSel].sort((a,b)=>dir<0?a-b:b-a);
  if(!idx.length){toast('Sélectionne des lignes');return;}
  const newSel=new Set();
  idx.forEach(i=>{ const j=i+dir; if(j<0||j>=rows.length){newSel.add(i);return;}
    [rows[i],rows[j]]=[rows[j],rows[i]]; newSel.add(j); });
  tableSel=newSel; rebuildRefFromSheets(); persistSheets(); paramSheetEdit(sn); }
function tblSort(sn,ci){ const sh=SHEETS[sn]; sh._sortCi=ci; sh._sortDir=(sh._sortCi===ci&&sh._sortDir===1)?-1:1;
  sh.rows.sort((a,b)=>String(a[ci]||'').localeCompare(String(b[ci]||''),'fr')*sh._sortDir);
  tableSel=new Set(); rebuildRefFromSheets(); persistSheets(); paramSheetEdit(sn); }
function editCell(sn,ri,ci,val){ SHEETS[sn].rows[ri][ci]=val.trim(); rebuildRefFromSheets(); persistSheets(); }
function delRow(sn,ri){ confirmModal('Supprimer cette ligne ?', ()=>{ SHEETS[sn].rows.splice(ri,1); rebuildRefFromSheets(); persistSheets(); paramSheetEdit(sn); toast('Supprimée'); }, '🗑 Supprimer'); }
function addRow(sn){ const n=SHEETS[sn].header.length; SHEETS[sn].rows.push(new Array(n).fill('')); rebuildRefFromSheets(); persistSheets(); paramSheetEdit(sn); }
function persistSheets(){ Store.data.sheets=SHEETS; Store.save(); CloudSync.pushAllSheets(); }

/* --- Soldes d'ouverture --- */
function paramSoldes(){
  const real=Store.data.realBalances||{};
  $('#paramSubBody').innerHTML=`<h2 style="font-size:16px">Soldes des comptes</h2>
    <p class="note">Saisis le solde réel de chaque compte (celui affiché sur ton relevé bancaire). Il est affiché tel quel sur l'accueil.</p>`+
    Object.entries(ACCOUNTS).map(([k,lbl])=>`<div class="field">
      <label>${lbl}</label>
      <input type="number" step="0.01" id="open_${k}" value="${real[k]!=null?real[k]:''}" placeholder="0.00"
        onchange="setRealBal('${k}',this.value)"></div>`).join('');
}
function setRealBal(k,v){ Store.data.realBalances=Store.data.realBalances||{};
  Store.data.realBalances[k]=parseFloat(v); if(isNaN(Store.data.realBalances[k]))delete Store.data.realBalances[k];
  Store.save(); CloudSync.pushBalances(); toast('Solde enregistré'); if(document.querySelector('#v-dash.active'))renderDash(); }

/* --- Import / Export --- */
function paramIO(){
  $('#paramSubBody').innerHTML=`<h2 style="font-size:16px">Import / sauvegarde</h2>
    <p class="note">Les données sont stockées sur cet appareil. Exporte régulièrement une sauvegarde JSON.</p>
    <button class="btn" style="margin-bottom:10px" onclick="go('import')">📥 Importer un CSV bancaire</button>
    <button class="btn sec" style="margin-bottom:10px" onclick="downloadBackup()">💾 Exporter une sauvegarde JSON</button>
    <button class="btn ghost" onclick="triggerBackupImport()">↥ Restaurer une sauvegarde JSON</button>
    <input class="backup-input" id="backupFile" type="file" accept="application/json,.json" onchange="importBackupFile(this)">`;
}


/* ============ ERGONOMIE v0.3.0 ============ */
function controlStats(){
  const all=Store.all();
  const real=all.filter(t=>!isDraft(t)&&!isFuture(t));
  const drafts=draftTx();
  const unclassified=unclassifiedTx();
  const incoh=incoherentTx();
  const noSeason=real.filter(t=>!(t.season||'').trim());
  const noAmount=real.filter(t=>(parseFloat(t.debit)||0)===0 && (parseFloat(t.credit)||0)===0);
  const noJustif=real.filter(t=>!(t.justif||'').trim());
  const noAdh=real.filter(t=>['ADHESION','LICENCE','ASSURANCE','FORMATION'].includes(t.cat2) && !(t.adherent||'').trim());
  const seen={};
  real.forEach(t=>{ const key=[t.date||'',norm(t.libelle||''),Number(t.debit||0).toFixed(2),Number(t.credit||0).toFixed(2)].join('|'); (seen[key]=seen[key]||[]).push(t); });
  const duplicates=Object.values(seen).filter(a=>a.length>1).flat();
  return {drafts,unclassified,incoh,noSeason,noAmount,noJustif,noAdh,duplicates};
}
function renderDashAttention(){
  const st=controlStats();
  const todo=st.drafts.length+st.unclassified.length+st.incoh.length;
  const d=$('#dashDraftCount'); if(d)d.textContent=todo;
  const card=$('#attentionCard'); if(!card) return;
  const rows=[
    ['Brouillons à traiter',st.drafts.length,"go('classer')"],
    ['Opérations non classées',st.unclassified.length,"go('classer')"],
    ['Incohérences détectées',st.incoh.length,"go('controls')"],
    ['Doublons probables',st.duplicates.length,"go('controls')"]
  ];
  card.innerHTML=`<h2>Points à traiter</h2><div class="attn-list">`+rows.map(([label,n,act])=>
    `<div class="attn-item" onclick="${act}"><div><strong>${label}</strong><span>${n?n+' élément(s)':'RAS'}</span></div><span class="pill ${n?'cf':'ca'}">${n}</span></div>`
  ).join('')+`</div>`;
}
function controlBlock(title, arr, hint){
  const items=arr.slice(0,25).map(t=>`<div class="attn-item" onclick="openTx('${t.id}','REEL')"><div><strong>${esc(t.libelle||'(sans libellé)')}</strong><span>${fmtDateY(t.date)} · ${esc(t.cat2||'à classer')} ${t.cat3?'· '+esc(t.cat3):''}</span></div><span>${eur(amt(t))}</span></div>`).join('');
  return `<details class="grp" ${arr.length?'open':''}><summary><span>${title}</span><span class="tag">${arr.length}</span></summary><div class="body"><p class="note">${hint}</p>${items||'<div class="empty" style="padding:18px">RAS</div>'}${arr.length>25?`<div class="tag" style="margin-top:8px">25 premières lignes affichées.</div>`:''}</div></details>`;
}
function renderControls(){
  const st=controlStats();
  $('#controlsBody').innerHTML=`<div class="kpis">
    <div class="kpi"><div class="lab">Brouillons</div><div class="val" style="color:var(--amber)">${st.drafts.length}</div></div>
    <div class="kpi"><div class="lab">Incohérences</div><div class="val" style="color:var(--red)">${st.incoh.length}</div></div>
  </div>`+
  controlBlock('Brouillons',st.drafts,'Lignes importées ou ajoutées qui ne sont pas encore passées dans les opérations.')+
  controlBlock('Opérations non classées',st.unclassified,'Lignes réelles sans catégorie exploitable.')+
  controlBlock('Incohérences de classement',st.incoh,'Compte incohérent, sous-catégorie manquante ou débit/crédit simultanés.')+
  controlBlock('Doublons probables',st.duplicates,'Même date, même libellé et même montant. À vérifier avant suppression.')+
  controlBlock('Saison manquante',st.noSeason,'Une saison vide rend les bilans faux ou incomplets.')+
  controlBlock('Montant nul',st.noAmount,'Débit et crédit à zéro : probablement une erreur de saisie.')+
  controlBlock('Adhérent manquant',st.noAdh,'Catégories liées aux personnes sans adhérent renseigné.')+
  controlBlock('Sans justificatif',st.noJustif,'Pas toujours bloquant, mais utile pour le contrôle interne.');
}
function toggleAdvancedTx(){
  const a=$('#txAdvanced'); const b=document.querySelector('.adv-toggle'); if(!a||!b)return;
  a.classList.toggle('open'); b.textContent=(a.classList.contains('open')?'▾':'▸')+' Détails avancés';
}
function downloadBackup(){
  const payload={app:APP_META.name,version:APP_META.version,exportedAt:new Date().toISOString(),data:Store.data};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`scuborga-sauvegarde-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),500);
  toast('Sauvegarde exportée');
}
function triggerBackupImport(){ const i=$('#backupFile'); if(i)i.click(); }
function importBackupFile(input){
  const file=input.files&&input.files[0]; if(!file)return;
  const r=new FileReader();
  r.onload=()=>{ try{
    const payload=JSON.parse(r.result);
    const data=payload.data||payload;
    if(!data || !Array.isArray(data.tx)) throw new Error('format');
    confirmModal('Remplacer les données locales par cette sauvegarde ?',()=>{
      Store.data=data; Store.save(); closeSheet(); toast('Sauvegarde importée'); go('dash');
    },'Importer');
  }catch(e){ toast('Sauvegarde invalide'); } };
  r.readAsText(file);
}

/* ============ LECTURE CLOUD (0.4.0) ============ */
// Convertit une ligne Supabase (table operations) vers le format interne de l'appli.
function cloudRowToTx(r){
  return {
    id: r.legacy_id || r.id,
    account: r.account || 'CC',
    typeflux: r.typeflux || '',
    cat1: r.cat1 || '', cat2: r.cat2 || '', cat3: r.cat3 || '',
    compte: r.compte || '',
    season: r.season || '',
    nature: r.nature || '',
    libelle: r.libelle || '',
    date: r.op_date || '',
    debit: Number(r.debit || 0),
    credit: Number(r.credit || 0),
    adherent: r.adherent || '',
    justif: r.justif || '',
    comment: r.comment || '',
    lettrage: r.lettrage || '',
    pointage: r.pointage || '',
    origStatus: r.orig_status || '',
    isPrev: !!r.is_prev,
    status: r.status || '',
    _cloudUpdatedAt: r.updated_at || null
  };
}

// Récupère TOUTES les opérations (pagination par 1000, limite Supabase).
async function fetchAllOperations(){
  const PAGE=1000; let from=0; let out=[];
  for(;;){
    const { data, error } = await sb.from('operations')
      .select('*').order('op_date',{ascending:false, nullsFirst:false})
      .range(from, from+PAGE-1);
    if(error) throw error;
    out=out.concat(data);
    if(!data || data.length<PAGE) break;
    from+=PAGE;
  }
  return out;
}

// Charge opérations + tables + règles + réglages depuis Supabase dans Store.data.
// Renvoie true si OK, false sinon (l'appelant gère le repli local).
async function loadFromCloud(){
  if(!sb) return false;
  try{
    const ops = await fetchAllOperations();
    const { data: sheetsRows, error: e2 } = await sb.from('classification_sheets').select('*');
    if(e2) throw e2;
    const { data: rulesRows, error: e3 } = await sb.from('rules').select('*');
    if(e3) throw e3;
    const { data: setRows, error: e4 } = await sb.from('settings').select('*');
    if(e4) throw e4;

    // Opérations
    Store.data.tx = ops.map(cloudRowToTx);

    // Tables de classification → objet {NOM:{header,rows}}
    const sheets={};
    (sheetsRows||[]).forEach(s=>{ sheets[s.name]={header:s.header, rows:s.rows}; });
    if(Object.keys(sheets).length){ Store.data.sheets = sheets; }

    // Règles
    Store.data.rules = (rulesRows||[]).map(r=>({match:r.match, typeflux:r.typeflux, cat1:r.cat1, cat2:r.cat2, cat3:r.cat3}));

    // Réglages
    (setRows||[]).forEach(row=>{
      if(row.key==='realBalances') Store.data.realBalances = row.value;
      else if(row.key==='seq') Store.data.seq = Number(row.value)||Store.data.seq;
      else if(row.key==='defaultSeason') Store.data.defaultSeason = row.value || null;
    });

    Store.data._fromCloud = true;
    Store.save();   // cache local : sert de filet si le cloud est injoignable à la prochaine ouverture
    return true;
  }catch(e){
    console.warn('Chargement cloud échoué', e);
    return false;
  }
}

/* ============ INIT (lancé seulement après authentification) ============ */
async function startApp(){
  let cloudOK=false;
  try{ cloudOK = await loadFromCloud(); }catch(e){ cloudOK=false; }

  if(!cloudOK){
    // Plus de données en dur : on tente le cache local d'une session précédente.
    Store.load();
    if(Store.data.tx && Store.data.tx.length){
      toast('Cloud injoignable — données de la dernière session');
    } else {
      // Aucun cache : on évite un écran vide et on invite à réessayer.
      toast('Cloud injoignable. Vérifie ta connexion et recharge la page.');
    }
  } else {
    // Cloud joignable : on restaure les changements non synchronisés d'une
    // session précédente (fermeture d'onglet pendant un envoi en attente) (0.8.4).
    CloudSync.restoreQueue();
    CloudSync.restoreConflicts();
    if(CloudSync.conflicts.length){
      toast(CloudSync.conflicts.length+' conflit(s) de synchro à vérifier');
      CloudSync.updateBadge();
    }
    if(CloudSync.queue.length){
      toast(CloudSync.queue.length+' changement(s) en attente — synchro en cours…');
      CloudSync.run();
    }
  }

  if(Store.data.sheets && Store.data.sheets['TABLE COMPTE']){
    SHEETS = Store.data.sheets;       // tables (cloud ou cache local)
    rebuildRefFromSheets();           // régénère REF (cat2/cat3/compte/adherents)
  } else if(Store.data.ref && Store.data.ref.typeFlux && Store.data.ref.cat2 && Store.data.ref.adherents){
    REF = Store.data.ref;
  }
  go('dash');
}
// Au chargement : tente de restaurer une session ; sinon l'écran de connexion reste affiché.
checkSession();
