import * as E from './engine.js';
import { firebaseConfig } from './firebase-config.js';

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('dl_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dl_' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem('dl_' + k); } catch (e) { /* storage blocked */ } },
};
const params = new URLSearchParams(location.search);
const EMU = params.get('emu'); // ?emu=127.0.0.1 runs against the local Firebase emulators (testing only)
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function loading(on, msg = 'Connecting') { $('#loading').hidden = !on; $('#loading-msg').textContent = msg; }
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const C = E.CARDS;
const COL = E.COLORS;
const M = E.money;
const PCOL = ['#f2c14e', '#ff7a6b', '#6bd3ff', '#9b8cff', '#7be08f'];
const LIGHT = new Set(['yl', 'lb', 'ut']);
const ICON = { takeover: '🏴', no: '✋', grab: '🫳', swap: '🔁', vasooli: '💰', birthday: '🎂', payday: '💸', house: '🏠', hotel: '🏨', double: '✖️2' };
const MONEY_BG = { 1: '#efe6c8', 2: '#f6d9c6', 3: '#dcefd5', 4: '#d5e6f5', 5: '#e8d8f3', 10: '#f7e3a3' };

// ---------- practice: the whole game runs in this browser ----------
class LocalServer {
  constructor(name, bots) {
    this.mode = 'local';
    this.uid = 'me';
    this.code = 'PRACTICE';
    this.st = E.createTable('PRACTICE', 'me', name);
    for (let i = 0; i < bots; i++) E.dispatch(this.st, 'me', { type: 'addBot' }, Date.now());
    this.timer = setInterval(() => {
      let acted = false;
      try { acted = E.runBots(this.st, Date.now()); } catch (e) { console.error(e); }
      if (acted) this.emit();
    }, 150);
  }
  watch(cb) { this.cb = cb; this.emit(); }
  emit() { this.st.now = Date.now(); lastOk = Date.now(); if (this.cb) this.cb(E.viewFor(this.st, this.uid)); }
  async act(a) {
    const snap = structuredClone(this.st);
    try { E.dispatch(this.st, this.uid, a, Date.now()); } catch (e) { this.st = snap; throw e; }
    this.emit();
  }
  stop() { clearInterval(this.timer); }
}

// ---------- online: the Firebase function deals and checks every move. This browser only gets its own hand. ----------
let fb = null;
async function firebase() {
  if (fb) return fb;
  if (!firebaseConfig) throw new Error('Online play is not set up yet. Add your Firebase config (see README).');
  const base = new URL('./p2p/', import.meta.url).href; // online play runs host-to-player now, see p2p/core.js
  const [appM, authM, fsM, fnM] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-functions.js'].map((f) => import(base + f)));
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  if (EMU) authM.connectAuthEmulator(auth, `http://${EMU}:9099`, { disableWarnings: true });
  await auth.authStateReady();
  if (!auth.currentUser) await authM.signInAnonymously(auth);
  const db = fsM.initializeFirestore(app, { experimentalForceLongPolling: true });
  if (EMU) fsM.connectFirestoreEmulator(db, EMU, 8080);
  const fns = fnM.getFunctions(app);
  if (EMU) fnM.connectFunctionsEmulator(fns, EMU, 5001);
  const call = fnM.httpsCallable(fns, 'dl', { timeout: 15000 });
  const uid = auth.currentUser.uid;
  const viewRef = (id) => fsM.doc(db, 'dltables', id, 'views', uid);
  const readView = (s) => (s.exists() ? JSON.parse(s.data().json) : null);
  fb = {
    uid,
    call: async (data) => {
      const sent = Date.now();
      try {
        const r = (await call(data)).data;
        if (r && r.view && r.view.serverNow) offset = r.view.serverNow - (sent + Date.now()) / 2;
        lastOk = Date.now();
        return r;
      } catch (e) { throw new Error(e.message || 'Request failed'); }
    },
    watch: (id, cb) => fsM.onSnapshot(viewRef(id), (s) => { lastOk = Date.now(); const v = readView(s); if (v) cb(v); }, () => { /* the poll covers it */ }),
    get: async (id) => { const s = await fsM.getDocFromServer(viewRef(id)); lastOk = Date.now(); return readView(s); },
    ping: (id) => fsM.setDoc(fsM.doc(db, 'dltables', id, 'presence', uid), { at: fsM.serverTimestamp() }),
    watchPresence: (id, cb) => fsM.onSnapshot(fsM.collection(db, 'dltables', id, 'presence'), (qs) => {
      const out = {};
      qs.forEach((d) => { const at = d.data({ serverTimestamps: 'estimate' }).at; out[d.id] = at && at.toMillis ? at.toMillis() : 0; });
      cb(out);
    }, () => {}),
  };
  return fb;
}
const computer = (p) => p && (p.bot || p.auto);
const P = (v, uid) => v.players.find((x) => x.uid === uid);
// Mirrors runBots: is a computer move due that the server should make?
function serverDue(v) {
  if (v.phase !== 'play' || srvNow() < v.botAt) return false;
  if (v.pending) return computer(P(v, v.pending.actor));
  return computer(P(v, v.turn));
}
class CloudServer {
  constructor(api, code) { this.mode = 'cloud'; this.api = api; this.code = code; this.uid = api.uid; this.ticking = false; }
  watch(cb) {
    this.cb = cb;
    this.unsub = this.api.watch(this.code, cb);
    this.unsubP = this.api.watchPresence(this.code, (p) => { presence = p; render(); });
    this.poll = setInterval(() => this.refresh(), 3000);
    this.tickTimer = setInterval(() => this.tick(), 500);
    this.pingTimer = setInterval(() => this.ping(), 25000);
    this.ping();
    this.onWake = () => { if (document.visibilityState === 'visible') { this.relisten(); this.ping(); } };
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('online', this.onWake);
  }
  ping() { this.api.ping(this.code).catch(() => {}); }
  relisten() {
    if (this.unsub) this.unsub();
    this.unsub = this.api.watch(this.code, this.cb);
    this.refresh();
  }
  async refresh() { try { const v = await this.api.get(this.code); if (v) this.cb(v); } catch (e) { /* next poll */ } }
  // Computer players and autopilot seats move when one browser nudges the server: the first connected human in seat order.
  async tick() {
    const v = view;
    if (this.ticking || !v || !serverDue(v)) return;
    const nudger = v.players.find((x) => !x.bot && !x.auto && !x.left && isOnline(x.uid)) || P(v, this.uid);
    if (!nudger || nudger.uid !== this.uid) return;
    this.ticking = true;
    try { const r = await this.api.call({ op: 'tick', tableId: this.code }); if (r && r.view) this.cb(r.view); } catch (e) { /* ignore */ }
    setTimeout(() => { this.ticking = false; }, 400);
  }
  async act(a) {
    const r = await withTimeout(this.api.call({ op: 'act', tableId: this.code, action: { ...a, rid: rid(), move: view ? view.moveNo : undefined } }), 12000);
    if (r && r.view) this.cb(r.view);
    if (r && r.ok === false) throw new Error(r.error || 'Try again.');
  }
  stop() {
    if (this.unsub) this.unsub();
    if (this.unsubP) this.unsubP();
    clearInterval(this.poll); clearInterval(this.tickTimer); clearInterval(this.pingTimer);
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('online', this.onWake);
  }
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('That took too long. Check your connection and try again.')), ms))]);
}

