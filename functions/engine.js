// Business Deal (the card game) rules engine.
// The same file runs in two places:
//   functions/engine.js  the Firebase server, which runs every online table
//   docs/engine.js       the browser, only for practice games against computer players
// Keep the two copies identical (npm run sync).

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const HAND_LIMIT = 7;
export const PLAYS = 3;
export const SETS_TO_WIN = 3;

export const DEFAULT_SETTINGS = {
  setsToWin: 3,       // full sets of different colours needed to win
  playsPerTurn: 3,
};

// ---------- colours ----------
// size: cards in a full set. rent: rent for 1..size cards in the set.
export const COLORS = {
  br: { name: 'Brown', hex: '#8a5a3b', size: 2, rent: [1, 2], build: true },
  lb: { name: 'Light Blue', hex: '#62c1ea', size: 3, rent: [1, 2, 3], build: true },
  pk: { name: 'Pink', hex: '#d9479a', size: 3, rent: [1, 2, 4], build: true },
  or: { name: 'Orange', hex: '#f08c1a', size: 3, rent: [1, 3, 5], build: true },
  rd: { name: 'Red', hex: '#dd3030', size: 3, rent: [2, 3, 6], build: true },
  yl: { name: 'Yellow', hex: '#f2cc18', size: 3, rent: [2, 4, 6], build: true },
  gr: { name: 'Green', hex: '#1f9a52', size: 3, rent: [2, 4, 7], build: true },
  db: { name: 'Dark Blue', hex: '#2348b8', size: 2, rent: [3, 8], build: true },
  rr: { name: 'Railway', hex: '#2b2b2b', size: 4, rent: [1, 2, 3, 4], build: false },
  ut: { name: 'Utility', hex: '#9fc79a', size: 2, rent: [1, 2], build: false },
};
export const COLOR_KEYS = Object.keys(COLORS);
export const HOUSE_RENT = 3;
export const HOTEL_RENT = 4;

// ---------- the deck (106 cards) ----------
export const ACTIONS = {
  takeover: { name: 'Takeover', v: 5, n: 2, text: 'Take a full set from any player, buildings and all.' },
  no: { name: 'No Deal', v: 4, n: 3, text: 'Cancel an action played against you. Can be cancelled by another No Deal.' },
  grab: { name: 'Sneaky Grab', v: 3, n: 3, text: "Steal one property from any player. Not from a full set." },
  swap: { name: 'Swap', v: 3, n: 3, text: 'Swap one of your properties with one of theirs. Not from full sets.' },
  vasooli: { name: 'Vasooli', v: 3, n: 3, text: 'One player pays you ₹5M.' },
  birthday: { name: 'Birthday', v: 2, n: 3, text: 'Every player pays you ₹2M.' },
  payday: { name: 'Payday', v: 1, n: 10, text: 'Draw 2 cards.' },
  house: { name: 'House', v: 3, n: 3, text: 'Add to a full set. Rent +₹3M. Not on Railway or Utility.' },
  hotel: { name: 'Hotel', v: 4, n: 2, text: 'Add to a full set that has a House. Rent +₹4M.' },
  double: { name: 'Double Rent', v: 1, n: 2, text: 'Play with a Rent card to double it. Counts as a play.' },
};
const PROPS = {
  br: ['Shimla', 'Ooty'],
  lb: ['Darjeeling', 'Manali', 'Munnar'],
  pk: ['Jaipur', 'Udaipur', 'Jodhpur'],
  or: ['Lucknow', 'Indore', 'Bhopal'],
  rd: ['Goa', 'Kochi', 'Pune'],
  yl: ['Hyderabad', 'Chennai', 'Bengaluru'],
  gr: ['Kolkata', 'Ahmedabad', 'Chandigarh'],
  db: ['Delhi', 'Mumbai'],
  rr: ['Rajdhani', 'Shatabdi', 'Duronto', 'Vande Bharat'],
  ut: ['Bijli Board', 'Jal Board'],
};
const PROP_VALUE = { br: 1, lb: 1, pk: 2, or: 2, rd: 3, yl: 3, gr: 4, db: 4, rr: 2, ut: 2 };

function buildDeck() {
  const D = [];
  const add = (c, n = 1) => { for (let i = 0; i < n; i++) D.push({ ...c }); };
  for (const [v, n] of [[1, 6], [2, 5], [3, 3], [4, 3], [5, 2], [10, 1]]) add({ kind: 'money', v, name: `₹${v}M` }, n);
  for (const [a, d] of Object.entries(ACTIONS)) add({ kind: 'action', a, v: d.v, name: d.name }, d.n);
  for (const cs of [['br', 'lb'], ['pk', 'or'], ['rd', 'yl'], ['db', 'gr'], ['rr', 'ut']]) add({ kind: 'rent', cs, v: 1, name: 'Rent' }, 2);
  add({ kind: 'rent', cs: 'any', v: 3, name: 'Wild Rent' }, 3);
  for (const [c, names] of Object.entries(PROPS)) for (const name of names) add({ kind: 'prop', c, v: PROP_VALUE[c], name });
  add({ kind: 'wild', cs: 'any', v: 0, name: 'Any Colour' }, 2);
  for (const [cs, v, n] of [[['pk', 'or'], 2, 2], [['lb', 'br'], 1, 1], [['lb', 'rr'], 4, 1], [['db', 'gr'], 4, 1], [['gr', 'rr'], 4, 1], [['rd', 'yl'], 3, 2], [['ut', 'rr'], 4, 1]]) {
    add({ kind: 'wild', cs, v, name: 'Wild' }, n);
  }
  return D.map((c, id) => ({ id, ...c }));
}
export const CARDS = buildDeck(); // index = card id
export const DECK_SIZE = CARDS.length; // 106
export const colorsOf = (c) => (c.kind === 'prop' ? [c.c] : c.cs === 'any' ? COLOR_KEYS : c.cs);
export const isProp = (c) => c.kind === 'prop' || c.kind === 'wild';
export const isBuilding = (c) => c.kind === 'action' && (c.a === 'house' || c.a === 'hotel');
export const money = (n) => `₹${n}M`;

