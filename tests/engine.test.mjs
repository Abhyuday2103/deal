import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../docs/engine.js';

const byName = (n) => E.CARDS.find((c) => c.name === n).id;
const ofKind = (f) => E.CARDS.filter(f).map((c) => c.id);
function game(n = 3) {
  const st = E.createTable('T', 'a', 'A');
  E.joinTable(st, 'b', 'B');
  if (n > 2) E.joinTable(st, 'c', 'C');
  E.dispatch(st, 'a', { type: 'start' }, 0);
  // Fixed seating and empty hands so tests control everything.
  st.players.sort((x, y) => x.uid.localeCompare(y.uid));
  st.turn = 0; st.plays = 0;
  for (const p of st.players) { st.deck.push(...st.hands[p.uid]); st.hands[p.uid] = []; }
  return st;
}
const give = (st, uid, ids) => { for (const id of ids) { st.deck = st.deck.filter((x) => x !== id); st.hands[uid].push(id); } };
const put = (st, uid, c, ids) => { for (const id of ids) { st.deck = st.deck.filter((x) => x !== id); (st.table[uid][c] = st.table[uid][c] || []).push(id); } };
const bank = (st, uid, ids) => { for (const id of ids) { st.deck = st.deck.filter((x) => x !== id); st.bank[uid].push(id); } };
const act = (st, uid, a) => E.dispatch(st, uid, a, 0);

test('deck has 106 cards in the classic mix', () => {
  assert.equal(E.DECK_SIZE, 106);
  assert.equal(ofKind((c) => c.kind === 'money').length, 20);
  assert.equal(ofKind((c) => c.kind === 'action').length, 34);
  assert.equal(ofKind((c) => c.kind === 'rent').length, 13);
  assert.equal(ofKind((c) => c.kind === 'prop').length, 28);
  assert.equal(ofKind((c) => c.kind === 'wild').length, 11);
  assert.equal(E.CARDS.filter((c) => c.kind === 'money').reduce((s, c) => s + c.v, 0), 57);
});

test("deal 5, draw 2 on your turn (5 if empty), 3 plays, discard to 7", () => {
  const st = E.createTable("T", "a", "A");
  E.joinTable(st, "b", "B");
  E.dispatch(st, "a", { type: "start" }, 0);
  const first = st.players[st.turn].uid, second = st.players[1 - st.turn].uid;
  assert.equal(st.hands[first].length, 7);
  assert.equal(st.hands[second].length, 5);
  st.deck.push(...st.hands[first]);
  st.hands[first] = ofKind((c) => c.kind === "money").slice(0, 11);
  st.deck = st.deck.filter((x) => !st.hands[first].includes(x));
  for (let i = 0; i < 3; i++) act(st, first, { type: "bank", card: st.hands[first][0] });
  assert.throws(() => act(st, first, { type: "bank", card: st.hands[first][0] }), /3 plays/);
  assert.throws(() => act(st, first, { type: "end" }), /Discard 1/);
  act(st, first, { type: "end", discard: [st.hands[first][0]] });
  assert.equal(st.hands[first].length, 7);
  assert.equal(st.hands[second].length, 7); // drew 2
  st.deck.push(...st.hands[first]); st.hands[first] = [];
  act(st, second, { type: "end", discard: [] });
  assert.equal(st.hands[first].length, 5); // empty hand draws 5
});

test('rent: two-colour card charges everyone, wild charges one, double rent doubles', () => {
  const st = game(3);
  put(st, 'a', 'db', [byName('Delhi'), byName('Mumbai')]);
  bank(st, 'b', ofKind((c) => c.kind === 'money' && c.v === 10));
  bank(st, 'c', ofKind((c) => c.kind === 'money' && c.v === 5));
  const rent = ofKind((c) => c.kind === 'rent' && Array.isArray(c.cs) && c.cs.includes('db'))[0];
  const dbl = ofKind((c) => c.a === 'double')[0];
  give(st, 'a', [rent, dbl]);
  act(st, 'a', { type: 'action', card: rent, color: 'db', doubles: [dbl] });
  assert.equal(st.pending.amount, 16);
  assert.equal(st.plays, 2);
  assert.equal(st.pending.target, 'b');
  act(st, 'b', { type: 'pay', cards: st.bank.b });
  assert.equal(st.pending.target, 'c');
  act(st, 'c', { type: 'pay', cards: st.bank.c }); // only has 5+5 = 10, pays everything
  assert.equal(st.pending, null);
  assert.equal(E.bankTotal(st, 'a'), 20);
});