// ---------- app state ----------
let server = null;
let view = null;
let offset = 0;
let lastOk = Date.now();
let presence = {};
const srvNow = () => Date.now() + offset;
const AWAY = 70000;
const isOnline = (uid) => !server || server.mode === 'local' || (presence[uid] && srvNow() - presence[uid] < AWAY);
// flow: the card being played and the choices made so far. paySel: cards picked to pay with.
const ui = { busy: false, sheet: null, flow: null, paySel: [], discSel: [], pendKey: '', overSeen: '', playedN: null };

function onView(v) {
  if (!v || !Array.isArray(v.players)) return;
  if (view && v.id === view.id && v.seq < view.seq) return; // older than what we have
  view = v;
  // A card played or turn changed under an open play sheet: drop stale choices.
  if (ui.flow && !v.hand.includes(ui.flow.card) && ui.flow.kind !== 'move') { ui.flow = null; if (ui.sheet === 'play') closeSheet(); }
  ui.discSel = ui.discSel.filter((id) => v.hand.includes(id));
  render();
}

async function act(a) {
  if (!server || ui.busy) return false;
  ui.busy = true;
  render();
  try { await server.act(a); return true; }
  catch (e) { toast(e.message); return false; }
  finally { ui.busy = false; render(); }
}

// ---------- home ----------
const nameInput = $('#name');
nameInput.value = store.get('name', '');
const getName = () => {
  const n = nameInput.value.trim();
  if (!n) { nameInput.focus(); toast('Put your name in first.'); return null; }
  store.set('name', n);
  return n;
};
if (!firebaseConfig) {
  $('#online-note').hidden = false;
  $('#online-note').textContent = 'Online tables need the one-time Firebase setup in the README. Practice works now.';
}
if (params.get('t')) {
  $('#code').value = params.get('t').toUpperCase();
  $('#join').classList.add('primary');
  if (!nameInput.value) setTimeout(() => nameInput.focus(), 50);
}
$('#create').onclick = async () => {
  const name = getName(); if (!name) return;
  loading(true, 'Making your table');
  try {
    const api = await firebase();
    const r = await api.call({ op: 'create', name });
    enterCloud(api, r.tableId, r.view);
  } catch (e) { toast(e.message); }
  finally { loading(false); }
};
async function joinCode(code, quiet) {
  const name = quiet ? (store.get('name', '') || getName()) : getName(); if (!name) return;
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) { toast('Type the table code.'); return; }
  loading(true, quiet ? 'Getting back to your table' : 'Joining');
  try {
    const api = await firebase();
    const r = await api.call({ op: 'join', tableId: code, name });
    enterCloud(api, r.tableId, r.view);
  } catch (e) {
    toast(e.message, 4500);
    if (quiet) store.del('table');
    clearUrl();
  } finally { loading(false); }
}
$('#join').onclick = () => joinCode($('#code').value);
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCode($('#code').value); });
$('#practice').onclick = () => {
  const name = getName(); if (!name) return;
  leaveServer();
  server = new LocalServer(name, Number($('#bots').value));
  server.watch(onView);
};
function enterCloud(api, code, v) {
  leaveServer();
  server = new CloudServer(api, code);
  store.set('table', code);
  const u = new URL(location.href); u.searchParams.set('t', code); history.replaceState(null, '', u);
  onView(v);
  server.watch(onView);
}
function clearUrl() { const u = new URL(location.href); u.searchParams.delete('t'); history.replaceState(null, '', u); }
function leaveServer() {
  if (server) server.stop();
  server = null; view = null; presence = {};
  ui.flow = null; ui.paySel = []; ui.discSel = []; ui.pendKey = ''; ui.overSeen = '';
  closeSheet();
}
function goHome() { leaveServer(); store.del('table'); clearUrl(); render(); }
async function leaveTable() {
  if (!server) return goHome();
  if (server.mode === 'cloud') {
    const midGame = view && view.phase === 'play';
    if (midGame && !confirm('Leave the game? The computer will play your seat. You can come back with the same link.')) return;
    try { await server.act({ type: 'leave' }); } catch (e) { /* leaving anyway */ }
  }
  goHome();
}
async function copyInvite() {
  const u = new URL(location.href);
  u.search = ''; u.searchParams.set('t', server.code);
  if (EMU) u.searchParams.set('emu', EMU);
  const link = u.toString();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Business Deal', text: `Join my Business Deal table: ${server.code}`, url: link }); return; } catch (e) { /* fall through to copy */ }
  }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); }
  catch (e) { prompt('Copy this link:', link); }
}

// ---------- render ----------
function show(id) { for (const s of ['home', 'lobby', 'table']) $('#' + s).hidden = s !== id; }
function render() {
  if (!server || !view) { show('home'); $('#recon').hidden = true; return; }
  if (view.phase === 'lobby') { show('lobby'); renderLobby(view); } else { show('table'); renderTable(view); }
  autoSheets(view);
  if (ui.sheet && ui.sheet !== 'rules' && ui.sheet !== 'menu') renderSheet();
  renderRecon();
}
function renderRecon() {
  const cloud = server && server.mode === 'cloud';
  const gone = cloud && (!navigator.onLine || Date.now() - lastOk > 10000);
  $('#recon').hidden = !gone;
  $('#recon-reload').hidden = !(gone && Date.now() - lastOk > 25000);
  $('#recon-msg').textContent = !navigator.onLine ? 'Your phone is offline. Your seat is saved.' : 'Lost the connection for a moment. Your seat is saved.';
}
setInterval(() => { if (server) renderRecon(); }, 1000);
window.addEventListener('offline', () => renderRecon());
$('#recon-reload').onclick = () => location.reload();

const colorOf = (v, uid) => PCOL[Math.max(0, v.players.findIndex((p) => p.uid === uid)) % PCOL.length];
const nameOf = (v, uid) => { const p = P(v, uid); return p ? (p.uid === v.me ? 'You' : p.name) : '?'; };
const tokenHTML = (v, uid) => `<span class="token" style="background:${colorOf(v, uid)}"></span>`;

