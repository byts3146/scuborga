import { APP_META } from './config.js';
import { REF } from './ref-data.js';
import { supabase } from './supabase-client.js';
import { fetchAllOperations, upsertOperation, deleteOperation } from './operations-api.js';
import { $, $$, escapeHtml, euro, fmtDate, todayIso, seasonFromDate, downloadJson, downloadCsv, debounce } from './utils.js';
import { summarize, getSeasons, filterBySeason, resultByCategory, byTrip, byMember, findControls } from './reporting.js';

const State = {
  session: null,
  ops: [],
  view: 'dash',
  selectedSeason: '',
  filters: { search:'', account:'', typeflux:'', quick:'' },
  editing: null,
  loading: false,
  lastSync: null
};

const COMPTE_BY_KEY = REF.compte || {};

document.title = `${APP_META.name} · ${APP_META.channel} ${APP_META.version}`;

init();

async function init(){
  bindAuth();
  const { data } = await supabase.auth.getSession();
  State.session = data.session;
  supabase.auth.onAuthStateChange((_event, session) => {
    State.session = session;
    render();
    if(session) loadOperations();
  });
  render();
  if(State.session) await loadOperations();
}

function bindAuth(){
  document.addEventListener('submit', async e => {
    if(e.target?.id !== 'loginForm') return;
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    const mode = e.submitter?.dataset.mode || 'signin';
    setLoginMessage('Connexion...');
    try{
      const { error } = mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if(error) throw error;
      setLoginMessage(mode === 'signup' ? 'Compte créé. Vérifie tes emails si Supabase demande une confirmation.' : 'Connecté.', 'success');
    }catch(err){
      setLoginMessage(err.message || String(err), 'error');
    }
  });
}

function setLoginMessage(text, kind='info'){
  const el = $('#loginMessage');
  if(!el) return;
  el.className = kind === 'error' ? 'error-box' : kind === 'success' ? 'success-box' : 'warn-box';
  el.textContent = text;
  el.classList.remove('hidden');
}

async function loadOperations(){
  State.loading = true; updateHeaderSync('Chargement', '');
  try{
    State.ops = await fetchAllOperations();
    State.lastSync = new Date();
    const seasons = getSeasons(State.ops);
    if(!State.selectedSeason) State.selectedSeason = seasons[0] || '';
    updateHeaderSync('Synchronisé', 'ok');
  }catch(err){
    console.error(err);
    updateHeaderSync('Erreur Supabase', 'err');
    toast(err.message || 'Erreur Supabase');
  }finally{
    State.loading = false;
    renderApp();
  }
}

function render(){
  if(!State.session){
    document.body.innerHTML = renderLogin();
    return;
  }
  document.body.innerHTML = renderShell();
  bindUi();
  renderApp();
}

function renderLogin(){
  return `<div class="login-wrap">
    <form id="loginForm" class="login-card">
      <h1>${APP_META.name}</h1>
      <p class="sub">${APP_META.channel} ${APP_META.version} · Supabase obligatoire</p>
      <div class="field"><label>Email</label><input id="loginEmail" type="email" autocomplete="email" required></div>
      <div class="field"><label>Mot de passe</label><input id="loginPassword" type="password" autocomplete="current-password" required></div>
      <div class="row">
        <button class="btn" data-mode="signin" type="submit">Se connecter</button>
        <button class="btn sec" data-mode="signup" type="submit">Créer un compte</button>
      </div>
      <div id="loginMessage" class="hidden"></div>
      <p class="note">Les politiques RLS Supabase exigent un utilisateur authentifié. C’est volontaire.</p>
    </form>
  </div>`;
}