// ---------- randomness ----------
function randInt(n) {
  const buf = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  let x;
  do { globalThis.crypto.getRandomValues(buf); x = buf[0]; } while (x >= lim);
  return x % n;
}
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function makeCode(len = 5) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += A[randInt(A.length)];
  return s;
}

// ---------- table setup ----------
function cleanName(name) {
  const n = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  if (!n) throw new Error('Put your name in first.');
  return n;
}
const newPlayer = (uid, name, bot) => ({ uid, name, bot, auto: false, left: false });
export function createTable(id, uid, name) {
  return {
    id,
    hostUid: uid,
    phase: 'lobby',
    seq: 0,
    moveNo: 0,
    settings: { ...DEFAULT_SETTINGS },
    players: [newPlayer(uid, cleanName(name), false)],
    deck: [],
    discard: [],
    hands: {},
    bank: {},     // uid -> [card ids]
    table: {},    // uid -> { colour: [card ids] }
    bld: {},      // uid -> { colour: { house: id|null, hotel: id|null } }
    turn: 0,
    plays: 0,
    pending: null,
    played: null, // last card played, for the middle of the table
    log: [],
    winner: null,
    rids: {},
    botAt: 0,
    lastActive: 0,
  };
}

const idxOf = (st, uid) => st.players.findIndex((p) => p.uid === uid);
const playerOf = (st, uid) => st.players.find((p) => p.uid === uid);
const isHost = (st, uid) => st.hostUid === uid;
const computerRuns = (p) => p.bot || p.auto;
const cur = (st) => st.players[st.turn];
const nameOf = (st, uid) => (playerOf(st, uid) || {}).name || '?';
function need(cond, msg) { if (!cond) throw new Error(msg); }
function log(st, msg) {
  st.log.push(msg);
  if (st.log.length > 60) st.log.splice(0, st.log.length - 60);
}

export function joinTable(st, uid, name) {
  if (idxOf(st, uid) >= 0) {
    const p = playerOf(st, uid);
    if (p.left) { p.left = false; p.auto = false; st.seq++; }
    return;
  }
  need(st.phase === 'lobby', 'This game already started. You can join when the host starts a rematch.');
  need(st.players.length < MAX_PLAYERS, `Table is full (${MAX_PLAYERS} players).`);
  st.players.push(newPlayer(uid, cleanName(name), false));
  st.seq++;
}