test('you must pay with everything when short, no change given, properties can pay', () => {
  const st = game(2);
  bank(st, 'b', [ofKind((c) => c.kind === 'money' && c.v === 1)[0]]);
  put(st, 'b', 'gr', [byName('Kolkata')]);
  const v = ofKind((c) => c.a === 'vasooli')[0];
  give(st, 'a', [v]);
  act(st, 'a', { type: 'action', card: v, target: 'b' });
  assert.throws(() => act(st, 'b', { type: 'pay', cards: [st.bank.b[0]] }), /Pay with everything|You owe/);
  act(st, 'b', { type: 'pay', cards: [st.bank.b[0], byName('Kolkata')] });
  assert.deepEqual(st.table.a.gr, [byName('Kolkata')]);
});

test('No Deal cancels, and a No Deal back un-cancels', () => {
  const st = game(2);
  put(st, 'b', 'rd', [byName('Goa')]);
  const grab = ofKind((c) => c.a === 'grab')[0];
  const [n1, n2] = ofKind((c) => c.a === 'no');
  give(st, 'a', [grab, n2]);
  give(st, 'b', [n1]);
  act(st, 'a', { type: 'action', card: grab, target: 'b', prop: byName('Goa') });
  act(st, 'b', { type: 'no', card: n1 });
  assert.equal(st.pending.waiting, 'from');
  act(st, 'a', { type: 'no', card: n2 });
  assert.equal(st.pending.waiting, 'target');
  act(st, 'b', { type: 'accept' });
  assert.deepEqual(st.table.a.rd, [byName('Goa')]);
  assert.equal(st.table.b.rd, undefined);
});

test('Sneaky Grab cannot touch a full set; Takeover takes it with buildings', () => {
  const st = game(2);
  put(st, 'b', 'db', [byName('Delhi'), byName('Mumbai')]);
  const house = ofKind((c) => c.a === 'house')[0];
  st.bld.b.db = { house, hotel: null };
  st.deck = st.deck.filter((x) => x !== house);
  const grab = ofKind((c) => c.a === 'grab')[0];
  const take = ofKind((c) => c.a === 'takeover')[0];
  give(st, 'a', [grab, take]);
  assert.throws(() => act(st, 'a', { type: 'action', card: grab, target: 'b', prop: byName('Delhi') }), /full set/);
  act(st, 'a', { type: 'action', card: take, target: 'b', color: 'db' });
  act(st, 'b', { type: 'accept' });
  assert.equal(st.table.a.db.length, 2);
  assert.equal(st.bld.a.db.house, house);
  assert.equal(E.rentFor(st, 'a', 'db'), 11);
});

test('three full sets of different colours wins', () => {
  const st = game(2);
  put(st, 'a', 'db', [byName('Delhi'), byName('Mumbai')]);
  put(st, 'a', 'br', [byName('Shimla'), byName('Ooty')]);
  put(st, 'a', 'ut', [byName('Bijli Board')]);
  give(st, 'a', [byName('Jal Board')]);
  act(st, 'a', { type: 'property', card: byName('Jal Board') });
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 'a');
});

test('a set of only Any Colour wilds is not a full set', () => {
  const st = game(2);
  put(st, 'a', 'br', ofKind((c) => c.kind === 'wild' && c.cs === 'any'));
  assert.deepEqual(E.fullSets(st, 'a'), []);
});

test('bots finish hundreds of games without losing or duplicating a card', () => {
  for (let g = 0; g < 120; g++) {
    const st = E.createTable('T', 'h', 'Host'); st.players[0].bot = true;
    for (let k = 0; k < 1 + (g % 4); k++) E.dispatch(st, 'h', { type: 'addBot' }, 0);
    E.dispatch(st, 'h', { type: 'start' }, 0);
    let t = 0;
    while (st.phase === 'play' && t < 2e7) {
      t += 1000; E.runBots(st, t);
      let n = st.deck.length + st.discard.length;
      for (const p of st.players) { n += st.hands[p.uid].length + st.bank[p.uid].length; for (const ids of Object.values(st.table[p.uid])) n += ids.length; for (const b of Object.values(st.bld[p.uid])) n += (b.house != null) + (b.hotel != null); }
      assert.equal(n, 106);
    }
    assert.equal(st.phase, 'over');
  }
});