function renderShell(){
  return `<div class="app">
    <header>
      <div class="htitle">
        <div class="header-left"><h1 id="hTitle">${titleForView(State.view)}</h1><span class="version">${APP_META.channel} ${APP_META.version}</span></div>
        <div class="header-right"><span id="syncDot" class="sync-dot"></span><span id="syncText">—</span></div>
      </div>
    </header>
    <section class="view active" id="mainView"></section>
  </div>
  <nav id="nav">
    ${navBtn('dash','Accueil','M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z')}
    ${navBtn('ops','Opérations','M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01')}
    ${navBtn('report','Bilans','M3 3v18h18M18 17V9M13 17V5M8 17v-3')}
    ${navBtn('controls','Contrôles','M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11')}
    ${navBtn('param','Paramètres','M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z')}
  </nav>
  <div class="drawer-bg" id="drawerBg"><div class="drawer" id="drawer"></div></div>
  <div class="toast" id="toast"></div>`;
}

function navBtn(view, label, path){
  return `<button data-view="${view}" class="${State.view===view?'on':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${path}"/></svg>${label}</button>`;
}

function bindUi(){
  $('#nav').addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if(!btn) return;
    State.view = btn.dataset.view;
    $('#hTitle').textContent = titleForView(State.view);
    $$('#nav button').forEach(b=>b.classList.toggle('on', b.dataset.view===State.view));
    renderApp();
  });
}

function renderApp(){
  if(!State.session || !$('#mainView')) return;
  $('#mainView').innerHTML = State.loading ? `<div class="empty"><p>Chargement Supabase...</p></div>` : viewHtml();
  bindView();
  updateHeaderSync(State.lastSync ? `Sync ${State.lastSync.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}` : 'Connecté', 'ok');
}

function viewHtml(){
  if(State.view === 'dash') return renderDashboard();
  if(State.view === 'ops') return renderOperations();
  if(State.view === 'report') return renderReports();
  if(State.view === 'controls') return renderControls();
  return renderParams();
}

function bindView(){
  $$('[data-action]').forEach(el => el.addEventListener('click', onAction));
  const season = $('#seasonSelect');
  if(season) season.addEventListener('change', e => { State.selectedSeason = e.target.value; renderApp(); });
  const search = $('#opsSearch');
  if(search) search.addEventListener('input', debounce(e => { State.filters.search = e.target.value; renderApp(); }, 120));
  ['accountFilter','typeFilter','quickFilter'].forEach(id => {
    const el = $('#' + id); if(!el) return;
    el.addEventListener('change', e => { State.filters[id.replace('Filter','').replace('type','typeflux')] = e.target.value; renderApp(); });
  });
}

async function onAction(e){
  const action = e.currentTarget.dataset.action;
  if(action === 'sync') return loadOperations();
  if(action === 'new') return openEditor();
  if(action === 'export-json') return exportJson();
  if(action === 'export-csv') return exportCsv();
  if(action === 'logout') return supabase.auth.signOut();
  if(action === 'clear-filters') { State.filters = { search:'', account:'', typeflux:'', quick:'' }; return renderApp(); }
  if(action === 'open-op') {
    const op = State.ops.find(o => o.id === e.currentTarget.dataset.id);
    return openEditor(op);
  }
}

function renderDashboard(){
  const ops = filterBySeason(State.ops, State.selectedSeason);
  const all = summarize(ops);
  const unc = findControls(ops).missingCategory.length;
  const seasons = getSeasons(State.ops);
  const recent = State.ops.slice(0, 8);
  return `${seasonPicker(seasons)}
    <div class="action-grid">
      <button class="btn" data-action="new">＋ Nouvelle opération</button>
      <button class="btn sec" data-action="sync">↻ Synchroniser</button>
      <button class="btn sec" data-action="export-json">⬇︎ Export JSON</button>
      <button class="btn sec" data-action="export-csv">⬇︎ Export CSV</button>
    </div>
    <div class="kpis">
      ${kpi('Produits', euro(all.credit), 'green')}
      ${kpi('Charges', euro(all.debit), 'red')}
      ${kpi('Résultat', euro(all.net), all.net>=0?'green':'red')}
      ${kpi('À classer', String(unc), 'amber')}
    </div>
    <div class="card status-card"><div><div class="lab">Source</div><div class="big">Supabase</div></div><div class="tag">${State.ops.length} opérations chargées</div></div>
    <div class="card"><h2>Dernières opérations</h2>${recent.map(opRow).join('') || empty('Aucune opération')}</div>`;
}

