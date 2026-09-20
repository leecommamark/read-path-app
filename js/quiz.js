// quiz.js — the shared 4-choice quiz component (learn batch, review, Due)
// and the review tab that starts it over everything still unacquired.
// ---------- shared quiz component ----------
// queue entries are card keys {char, jp}. Cards that already exist in the
// SRS store (Due deck, lapsed cards) are graded per answer; fresh pairs
// graduate on a session streak of 2 (streaks never persist any more).
let quiz = null;   // {queue, onDone, due, whole, done, w}
const sessionStreaks = new Map();

// `whole` marks a quiz over everything still unacquired in the text — the
// Review tab. The learn batch is five cards and the Due deck is a real count
// of cards actually due, so both can honestly say how many are left; the
// Review pool is 1,135 on a long text, and counting it down was a promise the
// app could not keep (plan 7 Phase 1).
function startQuiz(keys, slot, onDone, due, whole) {
  quiz = {queue: [...keys], onDone, due, whole, done: 0};
  $(slot).appendChild($('quizbox'));
  $('quizbox').style.display = '';
  nextQuestion();
}

// the longest word in the text that uses the card's reading for its character —
// never a word where the character reads differently (彷彿 must not stand
// in for 彷:pong4)
function contextWord(cur) {
  let best = null;
  if (!page) return null;
  for (const l of page.lines) {
    if (l.blank) continue;
    for (const p of l.parts)
      if (p.type === 'word' && p.word.length > 1 &&
          p.chars.some(c => c.char === cur.char && c.jp === cur.jp))
        if (!best || p.word.length > best.word.length) best = p;
  }
  return best;
}

// fallback context: the reading's dictionary example word, shaped like a
// line part so the renderer needn't care where the word came from
function exampleWord(cur) {
  const r = info[cur.char]?.readings?.find(x => x.jp === cur.jp);
  const ex = r && dictExamples(r)[0];
  if (!ex) return null;
  const syls = ex.jp.split(' ');
  return {type: 'word', word: ex.word, gloss: ex.gloss,
          chars: [...ex.word].map((ch, i) => ({char: ch, jp: syls[i] || ''}))};
}

function renderQWord(w, cur) {
  const card = (ch, jp, target) => `
    <span class="qw-card${target ? ' target' : ''}">
      <span class="qc-jp">${target || !jp ? '' : esc(jp)}</span>
      <span class="qc-char">${esc(ch)}</span>
    </span>`;
  if (!w) return card(cur.char, '', true);
  // "as written" carries into this text's own quiz words (glyphs only —
  // scoring and known-state stay on the traditional char). The Due deck
  // always shows traditional: its context words may come from another
  // text's page (documented simplification, DESIGN.md).
  const aw = !quiz.due && curText()?.asWritten;
  const glyph = c => aw && c.src ? c.src : c.char;
  // every occurrence of the target character is masked (疊字); neighbours
  // show jyutping exactly when the reader still would
  return w.chars.map(c => c.char === cur.char
    ? card(glyph(c), '', true)
    : card(glyph(c), isKnownKey(c.char, cardJp(info[c.char], c.jp)) ? '' : c.jp,
           false)).join('');
}

function makeChoices(cur, w) {
  const correct = cur.jp;
  const own = (info[cur.char]?.readings || []).filter(r => !r.variant_of)
    .map(r => r.jp).filter(r => r && r !== correct);
  const ownSet = new Set(own);
  // the target's own 變調 forms are half-right answers — never offer them
  const ownVar = new Set((info[cur.char]?.readings || [])
    .filter(r => r.variant_of).map(r => r.jp));
  // a choice equal to a visible neighbour's jyutping would give itself away
  const visible = new Set((w ? w.chars : [])
    .filter(c => c.char !== cur.char && c.jp &&
                 !isKnownKey(c.char, cardJp(info[c.char], c.jp)))
    .map(c => c.jp));
  const pool = [...new Set([
    ...own,      // the character's other readings — the best distractors
    ...(page ? page.chars.flatMap(x => (x.readings || []).map(r => r.jp)) : []),
  ])].filter(r => r && r !== correct && !visible.has(r) && !ownVar.has(r));
  const base = r => r.replace(/[1-6]$/, '');
  pool.sort((a, b) =>
    ownSet.has(b) - ownSet.has(a) ||
    (base(b) === base(correct)) - (base(a) === base(correct)) ||
    (b[0] === correct[0]) - (a[0] === correct[0]) || Math.random() - .5);
  const picks = pool.slice(0, 3);
  let tone = 1;
  while (picks.length < 3 && tone <= 6) {
    const m = base(correct) + tone++;
    if (m !== correct && !picks.includes(m) && !visible.has(m) && !ownVar.has(m))
      picks.push(m);
  }
  return shuffle([correct, ...picks]);
}