const BOT_NAMES = ['Seth Ji', 'Munim', 'Lala', 'Bunty', 'Pinky', 'Golu'];
function addBot(st) {
  need(st.players.length < MAX_PLAYERS, `Table is full (${MAX_PLAYERS} players).`);
  const used = new Set(st.players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + (st.players.length + 1);
  let uid;
  do { uid = 'bot_' + makeCode(6); } while (idxOf(st, uid) >= 0);
  st.players.push(newPlayer(uid, name, true));
}
function applySettings(st, s) {
  if ('setsToWin' in s && [2, 3, 4].includes(Number(s.setsToWin))) st.settings.setsToWin = Number(s.setsToWin);
  if ('playsPerTurn' in s && [3, 4].includes(Number(s.playsPerTurn))) st.settings.playsPerTurn = Number(s.playsPerTurn);
}

function draw(st, uid, n) {
  const h = st.hands[uid];
  for (let i = 0; i < n; i++) {
    if (!st.deck.length) {
      if (!st.discard.length) break;
      st.deck = shuffle(st.discard);
      st.discard = [];
      log(st, 'The deck ran out. Discards shuffled back in.');
    }
    h.push(st.deck.pop());
  }
}
function startGame(st) {
  need(st.players.length >= MIN_PLAYERS, `Need at least ${MIN_PLAYERS} players. Add a computer player or wait for a friend.`);
  shuffle(st.players);
  st.deck = shuffle(CARDS.map((c) => c.id));
  st.discard = [];
  st.hands = {}; st.bank = {}; st.table = {}; st.bld = {};
  for (const p of st.players) { st.hands[p.uid] = []; st.bank[p.uid] = []; st.table[p.uid] = {}; st.bld[p.uid] = {}; draw(st, p.uid, 5); }
  Object.assign(st, { phase: 'play', turn: 0, plays: 0, pending: null, played: null, log: [], winner: null });
  log(st, `Game on. Everyone has 5 cards. ${cur(st).name} goes first.`);
  beginTurn(st);
}
function beginTurn(st) {
  const p = cur(st);
  const n = st.hands[p.uid].length ? 2 : 5;
  draw(st, p.uid, n);
  st.plays = 0;
  st.moveNo++;
  log(st, `${p.name} drew ${n}.`);
}

// ---------- reading the table ----------
export function stackSize(st, uid, c) { return (st.table[uid][c] || []).length; }
export const isFull = (st, uid, c) => stackSize(st, uid, c) >= COLORS[c].size;
export function fullSets(st, uid) {
  // A set made only of Any Colour wilds doesn't count.
  return COLOR_KEYS.filter((c) => isFull(st, uid, c) && (st.table[uid][c] || []).some((id) => CARDS[id].cs !== 'any'));
}
export function rentFor(st, uid, c) {
  const n = Math.min(stackSize(st, uid, c), COLORS[c].size);
  if (!n) return 0;
  let r = COLORS[c].rent[n - 1];
  const b = st.bld[uid][c];
  if (b && isFull(st, uid, c)) { if (b.house != null) r += HOUSE_RENT; if (b.hotel != null) r += HOTEL_RENT; }
  return r;
}
function findOnTable(st, uid, id) {
  for (const [c, ids] of Object.entries(st.table[uid])) if (ids.includes(id)) return c;
  return null;
}
export function bankTotal(st, uid) { return st.bank[uid].reduce((s, id) => s + CARDS[id].v, 0); }
// Every card a player could hand over to pay: bank, properties (not Any Colour wilds, they're worth nothing) and buildings.
export function payable(st, uid) {
  const out = [...st.bank[uid]];
  for (const ids of Object.values(st.table[uid])) for (const id of ids) if (CARDS[id].v > 0) out.push(id);
  for (const b of Object.values(st.bld[uid])) { if (b.house != null) out.push(b.house); if (b.hotel != null) out.push(b.hotel); }
  return out;
}
const value = (ids) => ids.reduce((s, id) => s + CARDS[id].v, 0);
function checkWin(st) {
  for (const p of st.players) {
    if (fullSets(st, p.uid).length >= st.settings.setsToWin) {
      st.phase = 'over';
      st.winner = p.uid;
      st.pending = null;
      st.moveNo++;
      log(st, `${p.name} has ${st.settings.setsToWin} full sets and wins!`);
      return true;
    }
  }
  return false;
}
// After a card leaves a stack, buildings on a set that's no longer full go to the owner's bank.
function tidy(st, uid) {
  for (const c of Object.keys(st.table[uid])) if (!st.table[uid][c].length) delete st.table[uid][c];
  for (const [c, b] of Object.entries(st.bld[uid])) {
    if (!isFull(st, uid, c)) {
      if (b.hotel != null) st.bank[uid].push(b.hotel);
      if (b.house != null) st.bank[uid].push(b.house);
      delete st.bld[uid][c];
    } else if (b.house == null && b.hotel == null) delete st.bld[uid][c];
  }
}
function takeFromHand(st, uid, id) {
  const h = st.hands[uid];
  const k = h.indexOf(id);
  need(k >= 0, "That card isn't in your hand.");
  h.splice(k, 1);
}
function placeProp(st, uid, id, c) {
  (st.table[uid][c] = st.table[uid][c] || []).push(id);
}

// ---------- playing cards ----------
function usePlay(st, n = 1) {
  need(st.plays + n <= st.settings.playsPerTurn, `You've used your ${st.settings.playsPerTurn} plays. End your turn.`);
  st.plays += n;
}
function showPlayed(st, uid, id, extra = '') {
  st.played = { by: uid, id, n: (st.played ? st.played.n : 0) + 1, extra };
}

function playBank(st, uid, id) {
  const c = CARDS[id];
  need(c.kind === 'money' || c.kind === 'action' || c.kind === 'rent', "Property can't go in the bank.");
  usePlay(st);
  takeFromHand(st, uid, id);
  st.bank[uid].push(id);
  log(st, `${nameOf(st, uid)} banked ${c.kind === 'money' ? c.name : `${c.name} as ${money(c.v)}`}.`);
}
function playProperty(st, uid, id, color) {
  const c = CARDS[id];
  need(isProp(c), 'Not a property card.');
  const cs = colorsOf(c);
  const col = color || cs[0];
  need(cs.includes(col), 'That card is not that colour.');
  usePlay(st);
  takeFromHand(st, uid, id);
  placeProp(st, uid, id, col);
  showPlayed(st, uid, id);
  log(st, `${nameOf(st, uid)} played ${c.kind === 'prop' ? c.name : 'a wild'} on ${COLORS[col].name}.`);
}
function moveWild(st, uid, id, color) {
  const from = findOnTable(st, uid, id);
  need(from, 'That card is not on your table.');
  const c = CARDS[id];
  need(c.kind === 'wild', 'Only wild cards can be moved.');
  need(colorsOf(c).includes(color), 'That card is not that colour.');
  need(from !== color, 'Already there.');
  const b = st.bld[uid][from];
  need(!b || stackSize(st, uid, from) > COLORS[from].size, 'Move the House or Hotel first. That set has buildings.');
  st.table[uid][from] = st.table[uid][from].filter((x) => x !== id);
  placeProp(st, uid, id, color);
  tidy(st, uid);
  log(st, `${nameOf(st, uid)} moved a wild to ${COLORS[color].name}.`);
}

function opponents(st, uid) { return st.players.filter((p) => p.uid !== uid).map((p) => p.uid); }

function playAction(st, uid, a) {
  const id = Number(a.card);
  const c = CARDS[id];
  need(st.hands[uid].includes(id), "That card isn't in your hand.");
  need(c && (c.kind === 'action' || c.kind === 'rent'), 'Not an action card.');
  const me = nameOf(st, uid);

  if (c.kind === 'rent') return playRent(st, uid, id, a);

  switch (c.a) {
    case 'no':
      throw new Error('No Deal is only for when someone plays something against you. You can bank it.');
    case 'double':
      throw new Error('Play Double Rent together with a Rent card.');
    case 'payday':
      usePlay(st); takeFromHand(st, uid, id); st.discard.push(id); showPlayed(st, uid, id);
      draw(st, uid, 2);
      log(st, `${me} played Payday and drew 2.`);
      return;
    case 'house':
    case 'hotel': {
      const col = a.color;
      need(COLORS[col] && COLORS[col].build, 'Houses and Hotels only go on colour sets.');
      need(isFull(st, uid, col), 'Only on a full set.');
      const b = st.bld[uid][col] || { house: null, hotel: null };
      if (c.a === 'house') need(b.house == null, 'That set already has a House.');
      else { need(b.house != null, 'Put a House on it first.'); need(b.hotel == null, 'That set already has a Hotel.'); }
      usePlay(st); takeFromHand(st, uid, id);
      b[c.a] = id;
      st.bld[uid][col] = b;
      showPlayed(st, uid, id);
      log(st, `${me} built a ${c.name} on ${COLORS[col].name}.`);
      return;
    }
    case 'birthday':
    case 'vasooli': {
      const targets = c.a === 'birthday' ? opponents(st, uid) : [a.target];
      if (c.a === 'vasooli') need(playerOf(st, a.target) && a.target !== uid, 'Pick a player.');
      usePlay(st); takeFromHand(st, uid, id); st.discard.push(id);
      const amount = c.a === 'birthday' ? 2 : 5;
      showPlayed(st, uid, id, c.a === 'vasooli' ? `→ ${nameOf(st, a.target)}` : '');
      log(st, c.a === 'birthday' ? `${me} played Birthday. Everyone pays ${money(2)}.` : `${me} played Vasooli on ${nameOf(st, a.target)} for ${money(5)}.`);
      startPending(st, { kind: 'pay', from: uid, amount, card: id, queue: targets });
      return;
    }
    case 'grab': {
      const t = a.target;
      need(playerOf(st, t) && t !== uid, 'Pick a player.');
      const pid = Number(a.prop);
      const col = findOnTable(st, t, pid);
      need(col, 'Pick one of their properties.');
      need(!isFull(st, t, col), "Can't take from a full set. That needs a Takeover.");
      usePlay(st); takeFromHand(st, uid, id); st.discard.push(id);
      showPlayed(st, uid, id, `→ ${nameOf(st, t)}`);
      log(st, `${me} played Sneaky Grab on ${nameOf(st, t)}'s ${CARDS[pid].kind === 'prop' ? CARDS[pid].name : 'wild'}.`);
      startPending(st, { kind: 'grab', from: uid, card: id, queue: [t], prop: pid });
      return;
    }
    case 'swap': {
      const t = a.target;
      need(playerOf(st, t) && t !== uid, 'Pick a player.');
      const mine = Number(a.mine), theirs = Number(a.prop);
      const mc = findOnTable(st, uid, mine), tc = findOnTable(st, t, theirs);
      need(mc, 'Pick one of your properties to give.');
      need(tc, 'Pick one of their properties to take.');
      need(!isFull(st, uid, mc) && !isFull(st, t, tc), "Can't swap cards out of a full set.");
      usePlay(st); takeFromHand(st, uid, id); st.discard.push(id);
      showPlayed(st, uid, id, `→ ${nameOf(st, t)}`);
      log(st, `${me} played Swap with ${nameOf(st, t)}.`);
      startPending(st, { kind: 'swap', from: uid, card: id, queue: [t], prop: theirs, mine });
      return;
    }
    case 'takeover': {
      const t = a.target;
      need(playerOf(st, t) && t !== uid, 'Pick a player.');
      const col = a.color;
      need(COLORS[col] && fullSets(st, t).includes(col), 'Pick one of their full sets.');
      usePlay(st); takeFromHand(st, uid, id); st.discard.push(id);
      showPlayed(st, uid, id, `→ ${nameOf(st, t)}`);
      log(st, `${me} played Takeover on ${nameOf(st, t)}'s ${COLORS[col].name} set!`);
      startPending(st, { kind: 'takeover', from: uid, card: id, queue: [t], color: col });
      return;
    }
  }
  throw new Error('Unknown card.');
}

function playRent(st, uid, id, a) {
  const c = CARDS[id];
  const col = a.color;
  const allowed = c.cs === 'any' ? COLOR_KEYS : c.cs;
  need(allowed.includes(col), 'That Rent card is not for that colour.');
  need(stackSize(st, uid, col) > 0, `You don't have any ${COLORS[col].name} property.`);
  const doubles = [...new Set((Array.isArray(a.doubles) ? a.doubles : []).map(Number))];
  for (const d of doubles) need(st.hands[uid].includes(d) && CARDS[d].a === 'double', "That Double Rent isn't in your hand.");
  let targets;
  if (c.cs === 'any') { need(playerOf(st, a.target) && a.target !== uid, 'Wild Rent charges one player. Pick who.'); targets = [a.target]; }
  else targets = opponents(st, uid);
  usePlay(st, 1 + doubles.length);
  takeFromHand(st, uid, id); st.discard.push(id);
  for (const d of doubles) { takeFromHand(st, uid, d); st.discard.push(d); }
  const amount = rentFor(st, uid, col) * 2 ** doubles.length;
  showPlayed(st, uid, id, `${COLORS[col].name} · ${money(amount)}${doubles.length ? ' (doubled)' : ''}`);
  log(st, `${nameOf(st, uid)} charged ${money(amount)} rent on ${COLORS[col].name}${c.cs === 'any' ? ` to ${nameOf(st, targets[0])}` : ' to everyone'}${doubles.length ? ', doubled' : ''}.`);
  startPending(st, { kind: 'pay', from: uid, amount, card: id, queue: targets, rent: col });
}

// ---------- things played against you ----------
// pending: { kind: pay|grab|swap|takeover, from, queue: [uids still to deal with], target, waiting: 'target'|'from', nos: count }
function startPending(st, p) {
  st.pending = { ...p, target: null, waiting: 'target', nos: 0 };
  nextTarget(st);
}
function nextTarget(st) {
  const p = st.pending;
  while (p.queue.length) {
    const t = p.queue.shift();
    // Someone with nothing to pay with is skipped (unless they could still say No, it makes no difference).
    if (p.kind === 'pay' && !payable(st, t).length) { log(st, `${nameOf(st, t)} has nothing to pay with.`); continue; }
    p.target = t;
    p.waiting = 'target';
    p.nos = 0;
    st.moveNo++;
    return;
  }
  st.pending = null;
  st.moveNo++;
  checkWin(st);
}
// The player who has to answer right now.
export function pendingActor(st) {
  const p = st.pending;
  if (!p || !p.target) return null;
  return p.waiting === 'target' ? p.target : p.from;
}
function sayNo(st, uid, id) {
  const p = st.pending;
  need(p && pendingActor(st) === uid, 'Nothing to say no to.');
  id = Number(id);
  need(st.hands[uid].includes(id) && CARDS[id].a === 'no', "You don't have a No Deal card.");
  takeFromHand(st, uid, id);
  st.discard.push(id);
  p.nos++;
  showPlayed(st, uid, id);
  st.moveNo++;
  if (p.waiting === 'target') {
    p.waiting = 'from';
    log(st, `${nameOf(st, uid)} said No Deal!`);
  } else {
    p.waiting = 'target';
    log(st, `${nameOf(st, uid)} said No Deal right back!`);
  }
}
// Target accepts (steals) or the attacker gives up after a No Deal.
function accept(st, uid) {
  const p = st.pending;
  need(p && pendingActor(st) === uid, 'Nothing to answer.');
  if (p.waiting === 'from') {
    log(st, `${nameOf(st, p.target)} is let off.`);
    nextTarget(st);
    return;
  }
  need(p.kind !== 'pay', 'Pick the cards to pay with.');
  const t = p.target, from = p.from;
  if (p.kind === 'grab') {
    const col = findOnTable(st, t, p.prop);
    if (col) {
      st.table[t][col] = st.table[t][col].filter((x) => x !== p.prop);
      placeProp(st, from, p.prop, col);
      tidy(st, t);
      log(st, `${nameOf(st, from)} took ${CARDS[p.prop].kind === 'prop' ? CARDS[p.prop].name : 'a wild'} from ${nameOf(st, t)}.`);
    }
  } else if (p.kind === 'swap') {
    const tc = findOnTable(st, t, p.prop), mc = findOnTable(st, from, p.mine);
    if (tc && mc) {
      st.table[t][tc] = st.table[t][tc].filter((x) => x !== p.prop);
      st.table[from][mc] = st.table[from][mc].filter((x) => x !== p.mine);
      placeProp(st, from, p.prop, tc);
      placeProp(st, t, p.mine, mc);
      tidy(st, t); tidy(st, from);
      log(st, `${nameOf(st, from)} and ${nameOf(st, t)} swapped properties.`);
    }
  } else if (p.kind === 'takeover') {
    const col = p.color;
    const ids = st.table[t][col] || [];
    if (ids.length) {
      for (const id of ids) placeProp(st, from, id, col);
      delete st.table[t][col];
      const b = st.bld[t][col];
      if (b) {
        // Buildings come along if the taker can use them, else into the taker's bank.
        const mine = st.bld[from][col];
        if (!mine) st.bld[from][col] = b;
        else { if (b.house != null) st.bank[from].push(b.house); if (b.hotel != null) st.bank[from].push(b.hotel); }
        delete st.bld[t][col];
      }
      tidy(st, t); tidy(st, from);
      log(st, `${nameOf(st, from)} took ${nameOf(st, t)}'s ${COLORS[col].name} set.`);
    }
  }
  nextTarget(st);
}
function pay(st, uid, ids) {
  const p = st.pending;
  need(p && p.kind === 'pay' && p.target === uid && p.waiting === 'target', 'Nothing to pay right now.');
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number))];
  const all = payable(st, uid);
  for (const id of ids) need(all.includes(id), "You can't pay with that card.");
  const total = value(ids);
  const everything = value(all);
  need(total >= p.amount || ids.length === all.length, `That's ${money(total)}. You owe ${money(p.amount)}.`);
  need(total >= p.amount || total >= everything, 'Pay with everything you have.');
  const to = p.from;
  const got = [];
  // Buildings first, so they leave before their set might break.
  const built = new Set();
  for (const b of Object.values(st.bld[uid])) { if (b.house != null) built.add(b.house); if (b.hotel != null) built.add(b.hotel); }
  for (const id of ids) {
    if (!built.has(id)) continue;
    for (const b of Object.values(st.bld[uid])) { if (b.house === id) b.house = null; if (b.hotel === id) b.hotel = null; }
    st.bank[to].push(id);
    got.push(id);
  }
  for (const id of ids) {
    if (built.has(id)) continue;
    const k = st.bank[uid].indexOf(id);
    if (k >= 0) { st.bank[uid].splice(k, 1); st.bank[to].push(id); got.push(id); continue; }
    const col = findOnTable(st, uid, id);
    if (col) {
      st.table[uid][col] = st.table[uid][col].filter((x) => x !== id);
      placeProp(st, to, id, col);
      got.push(id);
    }
  }
  // A hotel without its house goes to the bank too.
  for (const [c, b] of Object.entries(st.bld[uid])) if (b.house == null && b.hotel != null) { st.bank[uid].push(b.hotel); b.hotel = null; }
  tidy(st, uid);
  tidy(st, to);
  log(st, `${nameOf(st, uid)} paid ${nameOf(st, to)} ${money(total)}${total < p.amount ? ' (everything they had)' : ''}.`);
  nextTarget(st);
}

