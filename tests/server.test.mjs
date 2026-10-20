// Online server tests against an in-memory stand-in for Firestore. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer, COL } from '../functions/server.js';

// Tiny fake of the Firestore calls the server uses. Transactions run one at a time, like Firestore retries make them behave.
function fakeDb() {
  const data = new Map();
  let queue = Promise.resolve();
  const ref = (path) => ({
    path,
    collection: (c) => col(path + '/' + c),
  });
  const col = (path) => ({
    path, isCol: true,
    doc: (id) => ({ ...ref(path + '/' + id), id }),
  });
  const tx = {
    async get(r) {
      if (r.isCol) {
        const docs = [...data.entries()].filter(([k]) => k.startsWith(r.path + '/') && !k.slice(r.path.length + 1).includes('/'))
          .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
        return { docs };
      }
      const v = data.get(r.path);
      return { exists: v !== undefined, data: () => v };
    },
    set(r, v) { data.set(r.path, structuredClone(v)); },
  };
  return {
    data,
    collection: (c) => col(c),
    runTransaction(fn) {
      const run = queue.then(() => {
        const snapshot = new Map(data);
        return fn(tx).catch((e) => { data.clear(); for (const [k, v] of snapshot) data.set(k, v); throw e; });
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

async function setup(n = 3) {
  const db = fakeDb();
  const s = makeServer(db);
  const r = await s.handle('u0', { op: 'create', name: 'Host' });
  const id = r.tableId;
  for (let i = 1; i < n; i++) await s.handle('u' + i, { op: 'join', tableId: id, name: 'P' + i });
  return { db, s, id };
}
const views = (db, id) => [...db.data.entries()].filter(([k]) => k.startsWith(`${COL}/${id}/views/`));

test('create, join, start; hands stay private', async () => {
  const { db, s, id } = await setup(3);
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'start' } });
  const secret = JSON.parse(db.data.get(`${COL}/${id}/secret/state`).json);
  for (const [k, v] of views(db, id)) {
    const uid = k.split('/').pop();
    const view = JSON.parse(v.json);
    assert.deepEqual(view.hand, secret.hands[uid]);
    assert.ok(!('deck' in view) && !('hands' in view));
    const raw = v.json;
    for (const other of Object.keys(secret.hands)) if (other !== uid) {
      // other hands appear only as counts
      assert.equal(view.players.find((p) => p.uid === other).cards, secret.hands[other].length);
    }
    assert.ok(!raw.includes('"hands"'));
  }
  await assert.rejects(s.handle('u9', { op: 'join', tableId: id, name: 'Late' }), /already started/);
});

test('only the player whose turn it is can play, and stale moves are refused', async () => {
  const { db, s, id } = await setup(2);
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'start' } });
  const st = JSON.parse(db.data.get(`${COL}/${id}/secret/state`).json);
  const turn = st.players[st.turn].uid, other = st.players[1 - st.turn].uid;
  await assert.rejects(s.handle(other, { op: 'act', tableId: id, action: { type: 'end' } }), /not your turn/);
  const r = await s.handle(turn, { op: 'act', tableId: id, action: { type: 'end', move: st.moveNo - 1 } });
  assert.equal(r.stale, true);
});

test('a whole online game finishes when everyone is on autopilot', async () => {
  const { db, s, id } = await setup(3);
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'start' } });
  for (const u of ['u0', 'u1', 'u2']) await s.handle(u, { op: 'act', tableId: id, action: { type: 'autopilot', on: true } });
  let now = Date.now();
  for (let i = 0; i < 4000; i++) {
    now += 1000;
    const r = await s.handle('u0', { op: 'tick', tableId: id }, now);
    if (r.view.phase === 'over') return;
  }
  assert.fail('game did not finish');
});