// ---------- lobby ----------
function renderLobby(v) {
  const host = v.hostUid === v.me;
  const local = server.mode === 'local';
  $('#lobby-code').textContent = local ? 'Practice' : v.id;
  $('#code-panel').hidden = local;
  $('#lobby-count').textContent = `${v.players.length} of ${E.MAX_PLAYERS}`;
  $('#lobby-players').innerHTML = v.players.map((p) => {
    const tags = [p.uid === v.hostUid ? '<span class="pill host">Host</span>' : '', p.uid === v.me ? '<span class="pill you">You</span>' : '', p.bot ? '<span class="pill">Computer</span>' : ''].join('');
    const online = p.bot || isOnline(p.uid);
    const rm = host && p.uid !== v.me ? `<button class="x" data-remove="${esc(p.uid)}" aria-label="Remove ${esc(p.name)}">&times;</button>` : '';
    return `<li><span class="dot ${online ? '' : 'off'}" title="${online ? 'Connected' : 'Not connected'}"></span><span class="pname">${esc(p.name)}</span>${tags}${rm}</li>`;
  }).join('');
  $('#host-tools').hidden = !host;
  $('#add-bot').disabled = v.players.length >= E.MAX_PLAYERS || ui.busy;
  const start = $('#start');
  start.hidden = !host;
  start.disabled = v.players.length < E.MIN_PLAYERS || ui.busy;
  start.textContent = v.players.length < E.MIN_PLAYERS ? 'Need 1 more player' : `Start the game (${v.players.length} players)`;
  $('#lobby-wait').textContent = host ? (local ? '' : 'Waiting for friends? Share the link. Computer players fill empty seats.') : 'Waiting for the host to start.';
  const s = v.settings;
  if (!host) {
    $('#settings').innerHTML = `<ul class="set-read"><li>First to ${s.setsToWin} full sets of different colours wins</li><li>${s.playsPerTurn} plays per turn</li></ul>`;
    return;
  }
  const seg = (key, opts) => `<div class="seg">${opts.map(([k, l]) => `<button type="button" data-set="${key}" data-val="${k}" class="${String(s[key]) === String(k) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  $('#settings').innerHTML = `<div class="set-grid">
    <div class="set-row"><span class="lbl">Sets to win<small>Full sets of different colours</small></span>${seg('setsToWin', [[2, '2'], [3, '3'], [4, '4']])}</div>
    <div class="set-row"><span class="lbl">Plays per turn<small>Classic is 3</small></span>${seg('playsPerTurn', [[3, '3'], [4, '4']])}</div>
  </div>`;
}
$('#settings').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-set]');
  if (b) act({ type: 'settings', settings: { [b.dataset.set]: Number(b.dataset.val) } });
});
$('#lobby-players').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (b) act({ type: 'remove', uid: b.dataset.remove });
});
$('#add-bot').onclick = () => act({ type: 'addBot' });
$('#start').onclick = () => act({ type: 'start' });
$('#copy-link').onclick = copyInvite;
$('#lobby-leave').onclick = leaveTable;

// ---------- cards ----------
function cardHTML(id, o = {}) {
  const c = C[id];
  const size = o.size ? ' ' + o.size : '';
  const cls = `card${size}${o.sel ? ' sel' : ''}${o.dim ? ' dim' : ''}`;
  const data = o.attr || `data-card="${id}"`;
  const val = c.v ? `<span class="val">${c.v}</span>` : '';
  const label = `${c.name}${c.v ? `, worth ${M(c.v)}` : ''}`;
  if (c.kind === 'money') {
    return `<div class="${cls} money" ${data} style="--m:${MONEY_BG[c.v]}" role="img" aria-label="${esc(label)}">${val}<div class="big">₹${c.v}M</div></div>`;
  }
  if (c.kind === 'prop') {
    const k = COL[c.c];
    const rents = k.rent.map((r, i) => `<div><span>${i + 1 === k.size ? 'Full' : i + 1}</span><span>${r}M</span></div>`).join('');
    return `<div class="${cls}" ${data} role="img" aria-label="${esc(label + ', ' + k.name)}">${val}<div class="band ${LIGHT.has(c.c) ? 'lt' : ''}" style="--c:${k.hex}"><span class="nm">${esc(c.name)}</span></div><div class="rents">${rents}</div>${o.bld || ''}</div>`;
  }
  if (c.kind === 'wild') {
    const any = c.cs === 'any';
    const band = any ? '<div class="band rainbow"><span class="nm">Any colour</span></div>' : `<div class="band split" style="--c:${COL[c.cs[0]].hex};--c2:${COL[c.cs[1]].hex}"><span class="nm">Wild</span></div>`;
    const tx = any ? 'Use as any colour. Worth nothing.' : `${COL[c.cs[0]].name} or ${COL[c.cs[1]].name}`;
    const where = o.as ? `<div class="tx"><b>as ${COL[o.as].name}</b></div>` : '';
    return `<div class="${cls}" ${data} role="img" aria-label="${esc('Wild property: ' + tx)}">${val}${band}<div class="tx" style="margin-top:auto">${tx}</div>${where}${o.bld || ''}</div>`;
  }
  if (c.kind === 'rent') {
    const any = c.cs === 'any';
    const ring = any ? '<div class="ring rainbow"><b>₹</b></div>' : `<div class="ring" style="--c:${COL[c.cs[0]].hex};--c2:${COL[c.cs[1]].hex}"><b>₹</b></div>`;
    const tx = any ? 'Charge one player rent on any colour' : `Everyone pays rent on ${COL[c.cs[0]].name} or ${COL[c.cs[1]].name}`;
    return `<div class="${cls} rent" ${data} role="img" aria-label="${esc(c.name + ': ' + tx)}">${val}${ring}<div class="nm">${esc(c.name)}</div><div class="tx">${tx}</div></div>`;
  }
  const a = E.ACTIONS[c.a];
  return `<div class="${cls} action" ${data} role="img" aria-label="${esc(a.name + ': ' + a.text)}">${val}<div class="ic">${ICON[c.a]}</div><div class="nm">${esc(a.name)}</div><div class="tx">${esc(a.text)}</div></div>`;
}
const back = (n) => `<div class="pile">${n > 1 ? '<div class="cardback b2"></div>' : ''}<div class="cardback">₹</div><small>${n} left</small></div>`;

// A player's property stacks, as overlapped cards.
function stacksHTML(p, o = {}) {
  const cols = Object.keys(p.table || {}).sort((a, b) => E.COLOR_KEYS.indexOf(a) - E.COLOR_KEYS.indexOf(b));
  if (!cols.length) return `<div class="empty">${o.empty || 'No properties yet.'}</div>`;
  const w = o.small ? 64 : 70;
  const step = o.small ? 20 : 22;
  return cols.map((c) => {
    const ids = p.table[c];
    const k = COL[c];
    const full = ids.length >= k.size && ids.some((id) => C[id].cs !== 'any');
    const b = (p.bld || {})[c] || {};
    const bIds = [b.house, b.hotel].filter((x) => x != null);
    const all = ids.map((id) => ({ id, as: C[id].kind === 'wild' ? c : null })).concat(bIds.map((id) => ({ id })));
    const h = Math.round(w * 1.42) + step * (all.length - 1) + 16;
    const cards = all.map((x, i) => `<div style="top:${i * step}px;z-index:${i}">${cardHTML(x.id, { size: 'sm', as: x.as, attr: o.pick ? `data-pick="${x.id}"` : `data-tcard="${x.id}" data-col="${c}"`, dim: o.dimFull && full, sel: o.sel && o.sel.includes(x.id) })}</div>`).join('');
    return `<div class="stack ${full ? 'full' : ''}" style="height:${h}px;width:${w}px">${cards}<span class="lbl">${Math.min(ids.length, k.size)}/${k.size}</span></div>`;
  }).join('');
}
function chipsHTML(p) {
  const cols = Object.keys(p.table || {}).sort((a, b) => E.COLOR_KEYS.indexOf(a) - E.COLOR_KEYS.indexOf(b));
  return cols.map((c) => {
    const n = p.table[c].length, k = COL[c];
    const b = (p.bld || {})[c] || {};
    const full = n >= k.size;
    return `<span class="chipc ${LIGHT.has(c) ? 'lt' : ''} ${full ? 'full' : ''}" style="--c:${k.hex}" title="${k.name}">${Math.min(n, k.size)}/${k.size}${b.house != null ? '🏠' : ''}${b.hotel != null ? '🏨' : ''}</span>`;
  }).join('');
}
const bankSum = (p) => (p.bank || []).reduce((s, id) => s + C[id].v, 0);

// ---------- the table ----------
function renderTable(v) {
  const me = P(v, v.me);
  const myTurn = v.phase === 'play' && v.turn === v.me;
  const turnP = P(v, v.turn);
  const left = v.settings.playsPerTurn - v.plays;
  $('#bar-sub').textContent = v.phase === 'over' ? 'Game over' : myTurn ? `Your turn · ${left} play${left === 1 ? '' : 's'} left` : `${turnP ? turnP.name : ''}'s turn${server.mode === 'local' ? ' · Practice' : ''}`;

  // Opponents
  $('#opps').innerHTML = v.players.filter((p) => p.uid !== v.me).map((p) => {
    const away = !p.bot && !isOnline(p.uid);
    const pend = v.pending && (v.pending.target === p.uid || v.pending.queue.includes(p.uid));
    return `<button class="opp ${p.uid === v.turn ? 'turn' : ''} ${pend ? 'target' : ''}" data-opp="${esc(p.uid)}" type="button">
      <div class="opp-top">${tokenHTML(v, p.uid)}<b>${esc(p.name)}</b>${p.bot ? '<small>🤖</small>' : p.auto ? '<small>🤖</small>' : away ? '<span class="away">away</span>' : ''}</div>
      <div class="opp-stats"><span>💰 ${M(bankSum(p))}</span><span>🂠 ${p.cards}</span><span>★ ${p.sets}/${v.settings.setsToWin}</span></div>
      <div class="stacks">${chipsHTML(p)}</div>
    </button>`;
  }).join('');

  // Middle: deck, last card played, what's happening
  const pl = v.played;
  const playedCard = pl ? `<div class="played" ${ui.playedN !== pl.n ? '' : 'style="animation:none"'}>${cardHTML(pl.id, { attr: 'data-show="' + pl.id + '"' })}</div>` : '';
  ui.playedN = pl ? pl.n : null;
  let msg = '', sub = '';
  if (v.phase === 'over') { msg = `${nameOf(v, v.winner)} won!`; sub = `${v.settings.setsToWin} full sets.`; }
  else if (v.pending) {
    const pd = v.pending;
    msg = pendingText(v, pd);
    sub = pd.actor === v.me ? 'Your move.' : `Waiting for ${nameOf(v, pd.actor)}.`;
  } else if (myTurn) {
    msg = left > 0 ? 'Tap a card in your hand to play it.' : 'No plays left. End your turn.';
    sub = pl && pl.by !== v.me ? '' : '';
  } else msg = `${turnP.name} is playing.`;
  const last = v.log[v.log.length - 1] || '';
  const slots = v.phase === 'play' ? `<div class="playslots" aria-label="${left} plays left">${Array.from({ length: v.settings.playsPerTurn }, (_, i) => `<i class="${i < v.plays ? 'used' : ''}"></i>`).join('')}</div>` : '';
  $('#middle').innerHTML = `${back(v.deckCount)}${playedCard}<div class="mid-info">${slots}<div class="msg">${esc(msg)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}<div class="sub">${esc(last)}</div></div>`;

  // Me
  $('#mine-head').innerHTML = `${tokenHTML(v, v.me)}<span class="me">${esc(me.name)}</span>
    <button class="bankbox" data-open="bank" type="button"><span class="coin">₹</span>${M(bankSum(me))} in bank</button>
    <span class="setcount">★ ${me.sets}/${v.settings.setsToWin} sets</span>`;
  $('#mytable').innerHTML = stacksHTML(me, { empty: 'Your properties go here.' });

  // Hand
  const canPlay = myTurn && !v.pending && !ui.busy;
  $('#hand').className = 'hand' + (canPlay ? '' : ' idle');
  $('#hand').innerHTML = v.hand.slice().sort(handOrder).map((id) => cardHTML(id)).join('') || '<div class="empty" style="color:#8f9cc6">No cards.</div>';
  const over = v.hand.length - E.HAND_LIMIT;
  const endBtn = myTurn && !v.pending ? `<button class="btn ${left === 0 ? 'primary' : ''}" id="end" ${ui.busy ? 'disabled' : ''}>End turn${over > 0 ? ` (discard ${over})` : ''}</button>` : '';
  const hint = v.phase === 'over' ? '' : myTurn ? (v.pending ? 'Waiting on the others.' : `${v.hand.length} cards · ${left} play${left === 1 ? '' : 's'} left`) : `${v.hand.length} cards`;
  $('#hand-head').innerHTML = `<span class="hint">${hint}</span>${endBtn}${v.phase === 'over' ? `<button class="btn primary" data-open="over">See result</button>` : ''}`;
  const eb = $('#end');
  if (eb) eb.onclick = () => { if (over > 0) { ui.discSel = []; openSheet('discard'); } else act({ type: 'end' }); };
}
const ORDER = { prop: 0, wild: 1, action: 2, rent: 3, money: 4 };
function handOrder(a, b) {
  const x = C[a], y = C[b];
  return ORDER[x.kind] - ORDER[y.kind] || (x.c && y.c ? E.COLOR_KEYS.indexOf(x.c) - E.COLOR_KEYS.indexOf(y.c) : 0) || y.v - x.v || a - b;
}
function pendingText(v, pd) {
  const from = nameOf(v, pd.from), to = nameOf(v, pd.target);
  const owes = to === 'You' ? 'owe' : 'owes';
  if (pd.waiting === 'from') return `${to} said No Deal to ${from}.`;
  if (pd.kind === 'pay') return `${to} ${owes} ${from} ${M(pd.amount)}.`;
  if (pd.kind === 'grab') return `${from} wants to grab ${to === 'You' ? 'your' : to + "'s"} ${C[pd.prop].kind === 'prop' ? C[pd.prop].name : 'wild card'}.`;
  if (pd.kind === 'swap') return `${from} wants to swap with ${to}.`;
  if (pd.kind === 'takeover') return `${from} is taking ${to === 'You' ? 'your' : to + "'s"} ${COL[pd.color].name} set!`;
  return '';
}