function endTurn(st, uid, discards) {
  need(!st.pending, 'Wait for everyone to answer first.');
  const h = st.hands[uid];
  discards = [...new Set((Array.isArray(discards) ? discards : []).map(Number))];
  for (const id of discards) need(h.includes(id), "That card isn't in your hand.");
  need(h.length - discards.length <= HAND_LIMIT, `You can keep ${HAND_LIMIT} cards. Discard ${h.length - HAND_LIMIT}.`);
  need(h.length - discards.length >= Math.min(h.length, HAND_LIMIT), `Only discard down to ${HAND_LIMIT}.`);
  for (const id of discards) { takeFromHand(st, uid, id); st.discard.push(id); }
  if (discards.length) log(st, `${nameOf(st, uid)} discarded ${discards.length}.`);
  st.turn = (st.turn + 1) % st.players.length;
  beginTurn(st);
}

// ---------- the one entry point for every player action ----------
export const AWAY_MS = 70000;
export const TURN_MOVES = ['bank', 'property', 'action', 'move', 'end'];
export function dispatch(st, uid, a, now, presence = {}) {
  const me = playerOf(st, uid);
  need(me, 'You are not at this table.');
  const type = a && a.type;
  if (!['autopilot', 'claimHost', 'leave', 'settings', 'addBot', 'remove', 'start', 'rematch'].includes(type) && me.auto && !me.bot) me.auto = false;
  if (TURN_MOVES.includes(type)) {
    need(st.phase === 'play', 'The game is not running.');
    need(cur(st).uid === uid, "It's not your turn.");
    need(!st.pending, 'Wait for everyone to answer first.');
  }
  switch (type) {
    case 'addBot':
      need(isHost(st, uid), 'Only the host can add computer players.');
      need(st.phase === 'lobby', 'Add computer players before the game starts.');
      addBot(st);
      break;
    case 'remove': {
      need(isHost(st, uid), 'Only the host can remove players.');
      need(st.phase === 'lobby', 'Players can only be removed in the lobby.');
      need(a.uid !== uid, 'Use Leave to leave the table yourself.');
      const k = idxOf(st, a.uid);
      need(k >= 0, 'That player already left.');
      st.players.splice(k, 1);
      break;
    }
    case 'settings':
      need(isHost(st, uid), 'Only the host can change the rules.');
      need(st.phase === 'lobby', 'Rules are locked once the game starts.');
      applySettings(st, a.settings || {});
      break;
    case 'start':
      need(isHost(st, uid), 'Only the host can start.');
      need(st.phase === 'lobby', 'The game already started.');
      startGame(st);
      break;
    case 'bank': playBank(st, uid, Number(a.card)); break;
    case 'property': playProperty(st, uid, Number(a.card), a.color); break;
    case 'move': moveWild(st, uid, Number(a.card), a.color); break;
    case 'action': playAction(st, uid, a); break;
    case 'end': endTurn(st, uid, a.discard); break;
    case 'no': need(st.phase === 'play', 'The game is not running.'); sayNo(st, uid, a.card); break;
    case 'accept': need(st.phase === 'play', 'The game is not running.'); accept(st, uid); break;
    case 'pay': need(st.phase === 'play', 'The game is not running.'); pay(st, uid, a.cards); break;
    case 'autopilot': {
      const target = playerOf(st, a.uid || uid);
      need(target && !target.bot, 'No such player.');
      need(st.phase !== 'lobby', 'Autopilot is only for during a game.');
      if (target.uid !== uid) {
        need(isHost(st, uid), 'Only the host can do that for someone else.');
        const seen = presence[target.uid] || 0;
        need(!a.on || now - seen > AWAY_MS, `${target.name} is still connected. Give them a minute.`);
      }
      target.auto = !!a.on;
      if (!a.on) target.left = false;
      break;
    }
    case 'claimHost': {
      need(!isHost(st, uid), "You're already the host.");
      const host = playerOf(st, st.hostUid);
      const seen = presence[st.hostUid] || 0;
      need(!host || host.left || now - seen > AWAY_MS, 'The host is still connected.');
      st.hostUid = uid;
      break;
    }
    case 'leave':
      if (st.phase === 'lobby') st.players.splice(idxOf(st, uid), 1);
      else { me.left = true; me.auto = true; }
      if (isHost(st, uid)) {
        const next = st.players.find((p) => !p.bot && !p.left && p.uid !== uid);
        if (next) st.hostUid = next.uid;
      }
      break;
    case 'rematch':
      need(isHost(st, uid), 'Only the host can start a rematch.');
      need(st.phase === 'over', 'Finish this game first.');
      st.players = st.players.filter((p) => !p.left);
      for (const p of st.players) p.auto = false;
      Object.assign(st, { phase: 'lobby', deck: [], discard: [], hands: {}, bank: {}, table: {}, bld: {}, pending: null, played: null, log: [], winner: null });
      break;
    default:
      throw new Error('Unknown move.');
  }
  if (st.phase === 'play' && type !== 'settings') checkWin(st);
  st.botAt = Math.max(st.botAt, now + 700);
  st.seq++;
  st.lastActive = now;
}

