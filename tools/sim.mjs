import * as E from '../docs/engine.js';
let over=0, errs=0, turns=[];
for (let g=0; g<400; g++) {
  const st = E.createTable('T','h','Host'); st.players[0].bot=true;
  for (let k=0;k<1+(g%4);k++) E.dispatch(st,'h',{type:'addBot'},0);
  E.dispatch(st,'h',{type:'start'},0);
  let t=0, steps=0, nt=0;
  while (st.phase==='play' && steps<20000) {
    t+=1000; steps++;
    const before = st.turn;
    try { E.runBots(st,t); } catch(e){ errs++; if (errs<6) console.log('ERR',e.message, JSON.stringify(st.pending)); break; }
    if (st.turn!==before) nt++;
    // card conservation
    let n = st.deck.length + st.discard.length;
    for (const p of st.players) { n += st.hands[p.uid].length + st.bank[p.uid].length; for (const ids of Object.values(st.table[p.uid])) n += ids.length; for (const b of Object.values(st.bld[p.uid])) { if (b.house!=null) n++; if (b.hotel!=null) n++; } }
    if (n !== E.DECK_SIZE) { console.log('cards', n, 'step', steps); errs++; break; }
  }
  if (st.phase==='over') { over++; turns.push(nt); } else if (errs<6) console.log('stuck', steps, JSON.stringify(st.pending), st.plays);
}
turns.sort((a,b)=>a-b);
console.log({over, errs, medianTurns: turns[turns.length>>1], max: turns.at(-1)});
