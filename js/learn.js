// learn.js — the learn tab: batches of 5 presentation cards (sections from
// cardview.js), Prev/Next, and the "Already know this" action.
// ---------- learn: interleaved — present 5, quiz those 5, repeat ----------
const BATCH = 5;
let batch = [], learnI = 0;

function startLearn() {
  $('quizbox').style.display = 'none';
  const pool = unacquiredKeys();
  if (!pool.length) {
    for (const el of ['learnPhase', 'learnCard', 'learnNav'])
      $(el).style.display = 'none';
    $('learnDone').style.display = '';
    return;
  }
  $('learnDone').style.display = 'none';
  batch = pool.slice(0, BATCH).map(k => ({char: k.char, jp: k.jp}));
  learnI = 0;
  renderLearnCard();
}

function renderLearnCard() {
  $('learnPhase').style.display = ''; $('learnCard').style.display = '';
  $('learnNav').style.display = '';
  // what these five buy, rather than how many thousand are behind them. The
  // queue on a long text is 1,135 pairs and saying so helps nobody; the
  // readability these cards add is the thing the ordering was chosen for.
  const was = coverageOf(covRows);
  const then = coverageOf(covRows, new Set(batch.map(b => keyOf(b.char, b.jp))));
  $('learnPhase').textContent =
    `Meet these ${batch.length} cards — then a quick quiz on just them.` +
    (then > was ? ` They take this text from ${was}% to ${then}% readable.`
                : ` You can read ${was}% of this text.`);
  const cur = batch[learnI];
  const c = info[cur.char];
  // Pleco layout: one section per reading, the card's own reading first —
  // each with its line from the text and dictionary words. A single-reading
  // character is simply one section.
  const all = c.readings || [{jp: c.reading, gloss: c.gloss, in_text: []}];
  const secs = all.filter(r => !r.variant_of)
    .sort((a, b) => (b.jp === cur.jp) - (a.jp === cur.jp));
  // simplified-source pairing: near = same skeleton once radicals fold
  // (learn both at once), far = a genuinely different shape to remember
  const pair = c.src
    ? `<div class="lc-src"><span class="s-badge">簡</span>
       <span class="lc-src-char">${esc(c.src)}</span> —
       ${c.src_class === 'near' ? 'near twin: learn both now'
                                : 'far form: a separate thing to remember'}</div>`
    : '';
  $('learnCard').innerHTML = `
    <div class="lc-char">${esc(cur.char)}</div>
    ${pair}
    ${secs.map(r => readingSection(cur, r, c, false)).join('')}
    ${mnemonicBlock(c)}
    <div class="lc-count">${c.count}× in this text</div>
    ${seriesBlock(c)}`;
  $('lPos').textContent = `${learnI + 1} / ${batch.length}`;
  $('lPrev').disabled = learnI === 0;
  $('lNext').textContent = learnI === batch.length - 1 ? 'Quiz these →' : 'Next →';
}

$('lPrev').onclick = () => { if (learnI > 0) { learnI--; renderLearnCard(); } };
$('lNext').onclick = () => {
  if (learnI < batch.length - 1) { learnI++; renderLearnCard(); return; }
  // presentation done — quiz just this batch, then fetch the next 5. A
  // pending "already know" undo must die here: restoring the batch mid-quiz
  // would render the learn card under the quiz.
  hideToast();
  for (const el of ['learnPhase', 'learnCard', 'learnNav'])
    $(el).style.display = 'none';
  startQuiz(batch, 'learnQuizSlot', () => startLearn());
};

// secondary action: this exact (character, reading) pair is already known.
// Mints at the mature rung, leaves the batch, and the batch refills from the
// unacquired pool (same ordering startLearn uses). Undo restores the card
// snapshot and the batch as it stood, current position included.
$('lKnow').onclick = () => {
  const cur = batch[learnI];
  if (!cur) return;
  const key = keyOf(cur.char, cur.jp);
  const snap = {key, card: cards[key] ? {...cards[key]} : null,
                batch: batch.slice(), learnI};
  mintCard(key, MATURE_RUNG);
  batch.splice(learnI, 1);
  const have = new Set(batch.map(b => keyOf(b.char, b.jp)));
  for (const k of unacquiredKeys()) {
    if (batch.length >= BATCH) break;
    if (!have.has(keyOf(k.char, k.jp))) batch.push({char: k.char, jp: k.jp});
  }
  showUndo(`${cur.char} ${cur.jp} marked known`, snap, s => {
    if (s.card) cards[s.key] = s.card; else delete cards[s.key];
    saveCards();
    batch = s.batch; learnI = s.learnI;
    renderLearnCard();
    updateMeter();
  });
  if (!batch.length) startLearn();         // pool exhausted — the done state
  else { learnI = Math.min(learnI, batch.length - 1); renderLearnCard(); }
  updateMeter();
};