// ---------- computer players ----------
function setNeed(st, uid, c) { return COLORS[c].size - stackSize(st, uid, c); }
function bestColorFor(st, uid, card) {
  // Put a wild where it gets closest to a full set (prefer finishing one).
  const cs = colorsOf(card);
  return cs.slice().sort((x, y) => {
    const nx = setNeed(st, uid, x), ny = setNeed(st, uid, y);
    const fx = nx === 1 ? -10 : nx <= 0 ? 10 : nx, fy = ny === 1 ? -10 : ny <= 0 ? 10 : ny;
    return fx - fy || COLORS[y].rent[COLORS[y].size - 1] - COLORS[x].rent[COLORS[x].size - 1];
  })[0];
}
// Which property of someone else's would help this bot most.
function wantScore(st, me, owner, id) {
  const col = findOnTable(st, owner, id);
  const n = setNeed(st, me, col);
  return (n === 1 ? 50 : 0) + (stackSize(st, me, col) ? 10 : 0) + CARDS[id].v * 2 + (CARDS[id].kind === 'wild' ? 3 : 0);
}
function botChoosePlay(st, uid) {
  const hand = st.hands[uid].map((id) => CARDS[id]);
  const others = opponents(st, uid);
  const left = st.settings.playsPerTurn - st.plays;
  const opts = [];
  for (const c of hand) {
    if (isProp(c)) {
      const col = bestColorFor(st, uid, c);
      opts.push({ s: setNeed(st, uid, col) === 1 ? 100 : 70, a: { type: 'property', card: c.id, color: col } });
    } else if (c.kind === 'money') {
      opts.push({ s: 30 + (bankTotal(st, uid) < 6 ? 15 : 0) + c.v, a: { type: 'bank', card: c.id } });
    } else if (c.kind === 'rent') {
      const cols = (c.cs === 'any' ? COLOR_KEYS : c.cs).filter((k) => stackSize(st, uid, k));
      const doubles = hand.filter((d) => d.a === 'double').map((d) => d.id).slice(0, Math.max(0, left - 1));
      for (const col of cols) {
        const amt = rentFor(st, uid, col);
        if (c.cs === 'any') {
          const t = others.slice().sort((x, y) => value(payable(st, y)) - value(payable(st, x)))[0];
          const useD = amt >= 3 && doubles.length ? doubles.slice(0, 1) : [];
          opts.push({ s: 25 + amt * 2 * (useD.length ? 2 : 1), a: { type: 'action', card: c.id, color: col, target: t, doubles: useD } });
        } else {
          const useD = amt * others.length >= 4 && doubles.length ? doubles.slice(0, 1) : [];
          opts.push({ s: 25 + amt * 2 * others.length * (useD.length ? 1.6 : 1), a: { type: 'action', card: c.id, color: col, doubles: useD } });
        }
      }
      opts.push({ s: 10 + c.v, a: { type: 'bank', card: c.id } });
    } else if (c.kind === 'action') {
      switch (c.a) {
        case 'payday': opts.push({ s: left > 1 ? 80 : 20, a: { type: 'action', card: c.id } }); break;
        case 'birthday': opts.push({ s: 45 + others.length * 3, a: { type: 'action', card: c.id } }); break;
        case 'vasooli': {
          const t = others.slice().sort((x, y) => value(payable(st, y)) - value(payable(st, x)))[0];
          if (value(payable(st, t)) > 0) opts.push({ s: 55, a: { type: 'action', card: c.id, target: t } });
          break;
        }
        case 'takeover':
          for (const t of others) for (const col of fullSets(st, t)) opts.push({ s: 95 + rentFor(st, t, col), a: { type: 'action', card: c.id, target: t, color: col } });
          break;
        case 'grab':
          for (const t of others) for (const [col, ids] of Object.entries(st.table[t])) {
            if (isFull(st, t, col)) continue;
            for (const id of ids) opts.push({ s: 40 + wantScore(st, uid, t, id), a: { type: 'action', card: c.id, target: t, prop: id } });
          }
          break;
        case 'swap': {
          const mine = [];
          for (const [col, ids] of Object.entries(st.table[uid])) if (!isFull(st, uid, col)) for (const id of ids) mine.push(id);
          if (!mine.length) break;
          const give = mine.sort((x, y) => CARDS[x].v - CARDS[y].v)[0];
          for (const t of others) for (const [col, ids] of Object.entries(st.table[t])) {
            if (isFull(st, t, col)) continue;
            for (const id of ids) { const w = wantScore(st, uid, t, id); if (w >= 50) opts.push({ s: 40 + w, a: { type: 'action', card: c.id, target: t, prop: id, mine: give } }); }
          }
          break;
        }
        case 'house':
        case 'hotel':
          for (const col of fullSets(st, uid)) {
            if (!COLORS[col].build) continue;
            const b = st.bld[uid][col] || {};
            if (c.a === 'house' ? b.house == null : b.house != null && b.hotel == null) opts.push({ s: 60, a: { type: 'action', card: c.id, color: col } });
          }
          break;
      }
      if (c.a !== 'no' && c.a !== 'double') opts.push({ s: 12 + c.v, a: { type: 'bank', card: c.id } });
    }
  }
  opts.sort((x, y) => y.s - x.s);
  return opts[0] && opts[0].s >= 30 ? opts[0].a : null;
}
function botPayment(st, uid, amount) {
  const all = payable(st, uid);
  if (value(all) <= amount) return all;
  // Money first, smallest cards that cover it; then properties outside full sets; full sets last.
  const rank = (id) => {
    const c = CARDS[id];
    if (st.bank[uid].includes(id)) return 0;
    if (isBuilding(c)) return 2;
    const col = findOnTable(st, uid, id);
    return isFull(st, uid, col) ? 3 : 1;
  };
  const sorted = all.slice().sort((x, y) => rank(x) - rank(y) || CARDS[x].v - CARDS[y].v);
  // Try a single card that covers it with the least waste from the cheapest tier available.
  const pick = [];
  let sum = 0;
  for (const tier of [0, 1, 2, 3]) {
    const pool = sorted.filter((id) => rank(id) === tier);
    const single = pool.filter((id) => CARDS[id].v >= amount - sum).sort((x, y) => CARDS[x].v - CARDS[y].v)[0];
    if (single != null && sum < amount) {
      // Prefer combining small ones if that wastes less.
      let alt = [], s2 = sum;
      for (const id of pool.slice().sort((x, y) => CARDS[y].v - CARDS[x].v)) { if (s2 >= amount) break; if (CARDS[id].v < CARDS[single].v) { alt.push(id); s2 += CARDS[id].v; } }
      if (s2 >= amount && s2 - amount < sum + CARDS[single].v - amount) { pick.push(...alt); sum = s2; }
      else { pick.push(single); sum += CARDS[single].v; }
      break;
    }
    for (const id of pool.slice().sort((x, y) => CARDS[y].v - CARDS[x].v)) { if (sum >= amount) break; pick.push(id); sum += CARDS[id].v; }
    if (sum >= amount) break;
  }
  return pick;
}
function botRespond(st, uid) {
  const p = st.pending;
  const noCard = st.hands[uid].find((id) => CARDS[id].a === 'no');
  if (p.waiting === 'target') {
    let worth = 0;
    if (p.kind === 'takeover') worth = 100;
    else if (p.kind === 'pay') worth = p.amount >= 5 ? 60 : p.amount >= 3 ? 25 : 0;
    else if (p.kind === 'grab') worth = wantScore(st, p.from, uid, p.prop) + (setNeed(st, uid, findOnTable(st, uid, p.prop)) === 1 ? 40 : 0);
    else if (p.kind === 'swap') worth = 40;
    if (noCard != null && worth >= 50) return sayNo(st, uid, noCard);
    if (p.kind === 'pay') return pay(st, uid, botPayment(st, uid, p.amount));
    return accept(st, uid);
  }
  // The attacker after a No Deal: push back on big ones.
  if (noCard != null && (p.kind === 'takeover' || (p.kind === 'pay' && p.amount >= 6))) return sayNo(st, uid, noCard);
  return accept(st, uid);
}
function botDiscards(st, uid) {
  const h = st.hands[uid];
  const extra = h.length - HAND_LIMIT;
  if (extra <= 0) return [];
  const keep = (id) => { const c = CARDS[id]; return isProp(c) ? 50 : c.a === 'no' ? 45 : c.a === 'takeover' ? 44 : c.kind === 'money' ? 20 + c.v : 10 + c.v; };
  return h.slice().sort((x, y) => keep(x) - keep(y)).slice(0, extra);
}

