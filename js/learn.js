// learn.js — the learn tab: batches of 5 presentation cards (sections from
// cardview.js), Prev/Next, and the "Already know this" action.
// ---------- learn: interleaved — present 5, quiz those 5, repeat ----------
const BATCH = 5;
let batch = [], learnI = 0;
// How much of each card in the batch has been revealed (plan 12 Phase 3).
// Per BATCH INDEX rather than per card, because it is a position in a
// sequence and not knowledge — stepping back to card 1 must not make the
// learner climb it again, and starting a new batch must start at the bottom.
let shownTo = [];

// THE SOUND PART AHEAD OF WHAT IT EXPLAINS (plan 12 Phase 2b). At most one
// per batch and always first, for the reason MEANING_PER_BATCH is one: five
// cards is the batch, and a batch that is mostly scaffolding is not a batch
// of five characters any more.
//
// ONE RULE FOR BOTH CASES. The head may be in this text or not — on
// prose_long, 272 of the 817 characters with a sound part have it beside them
// and 545 do not — and the difference is only where its row comes from:
// `info` for one, `page.heads` for the other, which the payload carries
// (Phase 2a) so this costs no request and no await. An earlier attempt pulled
// every in-text head to the front of the whole queue instead, which put
// 也 小 者 幾 in front of 的 在 一 上 and threw away the readability ordering
// that is the reason `unacquiredKeys` sorts at all. The queue keeps its
// order; one card steps in front of it.
function soundHeadItem(upcoming) {
  const heads = pageHeads();
  for (const k of upcoming) {
    const row = info[k.char];
    const head = row && row.phonetic;
    if (!head || head === k.char || metChar(head)) continue;
    // `for_` is the character in the text that earned it a place, which is
    // what the card says instead of a count of a text it is not in
    const inText = info[head];
    if (inText) {
      const jp = inText.reading;
      if (!jp || isKnownKey(head, jp)) continue;
      return {char: head, jp, head: true, inText: true, for_: k.char};
    }
    const hr = heads.get(head);
    if (hr && hr.reading)
      return {char: head, jp: hr.reading, row: hr, head: true, for_: k.char};
  }
  return null;
}

function startLearn() {
  $('quizbox').style.display = 'none';
  const pool = unacquiredKeys();
  // The meaning track is GLOBAL: its items belong to no text and surface in
  // whichever text's batch the learner is in when they fall due. They take
  // at most MEANING_PER_BATCH of the five — decision C — and they go FIRST,
  // because the whole timing rule is "introduced just before the family that
  // needs it", and after the characters is not before them.
  const sound = pool.slice(0, BATCH - MEANING_PER_BATCH);
  const parts = meaningForBatch(sound.map(k => k.char), MEANING_PER_BATCH);
  // at most one injected head per batch, for the reason MEANING_PER_BATCH is
  // one: five cards is the batch, and a batch that is mostly scaffolding is
  // not a batch of five characters any more
  const head = soundHeadItem(pool.slice(0, BATCH - parts.length));
  // an in-text head is in the queue as well, so it must not appear twice
  const queue = head && head.inText
    ? pool.filter(k => !(k.char === head.char && k.jp === head.jp))
    : pool;
  const rest = queue.slice(0, BATCH - parts.length - (head ? 1 : 0));
  if (!pool.length && !parts.length) {
    for (const el of ['learnPhase', 'learnCard', 'learnNav'])
      $(el).style.display = 'none';
    $('learnDone').style.display = '';
    return;
  }
  $('learnDone').style.display = 'none';
  // meaning parts, then the sound head, then the characters. Both kinds are
  // introduced just before what needs them, so both come before it.
  batch = [...parts.map(p => ({part: p})),
           ...(head ? [head] : []),
           ...rest.map(k => ({char: k.char, jp: k.jp}))];
  learnI = 0; shownTo = [];
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
  // a batch of one is ordinary, not an edge case: the last cards of a text,
  // or a lone meaning part. Both halves of the sentence have to agree with it.
  const meet = batch.length === 1
    ? 'Meet this card — then a quick quiz on it.'
    : `Meet these ${batch.length} cards — then a quick quiz on just them.`;
  $('learnPhase').textContent = meet +
    (then > was
      ? ` ${batch.length === 1 ? 'It takes' : 'They take'} this text `
        + `from ${was}% to ${then}% readable.`
      : ` You can read ${was}% of this text.`);
  const cur = batch[learnI];
  // A meaning-track item is global — it belongs to no text — so it takes the
  // early exit before anything reads `info`, which is this text's character
  // table. Plan 10 Phase 8 decides when one enters a batch; this only draws
  // what it is handed.
  if (cur.part) {
    // Offered means seen, and seen means carded. That is what stops the same
    // part being offered again from another text — the de-duplication is the
    // card itself, not a per-session list, so it survives a reload. Rung 0:
    // first review tomorrow, like any freshly acquired card.
    if (!cards[partKey(cur.part)]) mintCard(partKey(cur.part), 0);
    $('learnCard').innerHTML = partCardHtml(semanticOf(cur.part));
    $('learnPhase').textContent = meet;
    $('lPos').textContent = `${learnI + 1} / ${batch.length}`;
    $('lPrev').disabled = learnI === 0;
    $('lNext').textContent =
      learnI === batch.length - 1 ? 'Quiz these →' : 'Next →';
    return;
  }
  // this text's row, or the item's own where it has none — an injected sound
  // part is not in this text, and that is the ordinary case here
  const c = rowOf(cur);
  // simplified-source pairing: near = same skeleton once radicals fold
  // (learn both at once), far = a genuinely different shape to remember
  const pair = c.src
    ? `<div class="lc-src"><span class="s-badge">簡</span>
       <span class="lc-src-char">${esc(c.src)}</span> —
       ${c.src_class === 'near' ? 'near twin: learn both now'
                                : 'far form: a separate thing to remember'}</div>`
    : '';
  // ONE BEAT AT A TIME (plan 12 Phase 3). The character, its 簡 pairing and
  // the line saying why this card is here are the HEADER — they say what the
  // card is about, and withholding the glyph would make the parts beat a
  // riddle rather than a step. The count moved up here from the foot of the
  // old card for the same reason: on an injected sound part it reads "the
  // sound part of 清 — not in this text", which is the answer to the first
  // question the learner has and no use to them at the end. Everything that
  // follows is revealed in order, by a cue that asks the question the beat
  // answers. A card with nothing left to give shows no cue at all, which is
  // every card once it is fully climbed.
  const why = cur.head
    ? `<div class="lc-count" lang="en">the sound part of ${esc(cur.for_ || '')
       } — not in this text</div>`
    : `<div class="lc-count">${c.count}× in this text</div>`;
  const stages = cardStages(cur, c, false);
  const shown = Math.min(Math.max(shownTo[learnI] || 1, 1), stages.length);
  shownTo[learnI] = shown;
  $('learnCard').innerHTML = `
    <div class="lc-char">${esc(cur.char)}</div>
    ${pair}${why}
    ${stages.slice(0, shown).map(s => `<div class="lc-stage">${s.html}</div>`).join('')}
    ${shown < stages.length
      ? `<button type="button" class="lc-more">${esc(stages[shown].cue)}</button>`
      : ''}`;
  const more = $('learnCard').querySelector('.lc-more');
  if (more) more.onclick = revealStage;
  $('lPos').textContent = `${learnI + 1} / ${batch.length}`;
  $('lPrev').disabled = learnI === 0;
  $('lNext').textContent = learnI === batch.length - 1 ? 'Quiz these →' : 'Next →';
}