// Clicks on the table
$('#hand').addEventListener('click', (e) => {
  const el = e.target.closest('[data-card]');
  if (!el || !view) return;
  const id = Number(el.dataset.card);
  const v = view;
  if (v.phase !== 'play' || v.turn !== v.me || v.pending) { ui.flow = { card: id, view: true }; openSheet('play'); return; }
  ui.flow = { card: id };
  openSheet('play');
});
$('#mytable').addEventListener('click', (e) => {
  const el = e.target.closest('[data-tcard]');
  if (!el || !view) return;
  const id = Number(el.dataset.tcard);
  ui.flow = { kind: 'move', card: id, from: el.dataset.col };
  openSheet('play');
});
$('#opps').addEventListener('click', (e) => {
  const el = e.target.closest('[data-opp]');
  if (el) openSheet('opp:' + el.dataset.opp);
});
$('#middle').addEventListener('click', (e) => {
  const el = e.target.closest('[data-show]');
  if (el) { ui.flow = { card: Number(el.dataset.show), view: true, shown: true }; openSheet('play'); }
});

// ---------- sheets ----------
function openSheet(name) { ui.sheet = name; renderSheet(); }
function closeSheet() {
  ui.sheet = null;
  $('#sheet').hidden = true;
  $('#scrim').hidden = true;
}
$('#scrim').onclick = () => { if (ui.sheet !== 'respond') closeSheet(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet && ui.sheet !== 'respond') closeSheet(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (b) { openSheet(b.dataset.open); return; }
  if (e.target.closest('[data-close]')) closeSheet();
});
function autoSheets(v) {
  if (v.phase === 'over' && ui.overSeen !== v.id + v.winner) { ui.overSeen = v.id + v.winner; openSheet('over'); return; }
  const pd = v.pending;
  const key = pd ? `${pd.card}-${pd.target}-${pd.waiting}-${pd.nos}` : '';
  if (pd && pd.actor === v.me) {
    if (ui.pendKey !== key) { ui.pendKey = key; ui.paySel = []; openSheet('respond'); }
  } else if (ui.sheet === 'respond') closeSheet();
}
const head = (title, closable = true) => `<div class="sheet-head"><h2>${title}</h2>${closable ? '<button class="close" data-close aria-label="Close">&times;</button>' : ''}</div>`;
function renderSheet() {
  if (!ui.sheet) return;
  const [kind, arg] = ui.sheet.split(':');
  const v = view;
  let html = '';
  if (kind === 'rules') html = rulesHTML();
  else if (!v) { closeSheet(); return; }
  else if (kind === 'menu') html = menuHTML(v);
  else if (kind === 'play') html = playHTML(v);
  else if (kind === 'respond') html = respondHTML(v);
  else if (kind === 'discard') html = discardHTML(v);
  else if (kind === 'opp') html = oppHTML(v, arg);
  else if (kind === 'bank') html = bankHTML(v);
  else if (kind === 'log') html = `${head('What happened')}<ol class="logl">${v.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  else if (kind === 'over') html = overHTML(v);
  if (!html) { closeSheet(); return; }
  const body = $('#sheet-body');
  const scroll = $('#sheet').scrollTop;
  body.innerHTML = html;
  $('#sheet').hidden = false;
  $('#scrim').hidden = false;
  $('#sheet').scrollTop = scroll;
}

// Playing a card: a small wizard. ui.flow holds the card and choices so far.
function playHTML(v) {
  const f = ui.flow;
  if (!f) return '';
  const c = C[f.card];
  const myTurn = v.phase === 'play' && v.turn === v.me && !v.pending;
  const left = v.settings.playsPerTurn - v.plays;
  const others = v.players.filter((p) => p.uid !== v.me);
  const me = P(v, v.me);
  const about = c.kind === 'action' ? E.ACTIONS[c.a].text : c.kind === 'money' ? 'Money. Goes in your bank.' : c.kind === 'rent' ? (c.cs === 'any' ? 'Pick a colour you own and one player pays that rent.' : `Every other player pays rent on your ${COL[c.cs[0]].name} or ${COL[c.cs[1]].name}.`) : c.kind === 'prop' ? `${COL[c.c].name}. ${COL[c.c].size} make a full set.` : (c.cs === 'any' ? 'Can be any colour. Worth nothing as payment.' : `${COL[c.cs[0]].name} or ${COL[c.cs[1]].name} property.`);
  const top = `<div class="cardrow">${cardHTML(f.card, { size: 'lg', attr: '' })}<div class="about"><p>${esc(about)}</p>${c.v ? `<p class="muted">Worth ${M(c.v)} as money.</p>` : ''}</div></div>`;

  if (f.kind === 'move') {
    // A card already on my table: wilds can be moved on my turn.
    if (c.kind !== 'wild' || !myTurn) return `${head(c.kind === 'wild' ? 'Wild card' : esc(c.name))}${top}${c.kind === 'wild' ? '<p class="muted">You can move wild cards between colours on your turn.</p>' : ''}`;
    const cols = E.colorsOf(c).filter((k) => k !== f.from);
    return `${head('Move this wild')}${top}<div class="choices">${cols.map((k) => `<button class="choice" data-f="moveTo" data-v="${k}"><span class="sw" style="--c:${COL[k].hex}"></span>${COL[k].name}<small>${stackCount(me, k)}/${COL[k].size}</small></button>`).join('')}</div><p class="muted">Moving is free, it doesn't use a play.</p>`;
  }
  if (f.view || !myTurn) return `${head(esc(c.kind === 'action' ? E.ACTIONS[c.a].name : c.name))}${top}${!f.shown && v.phase === 'play' ? `<p class="muted">${v.turn === v.me ? 'Answer what\'s waiting first.' : 'Wait for your turn to play it.'}</p>` : ''}`;
  if (left <= 0) return `${head('No plays left')}${top}<p>You've used all ${v.settings.playsPerTurn} plays. End your turn.</p>`;

  const bankBtn = c.kind !== 'prop' && c.kind !== 'wild' ? `<button class="btn" data-f="bank">${c.kind === 'money' ? `Bank ${M(c.v)}` : `Bank it as ${M(c.v)}`}</button>` : '';
  const choose = (title, items) => `<h3>${title}</h3><div class="choices">${items}</div>`;
  const playerBtns = (key, ok = () => true, extra = () => '') => others.map((p) => `<button class="choice ${f[key] === p.uid ? 'on' : ''}" data-f="${key}" data-v="${esc(p.uid)}" ${ok(p) ? '' : 'disabled style="opacity:.45"'}>${tokenHTML(v, p.uid)}${esc(p.name)}<small>${extra(p)}</small></button>`).join('');
  const go = (label, ready) => `<button class="btn primary big" data-f="go" ${ready && !ui.busy ? '' : 'disabled'}>${label}</button>`;

  if (c.kind === 'money') return `${head('Money')}${top}<button class="btn primary big" data-f="bank">Bank ${M(c.v)}</button>`;
  if (c.kind === 'prop') return `${head(esc(c.name))}${top}<button class="btn primary big" data-f="prop" data-v="${c.c}">Put on the table</button>`;
  if (c.kind === 'wild') {
    return `${head('Wild property')}${top}${choose('Play it as', E.colorsOf(c).map((k) => `<button class="choice" data-f="prop" data-v="${k}"><span class="sw" style="--c:${COL[k].hex}"></span>${COL[k].name}<small>you have ${stackCount(me, k)}/${COL[k].size}</small></button>`).join(''))}`;
  }
  if (c.kind === 'rent') {
    const cs = (c.cs === 'any' ? E.COLOR_KEYS : c.cs).filter((k) => stackCount(me, k) > 0);
    const doubles = v.hand.filter((id) => C[id].a === 'double');
    const nD = (f.doubles || []).length;
    const amt = f.color ? rentOf(me, f.color) * 2 ** nD : 0;
    const colsHTML = cs.length ? cs.map((k) => `<button class="choice ${f.color === k ? 'on' : ''}" data-f="color" data-v="${k}"><span class="sw" style="--c:${COL[k].hex}"></span>${COL[k].name}<small>${M(rentOf(me, k))}</small></button>`).join('') : '<p class="muted">You have no property in these colours yet. You can still bank it.</p>';
    const dbl = doubles.length && left > 1 ? `<h3>Double Rent</h3><div class="choices">${doubles.slice(0, Math.min(doubles.length, left - 1)).map((id, i) => `<button class="choice ${(f.doubles || []).includes(id) ? 'on' : ''}" data-f="double" data-v="${id}">✖️2 Use Double Rent${i ? ' again' : ''}<small>+1 play</small></button>`).join('')}</div>` : '';
    const who = c.cs === 'any' ? choose('Who pays', playerBtns('target', () => true, (p) => `${M(bankSum(p))} in bank`)) : '';
    const ready = f.color && (c.cs !== 'any' || f.target);
    return `${head(c.cs === 'any' ? 'Wild Rent' : 'Rent')}${top}${cs.length ? choose('Charge rent on', colsHTML) : colsHTML}${who}${dbl}
      ${cs.length ? go(f.color ? `Charge ${M(amt)}${c.cs === 'any' ? '' : ' to everyone'}` : 'Pick a colour', ready) : ''}${bankBtn}`;
  }
  // Action cards
  const a = c.a;
  const nm = E.ACTIONS[a].name;
  if (a === 'no' || a === 'double') return `${head(nm)}${top}<p class="muted">${a === 'no' ? 'Keep it in your hand to block something played against you.' : 'Play it from a Rent card.'}</p>${bankBtn}`;
  if (a === 'payday' || a === 'birthday') return `${head(nm)}${top}${go(a === 'payday' ? 'Play: draw 2' : 'Play: everyone pays ₹2M', true)}${bankBtn}`;
  if (a === 'vasooli') return `${head(nm)}${top}${choose('Who pays ₹5M', playerBtns('target', () => true, (p) => `${M(bankSum(p))} in bank`))}${go('Collect ₹5M', f.target)}${bankBtn}`;
  if (a === 'house' || a === 'hotel') {
    const ok = Object.keys(me.table).filter((k) => COL[k].build && isFullP(me, k) && (a === 'house' ? (me.bld[k] || {}).house == null : (me.bld[k] || {}).house != null && (me.bld[k] || {}).hotel == null));
    return `${head(nm)}${top}${ok.length ? choose('Build on', ok.map((k) => `<button class="choice ${f.color === k ? 'on' : ''}" data-f="color" data-v="${k}"><span class="sw" style="--c:${COL[k].hex}"></span>${COL[k].name}<small>rent ${M(rentOf(me, k))} → ${M(rentOf(me, k) + (a === 'house' ? 3 : 4))}</small></button>`).join('')) + go(`Build the ${nm}`, f.color) : `<p class="muted">${a === 'house' ? 'You need a full set (not Railway or Utility) to build on.' : 'You need a full set with a House on it.'}</p>`}${bankBtn}`;
  }
  if (a === 'takeover') {
    const sets = [];
    for (const p of others) for (const k of Object.keys(p.table)) if (isFullP(p, k)) sets.push([p, k]);
    return `${head(nm)}${top}${sets.length ? choose('Take which set', sets.map(([p, k]) => `<button class="choice ${f.target === p.uid && f.color === k ? 'on' : ''}" data-f="set" data-v="${esc(p.uid)}|${k}"><span class="sw" style="--c:${COL[k].hex}"></span>${esc(p.name)}'s ${COL[k].name}<small>rent ${M(rentOf(p, k))}</small></button>`).join('')) + go('Take it', f.target && f.color) : '<p class="muted">Nobody has a full set yet.</p>'}${bankBtn}`;
  }
  if (a === 'grab' || a === 'swap') {
    const steps = [];
    if (a === 'swap') {
      const mineOk = Object.keys(me.table).filter((k) => !isFullP(me, k));
      steps.push(`<h3>Give one of yours</h3>${mineOk.length ? `<div class="mytable">${stacksHTML({ table: Object.fromEntries(mineOk.map((k) => [k, me.table[k]])), bld: {} }, { pick: true, small: true, sel: [f.mine] }).replaceAll('data-pick', 'data-pickmine')}</div>` : '<p class="muted">You need a property that is not in a full set.</p>'}`);
    }
    steps.push(choose(a === 'grab' ? 'Steal from' : 'Swap with', playerBtns('target', (p) => Object.keys(p.table).some((k) => !isFullP(p, k)))));
    if (f.target) {
      const t = P(v, f.target);
      const okCols = Object.keys(t.table).filter((k) => !isFullP(t, k));
      steps.push(`<h3>Take which card</h3><div class="mytable">${stacksHTML({ table: Object.fromEntries(okCols.map((k) => [k, t.table[k]])), bld: {} }, { pick: true, small: true, sel: [f.prop] })}</div><p class="muted">Cards in full sets can't be taken.</p>`);
    }
    const ready = f.target && f.prop != null && (a === 'grab' || f.mine != null);
    return `${head(nm)}${top}${steps.join('')}${go(a === 'grab' ? 'Grab it' : 'Swap', ready)}${bankBtn}`;
  }
  return `${head(nm)}${top}${bankBtn}`;
}
const stackCount = (p, k) => (p.table[k] || []).length;
const isFullP = (p, k) => (p.table[k] || []).length >= COL[k].size && p.table[k].some((id) => C[id].cs !== 'any');
function rentOf(p, k) {
  const n = Math.min(stackCount(p, k), COL[k].size);
  if (!n) return 0;
  let r = COL[k].rent[n - 1];
  const b = p.bld[k];
  if (b && n >= COL[k].size) { if (b.house != null) r += 3; if (b.hotel != null) r += 4; }
  return r;
}
$('#sheet-body').addEventListener('click', async (e) => {
  const v = view;
  const pickMine = e.target.closest('[data-pickmine]');
  if (pickMine && ui.flow) { ui.flow.mine = Number(pickMine.dataset.pickmine); renderSheet(); return; }
  const pick = e.target.closest('[data-pick]');
  if (pick && ui.sheet === 'play' && ui.flow) { ui.flow.prop = Number(pick.dataset.pick); renderSheet(); return; }
  const payc = e.target.closest('[data-pay]');
  if (payc) { const id = Number(payc.dataset.pay); if (!C[id].v) { toast('Any Colour wilds are worth nothing, they can\'t pay.'); return; } ui.paySel = ui.paySel.includes(id) ? ui.paySel.filter((x) => x !== id) : ui.paySel.concat(id); renderSheet(); return; }
  const disc = e.target.closest('[data-disc]');
  if (disc) { const id = Number(disc.dataset.disc); ui.discSel = ui.discSel.includes(id) ? ui.discSel.filter((x) => x !== id) : ui.discSel.concat(id); renderSheet(); return; }
  const m = e.target.closest('[data-m]');
  if (m) return menuAction(m.dataset.m);
  const b = e.target.closest('[data-f]');
  if (!b || !ui.flow || !v) return;
  const f = ui.flow;
  const val = b.dataset.v;
  switch (b.dataset.f) {
    case 'bank': if (await act({ type: 'bank', card: f.card })) done(); return;
    case 'prop': if (await act({ type: 'property', card: f.card, color: val })) done(); return;
    case 'moveTo': if (await act({ type: 'move', card: f.card, color: val })) done(); return;
    case 'color': f.color = val; break;
    case 'target': f.target = val; f.prop = null; break;
    case 'set': [f.target, f.color] = val.split('|'); break;
    case 'double': { const id = Number(val); f.doubles = (f.doubles || []).includes(id) ? f.doubles.filter((x) => x !== id) : (f.doubles || []).concat(id); break; }
    case 'go': {
      const a = { type: 'action', card: f.card };
      for (const k of ['color', 'target', 'prop', 'mine', 'doubles']) if (f[k] != null) a[k] = f[k];
      if (await act(a)) done();
      return;
    }
  }
  renderSheet();
});
function done() { ui.flow = null; closeSheet(); }