function renderOperations(){
  const ops = filteredOps();
  const accounts = Array.from(new Set(State.ops.map(o=>o.account).filter(Boolean))).sort();
  return `<div class="toolbar">
      <input id="opsSearch" class="grow" placeholder="🔍 Rechercher" value="${escapeHtml(State.filters.search)}">
      <button class="btn sm" data-action="new">＋ Ajouter</button>
      <button class="btn sec sm" data-action="sync">↻ Sync</button>
    </div>
    <div class="grid-3">
      <div class="field"><label>Compte</label><select id="accountFilter"><option value="">Tous</option>${accounts.map(a=>opt(a, State.filters.account)).join('')}</select></div>
      <div class="field"><label>Type</label><select id="typeFilter"><option value="">Tous</option>${['PRODUITS','CHARGES'].map(v=>opt(v, State.filters.typeflux)).join('')}</select></div>
      <div class="field"><label>Filtre rapide</label><select id="quickFilter"><option value="">Aucun</option>${[['month','Ce mois-ci'],['season','Saison sélectionnée'],['unpointed','Non pointées'],['nojustif','Sans justificatif'],['prev','Prévisionnelles'],['unclassified','À classer']].map(([v,l])=>`<option value="${v}" ${State.filters.quick===v?'selected':''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="filter-summary"><b>${ops.length}</b> opération(s) affichée(s) sur ${State.ops.length}</div>
    <div id="opsList">${ops.slice(0,400).map(opRow).join('') || empty('Aucune opération')}</div>
    ${ops.length>400?`<p class="note">Affichage limité aux 400 premières lignes. Affine les filtres.</p>`:''}`;
}

function filteredOps(){
  let ops = [...State.ops];
  const q = State.filters.search.trim().toLowerCase();
  if(q) ops = ops.filter(o => [o.libelle,o.adherent,o.cat2,o.cat3,o.justif,o.comment,o.legacyId].some(v => String(v||'').toLowerCase().includes(q)));
  if(State.filters.account) ops = ops.filter(o => o.account === State.filters.account);
  if(State.filters.typeflux) ops = ops.filter(o => o.typeflux === State.filters.typeflux);
  const quick = State.filters.quick;
  if(quick === 'month'){
    const ym = todayIso().slice(0,7); ops = ops.filter(o => (o.date||'').startsWith(ym));
  }
  if(quick === 'season') ops = filterBySeason(ops, State.selectedSeason);
  if(quick === 'unpointed') ops = ops.filter(o => !o.isPrev && !o.pointage);
  if(quick === 'nojustif') ops = ops.filter(o => !o.justif);
  if(quick === 'prev') ops = ops.filter(o => o.isPrev);
  if(quick === 'unclassified') ops = ops.filter(o => !o.typeflux || !o.cat1 || !o.cat2);
  return ops;
}

function renderReports(){
  const seasons = getSeasons(State.ops);
  const ops = filterBySeason(State.ops, State.selectedSeason);
  const summary = summarize(ops);
  const cats = resultByCategory(ops);
  const trips = byTrip(ops);
  const members = byMember(ops);
  return `${seasonPicker(seasons)}
    <div class="kpis">${kpi('Produits', euro(summary.credit),'green')}${kpi('Charges', euro(summary.debit),'red')}${kpi('Résultat', euro(summary.net), summary.net>=0?'green':'red')}${kpi('Lignes', String(summary.count),'')}</div>
    ${reportTable('Résultat par catégorie', ['Type','Cat. 1','Cat. 2','Produits','Charges','Net'], cats.map(r=>[r.typeflux,r.cat1,r.cat2,euro(r.credit),euro(r.debit),euro(r.net)]))}
    ${reportTable('Sorties / voyages', ['Sortie','Produits','Charges','Net','Lignes'], trips.map(r=>[r.name,euro(r.credit),euro(r.debit),euro(r.net),r.count]))}
    ${reportTable('Adhérents', ['Adhérent','Produits','Charges','Net','Lignes'], members.map(r=>[r.name,euro(r.credit),euro(r.debit),euro(r.net),r.count]))}`;
}

function renderControls(){
  const seasons = getSeasons(State.ops);
  const ops = filterBySeason(State.ops, State.selectedSeason);
  const c = findControls(ops);
  const blocks = [
    ['À classer', c.missingCategory], ['Sans saison', c.missingSeason], ['Sans date', c.missingDate], ['Montant zéro', c.zeroAmount],
    ['Charges sans justificatif', c.missingJustifCharges], ['Non pointées', c.unpointed], ['Prévisionnelles', c.previsional], ['Doublons probables', c.duplicates]
  ];
  return `${seasonPicker(seasons)}<div class="kpis">${blocks.slice(0,4).map(([l,rows])=>kpi(l, String(rows.length), rows.length?'amber':'green')).join('')}</div>
    ${blocks.map(([label, rows]) => `<div class="card"><h2>${label} · ${rows.length}</h2>${rows.slice(0,25).map(opRow).join('') || empty('Rien à signaler')}${rows.length>25?`<p class="note">${rows.length-25} ligne(s) supplémentaire(s).</p>`:''}</div>`).join('')}`;
}

function renderParams(){
  return `<div class="card"><h2>À propos</h2>
    <div class="adh-recap">
      <div class="adh-rc"><div class="lab">Application</div><div class="v">${APP_META.name}</div></div>
      <div class="adh-rc"><div class="lab">Version</div><div class="v">${APP_META.channel} ${APP_META.version}</div></div>
      <div class="adh-rc"><div class="lab">Source</div><div class="v">Supabase</div></div>
    </div>
    <p class="note">Les opérations ne sont plus embarquées dans le HTML. Elles sont lues et écrites dans Supabase avec RLS.</p>
  </div>
  <div class="card"><h2>Actions</h2>
    <div class="row"><button class="btn" data-action="sync">Synchroniser</button><button class="btn sec" data-action="export-json">Exporter JSON</button></div>
    <div class="row" style="margin-top:10px"><button class="btn sec" data-action="export-csv">Exporter CSV</button><button class="btn ghost" data-action="logout">Déconnexion</button></div>
  </div>`;
}

function seasonPicker(seasons){
  return `<div class="card" style="padding:12px"><label style="font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;display:block;margin-bottom:6px">Saison</label><select id="seasonSelect"><option value="">Toutes</option>${seasons.map(s=>opt(s, State.selectedSeason)).join('')}</select></div>`;
}

function kpi(label, value, color){ return `<div class="kpi"><div class="lab">${escapeHtml(label)}</div><div class="val" ${color?`style="color:var(--${color})"`:''}>${escapeHtml(value)}</div></div>`; }
function opt(value, selected){ return `<option value="${escapeHtml(value)}" ${value===selected?'selected':''}>${escapeHtml(value)}</option>`; }
function empty(text){ return `<div class="empty" style="padding:20px"><p>${escapeHtml(text)}</p></div>`; }

function opRow(op){
  const amount = Number(op.credit||0) - Number(op.debit||0);
  return `<div class="tx ${(!op.typeflux || !op.cat2)?'unclassified':''}" data-action="open-op" data-id="${op.id}">
    <div class="grow"><div class="lib">${escapeHtml(op.libelle || 'Sans libellé')}</div>
      <div class="meta"><span>${fmtDate(op.date)}</span><span class="pill ${op.cat1==='CA'?'ca':op.cat1==='CV'?'cv':op.cat1==='CF'?'cf':''}">${escapeHtml(op.typeflux||'—')}</span><span>${escapeHtml([op.cat1,op.cat2,op.cat3].filter(Boolean).join(' / ') || 'À classer')}</span>${op.adherent?`<span>👤 ${escapeHtml(op.adherent)}</span>`:''}${op.isPrev?'<span class="pill prev">Prévision</span>':''}</div>
    </div><div class="amt ${amount>=0?'pos':'neg'}">${euro(amount)}</div></div>`;
}

function reportTable(title, headers, rows){
  return `<div class="report-section"><h3>${title}</h3><div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,100).map(r=>`<tr>${r.map((c,i)=>`<td class="${i>=3?'num':''}">${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length>100?`<p class="note">Table limitée aux 100 premières lignes.</p>`:''}</div>`;
}

function openEditor(op = null){
  State.editing = op ? {...op} : { account:'CC', typeflux:'', cat1:'', cat2:'', cat3:'', compte:'', season: State.selectedSeason || seasonFromDate(todayIso()), nature:'', libelle:'', date: todayIso(), debit:0, credit:0, adherent:'', justif:'', comment:'', origStatus:'', isPrev:false, status:'', lettrage:'', pointage:'', manualOrder: State.ops.length + 1 };
  renderEditor();
  $('#drawerBg').classList.add('open');
}

function renderEditor(){
  const op = State.editing;
  const cat1s = REF.cat1ByType?.[op.typeflux] || [];
  const cat2s = REF.cat2?.[`${op.typeflux}||${op.cat1}`] || [];
  const cat3s = REF.cat3?.[`${op.typeflux}||${op.cat2}`] || [];
  $('#drawer').innerHTML = `<div class="drawer-head"><h2>${op.id?'Modifier':'Nouvelle opération'}</h2><button class="btn ghost sm" id="closeDrawer">Fermer</button></div>
    <form id="opForm">
      <div class="grid-2"><div class="field"><label>Date</label><input name="date" type="date" value="${escapeHtml(op.date)}"></div><div class="field"><label>Saison</label><input name="season" value="${escapeHtml(op.season)}"></div></div>
      <div class="field"><label>Libellé</label><input name="libelle" value="${escapeHtml(op.libelle)}" required></div>
      <div class="grid-3"><div class="field"><label>Débit</label><input name="debit" type="number" step="0.01" value="${op.debit}"></div><div class="field"><label>Crédit</label><input name="credit" type="number" step="0.01" value="${op.credit}"></div><div class="field"><label>Compte bancaire</label><input name="account" value="${escapeHtml(op.account)}"></div></div>
      <div class="grid-3"><div class="field"><label>Type</label><select name="typeflux"><option value=""></option>${REF.typeFlux.map(v=>opt(v, op.typeflux)).join('')}</select></div><div class="field"><label>Cat. 1</label><select name="cat1"><option value=""></option>${cat1s.map(v=>opt(v, op.cat1)).join('')}</select></div><div class="field"><label>Cat. 2</label><select name="cat2"><option value=""></option>${cat2s.map(v=>opt(v, op.cat2)).join('')}</select></div></div>
      <div class="grid-2"><div class="field"><label>Cat. 3</label><select name="cat3"><option value=""></option>${cat3s.map(v=>opt(v, op.cat3)).join('')}</select></div><div class="field"><label>Compte comptable</label><input name="compte" value="${escapeHtml(op.compte)}"></div></div>
      <div class="grid-2"><div class="field"><label>Adhérent</label><input name="adherent" list="adhList" value="${escapeHtml(op.adherent)}"></div><div class="field"><label>Nature</label><select name="nature"><option value=""></option>${REF.natures.map(v=>opt(v, op.nature)).join('')}</select></div></div>
      <div class="grid-2"><div class="field"><label>Justificatif</label><input name="justif" value="${escapeHtml(op.justif)}"></div><div class="field"><label>Lettrage</label><input name="lettrage" value="${escapeHtml(op.lettrage)}"></div></div>
      <div class="grid-2"><div class="field"><label>Pointage</label><input name="pointage" value="${escapeHtml(op.pointage)}"></div><div class="field check-row" style="padding-top:26px"><input id="isPrev" name="isPrev" type="checkbox" ${op.isPrev?'checked':''}><label for="isPrev">Prévisionnelle</label></div></div>
      <div class="field"><label>Commentaire</label><textarea name="comment" rows="3">${escapeHtml(op.comment)}</textarea></div>
      <datalist id="adhList">${REF.adherents.map(a=>`<option value="${escapeHtml(a)}"></option>`).join('')}</datalist>
      <div class="row"><button class="btn" type="submit">Enregistrer</button>${op.id?'<button class="btn ghost danger" type="button" id="deleteOp">Supprimer</button>':''}</div>
    </form>`;
  $('#closeDrawer').onclick = closeEditor;
  $('#opForm').addEventListener('change', e => {
    if(['typeflux','cat1','cat2','cat3'].includes(e.target.name)){
      readEditorForm();
      const key = `${State.editing.typeflux}||${State.editing.cat1}||${State.editing.cat2}`;
      State.editing.compte = COMPTE_BY_KEY[key] || State.editing.compte || '';
      renderEditor();
    }
  });
  $('#opForm').addEventListener('submit', saveEditor);
  const del = $('#deleteOp'); if(del) del.onclick = deleteCurrentOp;
}

function readEditorForm(){
  const f = new FormData($('#opForm'));
  Object.assign(State.editing, {
    date: f.get('date') || '', season: f.get('season') || '', libelle: f.get('libelle') || '',
    debit: Number(f.get('debit') || 0), credit: Number(f.get('credit') || 0), account: f.get('account') || 'CC',
    typeflux: f.get('typeflux') || '', cat1: f.get('cat1') || '', cat2: f.get('cat2') || '', cat3: f.get('cat3') || '', compte: f.get('compte') || '',
    adherent: f.get('adherent') || '', nature: f.get('nature') || '', justif: f.get('justif') || '', lettrage: f.get('lettrage') || '', pointage: f.get('pointage') || '',
    isPrev: f.get('isPrev') === 'on', comment: f.get('comment') || ''
  });
}

async function saveEditor(e){
  e.preventDefault();
  readEditorForm();
  try{
    const saved = await upsertOperation(State.editing);
    const idx = State.ops.findIndex(o => o.id === saved.id);
    if(idx >= 0) State.ops[idx] = saved; else State.ops.unshift(saved);
    closeEditor(); renderApp(); toast('Opération enregistrée');
  }catch(err){ toast(err.message || 'Erreur enregistrement'); }
}

async function deleteCurrentOp(){
  if(!State.editing?.id) return;
  if(!confirm('Supprimer cette opération ?')) return;
  try{
    await deleteOperation(State.editing.id);
    State.ops = State.ops.filter(o => o.id !== State.editing.id);
    closeEditor(); renderApp(); toast('Opération supprimée');
  }catch(err){ toast(err.message || 'Erreur suppression'); }
}

function closeEditor(){ $('#drawerBg').classList.remove('open'); State.editing = null; }

function exportJson(){
  downloadJson(`scuborga_operations_${todayIso()}.json`, { app: APP_META.name, version: APP_META.version, exportedAt: new Date().toISOString(), operations: State.ops });
}

function exportCsv(){
  const header = ['legacy_id','account','date','season','typeflux','cat1','cat2','cat3','libelle','debit','credit','adherent','nature','justif','lettrage','pointage','is_prev'];
  const rows = State.ops.map(o => [o.legacyId,o.account,o.date,o.season,o.typeflux,o.cat1,o.cat2,o.cat3,o.libelle,o.debit,o.credit,o.adherent,o.nature,o.justif,o.lettrage,o.pointage,o.isPrev]);
  downloadCsv(`scuborga_operations_${todayIso()}.csv`, [header, ...rows]);
}

function titleForView(view){ return ({dash:'Accueil', ops:'Opérations', report:'Bilans', controls:'Contrôles', param:'Paramètres'})[view] || 'Scuborga'; }

function updateHeaderSync(text, cls=''){
  const dot = $('#syncDot'), label = $('#syncText');
  if(dot){ dot.className = `sync-dot ${cls}`; }
  if(label) label.textContent = text;
}

function toast(msg){
  const t = $('#toast'); if(!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2300);
}