let answered = false;

function nextQuestion() {
  answered = false;
  $('feedback').style.display = 'none'; $('qnext').style.display = 'none';
  if (!quiz.queue.length) { $('quizbox').style.display = 'none'; quiz.onDone(); return; }
  const cur = quiz.queue[0];
  if (quiz.due) dueContext(cur);
  const w = quiz.w = contextWord(cur) || exampleWord(cur);
  $('qprogress').textContent = (quiz.whole
    ? `${quiz.done} answered · ${coverageOf(covRows)}% readable`
    : `${quiz.queue.length} to go`) + ` · how do you say the marked character?`;
  $('qword').innerHTML = renderQWord(w, cur);
  $('qchoices').innerHTML = makeChoices(cur, w).map(r =>
    `<button data-r="${esc(r)}">${esc(r)}</button>`).join('');
  document.querySelectorAll('#qchoices button').forEach(b =>
    b.onclick = () => answer(b));
}

function answer(btn) {
  if (answered) return;
  answered = true;
  quiz.done++;
  const cur = quiz.queue[0];
  const key = keyOf(cur.char, cur.jp);
  const c = info[cur.char];
  const right = btn.dataset.r === cur.jp;
  document.querySelectorAll('#qchoices button').forEach(b => {
    if (b.dataset.r === cur.jp) b.classList.add('right');
    else if (b === btn) b.classList.add('wrong');
    b.disabled = true;
  });
  const hadCard = !!cards[key];
  if (hadCard) {
    gradeCard(key, right);                    // a real review — walk the ladder
  } else {
    sessionStreaks.set(key, right ? (sessionStreaks.get(key) || 0) + 1 : 0);
    if (right && sessionStreaks.get(key) >= 2)
      mintCard(key, 0);                       // acquired — first review tomorrow
  }
  quiz.queue.shift();
  if (!isKnownKey(cur.char, cur.jp)) {        // still unacquired — requeue
    if (right) quiz.queue.splice(Math.min(3, quiz.queue.length), 0, cur);
    else quiz.queue.push(cur);                // wrong → the back, never next-up
  }
  let note = '';
  if (right && hadCard) note = ` — next review in ${LADDER[cards[key].rung]} d`;
  else if (right && cards[key]) note = ' — acquired! first review tomorrow';
  else if (right) note = ' — once more to acquire it';
  else if (hadCard) note = ' — back to the start of the ladder';
  // the answered reading's full section — the same gloss → text line →
  // dictionary words the learn card shows (Due deck: traditional glyphs)
  const rrow = c?.readings?.find(r => r.jp === cur.jp);
  $('feedback').style.display = '';
  $('feedback').innerHTML = `
    <span class="f-verdict ${right ? 'ok' : 'no'}">${right ? '✓' : '✗'}
      ${esc(cur.char)} ${esc(cur.jp)}</span>
    ${note}
    ${rrow ? readingSection(cur, rrow, c, !!quiz.due)
           : `<div class="f-meta">${esc(c?.gloss || '')}</div>`}
    ${c ? mnemonicBlock(c) : ''}`;
  $('qnext').style.display = '';
  $('qnext').focus();
  updateMeter();
}
$('qnext').onclick = () => nextQuestion();

// ---------- review: plain quiz over everything unacquired ----------
function startReviewMode() {
  $('reviewDone').style.display = 'none';
  const pool = unacquiredKeys();
  if (!pool.length) {
    $('quizbox').style.display = 'none';
    $('reviewDone').style.display = '';
    return;
  }
  startQuiz(pool, 'reviewQuizSlot', () => $('reviewDone').style.display = '',
            false, true);
}