// the cue's own action. A named function rather than a closure over `shown`
// because the cue is REBUILT on every render — it is inside the card's
// innerHTML — and a headless check can call what the learner taps.
function revealStage() {
  shownTo[learnI] = (shownTo[learnI] || 1) + 1;
  renderLearnCard();
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

// A batch item's card key, which depends on its KIND. A meaning item has no
// character and no reading, so `keyOf(cur.char, cur.jp)` on one is the string
// `"undefined:"` — a key `isMeaningKey` cannot filter, `rebuildKnown` reads as
// a character called "undefined", and the Due deck hands to the quiz as a
// sound card. That is what this button did to every form-of card until plan
// 13 Phase 1.
const itemKey = it => it.part ? partKey(it.part) : keyOf(it.char, it.jp);

// secondary action: this exact (character, reading) pair is already known —
// or, on a form-of card, this shape's meaning is. One button, because it is
// one promise: leave the batch at the mature rung. Marking a PART known can
// make its families quizzable at the next door, which is correct and is what
// the meaning screen says out loud beside the same action.
// Mints at the mature rung, leaves the batch, and the batch refills from the
// unacquired pool (same ordering startLearn uses) — which is sound-track, so
// a part that leaves is not replaced by another part; meaningForBatch decides
// that at startLearn. Undo restores the card snapshot and the batch as it
// stood, current position included.
$('lKnow').onclick = () => {
  const cur = batch[learnI];
  if (!cur) return;
  const key = itemKey(cur);
  const snap = {key, card: cards[key] ? {...cards[key]} : null,
                batch: batch.slice(), learnI, shownTo: shownTo.slice()};
  if (cur.part) knowPart(cur.part); else mintCard(key, MATURE_RUNG);
  // how far each card is revealed is indexed by POSITION, so a card leaving
  // the batch takes its position with it or every card after it inherits
  // someone else's progress through the beats
  batch.splice(learnI, 1); shownTo.splice(learnI, 1);
  const have = new Set(batch.map(itemKey));
  for (const k of unacquiredKeys()) {
    if (batch.length >= BATCH) break;
    if (!have.has(keyOf(k.char, k.jp))) batch.push({char: k.char, jp: k.jp});
  }
  // what was marked, in the words the card used for it: a meaning part is not
  // a reading, and "辶 marked known" would claim the learner can read 辶
  showUndo(cur.part ? `meaning part ${cur.part} marked known`
                    : `${cur.char} ${cur.jp} marked known`, snap, s => {
    if (s.card) cards[s.key] = s.card; else delete cards[s.key];
    saveCards();
    batch = s.batch; learnI = s.learnI; shownTo = s.shownTo;
    renderLearnCard();
    updateMeter();
  });
  if (!batch.length) startLearn();         // pool exhausted — the done state
  else { learnI = Math.min(learnI, batch.length - 1); renderLearnCard(); }
  updateMeter();
};