// Something was played against me (or I'm the one who got a No Deal).
function respondHTML(v) {
  const pd = v.pending;
  if (!pd || pd.actor !== v.me) return '';
  const nos = v.hand.filter((id) => C[id].a === 'no');
  const noBtn = nos.length ? `<button class="btn" data-r="no" data-id="${nos[0]}" ${ui.busy ? 'disabled' : ''}>✋ Play No Deal (${nos.length})</button>` : '';
  const from = nameOf(v, pd.from);
  const shown = cardHTML(pd.card, { attr: '' });
  if (pd.waiting === 'from') {
    return `${head('They said No Deal', false)}<div class="cardrow">${shown}<div class="about"><p><b>${esc(nameOf(v, pd.target))}</b> blocked your ${esc(cardName(pd.card))}.</p><p class="muted">Play a No Deal back to push it through, or let it go.</p></div></div>
      <div class="btncol">${noBtn}<button class="btn primary" data-r="accept" ${ui.busy ? 'disabled' : ''}>Let it go</button></div>`;
  }
  const me = P(v, v.me);
  if (pd.kind === 'pay') {
    const options = me.bank.slice();
    const total = ui.paySel.reduce((s, id) => s + C[id].v, 0);
    const everything = payableIds(me);
    const all = everything.reduce((s, id) => s + C[id].v, 0);
    const okay = total >= pd.amount || (ui.paySel.length === everything.length);
    const short = all < pd.amount;
    const bankCards = options.length ? `<div class="pickgrid">${options.sort((a, b) => C[a].v - C[b].v).map((id) => cardHTML(id, { size: 'sm', attr: `data-pay="${id}"`, sel: ui.paySel.includes(id) })).join('')}</div>` : '<p class="muted">Your bank is empty.</p>';
    const propsOnTable = Object.keys(me.table).length ? `<div class="mytable">${stacksHTML(me, { pick: true, small: true, sel: ui.paySel }).replaceAll('data-pick', 'data-pay')}</div>` : '<p class="muted">No properties.</p>';
    return `${head(`Pay ${from} ${M(pd.amount)}`, false)}
      <div class="cardrow">${cardHTML(pd.card, { size: 'sm', attr: '' })}<div class="about"><p>${esc(from)} played ${esc(cardName(pd.card))}. You owe <b>${M(pd.amount)}</b>.</p><p class="muted">${short ? `You only have ${M(all)}, so you pay with everything.` : 'Pick cards that add up to at least that. No change is given.'}</p></div></div>
      ${noBtn ? `<div class="btncol">${noBtn}</div>` : ''}
      <h3>Your bank</h3>${bankCards}
      <h3>Your properties</h3>${propsOnTable}
      <div class="paybar"><span class="tot">Picked ${M(total)} of ${M(pd.amount)}</span>
      ${short ? `<button class="btn" data-r="payall">Pick everything</button>` : `<button class="btn" data-r="auto">Pick for me</button>`}
      <button class="btn primary" data-r="pay" ${okay && ui.paySel.length && !ui.busy ? '' : 'disabled'}>Pay</button></div>`;
  }
  let what = '';
  if (pd.kind === 'grab') what = `${esc(from)} wants to take your <b>${esc(cardName(pd.prop))}</b>.`;
  else if (pd.kind === 'swap') what = `${esc(from)} wants to swap their <b>${esc(cardName(pd.mine))}</b> for your <b>${esc(cardName(pd.prop))}</b>.`;
  else if (pd.kind === 'takeover') what = `${esc(from)} is taking your whole <b>${COL[pd.color].name}</b> set!`;
  const extra = pd.kind === 'takeover' ? '' : `<div class="pickgrid">${[pd.prop, pd.mine].filter((x) => x != null).map((id) => cardHTML(id, { size: 'sm', attr: '' })).join(pd.kind === 'swap' ? '<span style="align-self:center;font-size:22px">⇄</span>' : '')}</div>`;
  return `${head(E.ACTIONS[C[pd.card].a].name + '!', false)}<div class="cardrow">${shown}<div class="about"><p>${what}</p>${nos.length ? '' : '<p class="muted">You have no No Deal card.</p>'}</div></div>${extra}
    <div class="btncol">${noBtn}<button class="btn ${nos.length ? '' : 'primary'}" data-r="accept" ${ui.busy ? 'disabled' : ''}>OK, let it happen</button></div>`;
}
const cardName = (id) => { const c = C[id]; return c.kind === 'action' ? E.ACTIONS[c.a].name : c.kind === 'wild' ? 'wild card' : c.name; };
function payableIds(p) {
  const out = [...p.bank];
  for (const ids of Object.values(p.table)) for (const id of ids) if (C[id].v > 0) out.push(id);
  for (const b of Object.values(p.bld)) { if (b.house != null) out.push(b.house); if (b.hotel != null) out.push(b.hotel); }
  return out;
}
// Suggest a payment: money first, smallest overpay, properties only if needed.
function autoPick(p, amount) {
  const bank = p.bank.slice().sort((a, b) => C[a].v - C[b].v);
  let best = null;
  const n = bank.length;
  if (n <= 14) {
    for (let mask = 1; mask < 1 << n; mask++) {
      let s = 0, k = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) { s += C[bank[i]].v; k++; }
      if (s >= amount && (!best || s < best.s || (s === best.s && k < best.k))) best = { s, k, mask };
    }
  }
  if (best) return bank.filter((_, i) => best.mask & (1 << i));
  const pick = bank.slice();
  let s = pick.reduce((t, id) => t + C[id].v, 0);
  const props = payableIds(p).filter((id) => !bank.includes(id)).sort((a, b) => C[a].v - C[b].v);
  for (const id of props) { if (s >= amount) break; pick.push(id); s += C[id].v; }
  return pick;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-r]');
  if (!b || !view || !view.pending) return;
  const r = b.dataset.r;
  const me = P(view, view.me);
  if (r === 'auto') { ui.paySel = autoPick(me, view.pending.amount); renderSheet(); return; }
  if (r === 'payall') { ui.paySel = payableIds(me); renderSheet(); return; }
  if (r === 'no') await act({ type: 'no', card: Number(b.dataset.id) });
  else if (r === 'accept') await act({ type: 'accept' });
  else if (r === 'pay') await act({ type: 'pay', cards: ui.paySel });
});