// Makes at most one computer move if one is due. Returns true if something changed.
export function runBots(st, now) {
  if (st.phase !== 'play' || now < st.botAt) return false;
  let acted = false;
  if (st.pending) {
    const u = pendingActor(st);
    const p = u && playerOf(st, u);
    if (p && computerRuns(p)) { botRespond(st, u); acted = true; }
  } else {
    const p = cur(st);
    if (computerRuns(p)) {
      const play = st.plays < st.settings.playsPerTurn ? botChoosePlay(st, p.uid) : null;
      if (play) {
        try { dispatchInner(st, p.uid, play); } catch (e) { endTurn(st, p.uid, botDiscards(st, p.uid)); }
      } else endTurn(st, p.uid, botDiscards(st, p.uid));
      acted = true;
    }
  }
  if (acted) {
    if (st.phase === 'play') checkWin(st);
    st.seq++;
    st.lastActive = now;
    st.botAt = Math.max(st.botAt, now + 900);
  }
  return acted;
}
function dispatchInner(st, uid, a) {
  if (a.type === 'bank') playBank(st, uid, a.card);
  else if (a.type === 'property') playProperty(st, uid, a.card, a.color);
  else if (a.type === 'action') playAction(st, uid, a);
}

// ---------- what one player is allowed to see ----------
export function viewFor(st, uid) {
  const playing = st.phase !== 'lobby';
  return {
    id: st.id,
    me: uid,
    seq: st.seq,
    moveNo: st.moveNo,
    phase: st.phase,
    hostUid: st.hostUid,
    settings: st.settings,
    serverNow: st.now || Date.now(),
    botAt: st.botAt,
    players: st.players.map((p) => ({
      uid: p.uid, name: p.name, bot: p.bot, auto: p.auto, left: p.left,
      cards: playing ? (st.hands[p.uid] || []).length : 0,
      bank: playing ? st.bank[p.uid] : [],
      table: playing ? st.table[p.uid] : {},
      bld: playing ? st.bld[p.uid] : {},
      sets: playing ? fullSets(st, p.uid).length : 0,
    })),
    hand: (st.hands[uid] || []).slice(),
    deckCount: st.deck.length,
    discardTop: st.discard.length ? st.discard[st.discard.length - 1] : null,
    turn: st.phase === 'play' ? cur(st).uid : null,
    plays: st.plays,
    pending: st.pending && { ...st.pending, actor: pendingActor(st), queue: st.pending.queue.slice() },
    played: st.played,
    log: st.log.slice(-40),
    winner: st.winner,
  };
}