function discardHTML(v) {
  const over = v.hand.length - E.HAND_LIMIT;
  if (over <= 0 || v.turn !== v.me) return '';
  return `${head(`Discard ${over}`)}<p>You can keep ${E.HAND_LIMIT} cards. Pick ${over} to throw away.</p>
    <div class="pickgrid">${v.hand.slice().sort(handOrder).map((id) => cardHTML(id, { size: 'sm', attr: `data-disc="${id}"`, sel: ui.discSel.includes(id) })).join('')}</div>
    <button class="btn primary big" id="do-discard" ${ui.discSel.length === over && !ui.busy ? '' : 'disabled'}>Discard ${ui.discSel.length}/${over} and end turn</button>`;
}
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#do-discard')) return;
  if (await act({ type: 'end', discard: ui.discSel })) { ui.discSel = []; closeSheet(); }
});

function oppHTML(v, uid) {
  const p = P(v, uid);
  if (!p) return '';
  const host = v.hostUid === v.me;
  const away = !p.bot && !p.auto && !isOnline(p.uid);
  const canAuto = host && away && v.phase === 'play' && server.mode === 'cloud';
  const bank = p.bank.length ? `<div class="pickgrid">${p.bank.slice().sort((a, b) => C[a].v - C[b].v).map((id) => cardHTML(id, { size: 'sm', attr: '' })).join('')}</div>` : '<p class="muted">Empty.</p>';
  return `${head(esc(p.name))}<div class="oppview">
    <p class="muted">${p.cards} cards in hand · ${M(bankSum(p))} in bank · ${p.sets}/${v.settings.setsToWin} full sets${p.bot ? ' · computer' : p.auto ? ' · computer playing' : away ? ' · away' : ''}</p>
    ${canAuto ? `<button class="btn" data-auto="${esc(p.uid)}">Let the computer play for ${esc(p.name)}</button>` : ''}
    <h3>Properties</h3><div class="mytable">${stacksHTML(p, { small: true, pick: true, empty: 'No properties yet.' })}</div>
    <h3>Bank</h3>${bank}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-auto]');
  if (b) act({ type: 'autopilot', uid: b.dataset.auto, on: true });
});
function bankHTML(v) {
  const me = P(v, v.me);
  return `${head(`Your bank · ${M(bankSum(me))}`)}${me.bank.length ? `<div class="pickgrid">${me.bank.slice().sort((a, b) => C[a].v - C[b].v).map((id) => cardHTML(id, { size: 'sm', attr: '' })).join('')}</div>` : '<p class="muted">Empty. Bank money and action cards to pay with later.</p>'}`;
}
function overHTML(v) {
  if (v.phase !== 'over') return '';
  const host = v.hostUid === v.me;
  const w = P(v, v.winner);
  const rows = v.players.slice().sort((a, b) => b.sets - a.sets || bankSum(b) - bankSum(a)).map((p) => `<li>${tokenHTML(v, p.uid)}<span>${esc(p.name)}${p.uid === v.me ? ' (you)' : ''}</span><span>★ ${p.sets} · ${M(bankSum(p))}</span></li>`).join('');
  return `${head('Game over')}<div class="winner">${w.uid === v.me ? 'You win! 🎉' : esc(w.name) + ' wins'}</div>
    <div class="mytable">${stacksHTML(w, { small: true, pick: true })}</div>
    <ol class="rank">${rows}</ol>
    ${host ? '<button class="btn primary big" data-m="rematch">Play again</button>' : '<p class="muted center">The host can start a rematch.</p>'}
    <button class="btn" data-m="home">Back to home</button>`;
}
function menuHTML(v) {
  const cloud = server.mode === 'cloud';
  const host = v.hostUid === v.me;
  const hostP = P(v, v.hostUid);
  const hostGone = cloud && !host && (!hostP || hostP.left || !isOnline(v.hostUid));
  return `${head('Menu')}
    ${cloud ? `<p class="muted">Table code <b style="color:var(--ink);letter-spacing:.1em">${esc(v.id)}</b></p><button class="btn" data-m="invite">Copy invite link</button>` : ''}
    <button class="btn" data-open="rules">How to play</button>
    ${hostGone ? '<button class="btn" data-m="claim">Become the host</button>' : ''}
    <button class="btn danger" data-m="leave">Leave the table</button>`;
}
async function menuAction(m) {
  if (m === 'invite') copyInvite();
  else if (m === 'claim') { if (await act({ type: 'claimHost' })) closeSheet(); }
  else if (m === 'leave') { closeSheet(); leaveTable(); }
  else if (m === 'rematch') { if (await act({ type: 'rematch' })) closeSheet(); }
  else if (m === 'home') { closeSheet(); leaveTable(); }
}
function rulesHTML() {
  return `${head('How to play')}<div class="rules">
  <p><b>Win:</b> be first to put down 3 full property sets of different colours.</p>
  <h3>Your turn</h3><ul>
    <li>Draw 2 cards (5 if your hand is empty).</li>
    <li>Play up to 3 cards: put property on your table, put money or action cards in your bank, or play an action.</li>
    <li>End your turn with no more than 7 cards. Extra cards get discarded.</li>
    <li>Wild properties can be moved between colours on your turn, free.</li></ul>
  <h3>Paying</h3><ul>
    <li>Pay from your bank and your properties, never from your hand. No change is given.</li>
    <li>If you can't cover it, you pay with everything you have on the table.</li></ul>
  <h3>Action cards</h3><ul>
    <li><b>Rent:</b> two-colour Rent makes everyone pay. Wild Rent charges one player any colour. <b>Double Rent</b> doubles it, using another play.</li>
    <li><b>Takeover:</b> steal a full set with its buildings. <b>Sneaky Grab:</b> steal one property not in a full set. <b>Swap:</b> trade one of yours for one of theirs, not from full sets.</li>
    <li><b>Vasooli:</b> one player pays ₹5M. <b>Birthday:</b> everyone pays ₹2M. <b>Payday:</b> draw 2.</li>
    <li><b>House</b> adds ₹3M rent and <b>Hotel</b> ₹4M to a full set (not Railway or Utility).</li>
    <li><b>No Deal:</b> cancel anything played against you. The other player can No Deal back.</li></ul>
  <h3>Full sets</h3><p>Brown, Dark Blue and Utility: 2 cards. Railway: 4. Everything else: 3.</p>
  </div>`;
}

// ---------- boot: come back to the table you were at ----------
const back2 = params.get('t') || store.get('table', null);
if (back2 && firebaseConfig && nameInput.value) joinCode(back2, true);
render();
