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
  quiz.ta = null;
  $('feedback').style.display = 'none'; $('qnext').style.display = 'none';
  if (!quiz.queue.length) { $('quizbox').style.display = 'none'; quiz.onDone(); return; }
  const cur = quiz.queue[0];
  // the meaning track's two kinds. A form-of card has no question — nothing
  // about it is quizzed — so it is presented and stepped past; a family is
  // the tell-apart question.
  if (cur.part) return presentPart(cur);
  if (cur.fam) return askTellApart(cur);
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
  if (quiz.ta) return answerTellApart(btn);
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

// ---------- the tell-apart quiz (plan 10 Phase 7) ----------
// A different question from the sound track's, and deliberately the mirror of
// it: there the prompt is a character and the choices are readings; here the
// prompt is a SOUND and the choices are characters. 清 晴 請 情 all read cing,
// and what tells them apart is 氵 日 言 忄 — the thing the app has never
// taught.
//
// The prompt is a real Cantonese word containing the target, written in
// jyutping only with the target's syllable marked, because the choices are
// characters and writing the word in characters would give the answer away.
// The English gloss is behind a tap: shown by default it would turn a
// tell-apart question into a translation question.
//
// This builds and draws an item. WHEN one is offered is plan 10 Phase 8's.
const TA_CHOICES = 4;
const MEMBER_FIELDS = ['char', 'meaning_part', 'part_gloss', 'gloss',
                       'reading', 'syllable', 'words'];
const asMember = m => Object.fromEntries(MEMBER_FIELDS.map((k, i) => [k, m[i]]));

function tellApartFamily(head) {
  const row = MEANING && Array.isArray(MEANING.tellapart)
    && MEANING.tellapart.find(r => r[0] === head);
  return row && row[1] ? row : null;      // row[1] is the quiz gate
}

// the word whose OTHER characters the learner knows best — a prompt built
// from characters they can already read is a question about the target and
// not a second puzzle
function tellApartWord(m) {
  let best = null, bestScore = -1;
  for (const [w, jp, ix] of m.words || []) {
    const others = [...w].filter((_, i) => i !== ix);
    const score = others.filter(isKnownChar).length - others.length * 0.01;
    if (score > bestScore) { bestScore = score; best = {w, jp, ix}; }
  }
  return best;
}

function tellApartItem(head) {
  const row = tellApartFamily(head);
  if (!row) return null;
  const members = row[2].map(asMember);
  // Only a character the learner has met can be the target, and only one
  // whose meaning part has been introduced — decision I. A member that fails
  // either is still a fine DISTRACTOR: recognising it is not the ask.
  const targets = members.filter(
    m => metChar(m.char) && isPartKnown(m.meaning_part));
  if (!targets.length) return null;
  const target = targets[Math.floor(Math.random() * targets.length)];
  const others = members.filter(m => m.char !== target.char);
  // siblings that share the syllable first, tone aside: those are the ones a
  // sound cannot separate, which is the whole point of the question
  const same = shuffle(others.filter(m => m.syllable === target.syllable));
  const rest = shuffle(others.filter(m => m.syllable !== target.syllable));
  const distractors = [...same, ...rest].slice(0, TA_CHOICES - 1);
  if (!distractors.length) return null;
  return {head, target, distractors,
          choices: shuffle([target, ...distractors]),
          word: tellApartWord(target)};
}

function tellApartPromptHtml(item) {
  const w = item.word;
  if (!w)                                  // the brief's English fallback
    return `<div class="ta-prompt ta-en" lang="en">${esc(item.target.gloss)}</div>`;
  const syls = w.jp.split(' ').map((s, i) => i === w.ix
    ? `<b class="ta-mark">${esc(s)}</b>` : esc(s)).join(' ');
  // the word is NEVER written in characters: the choices are characters
  return `<div class="ta-prompt">${syls}</div>
    <div class="ta-hint"><a href="#" id="taGloss" lang="en">show meaning</a>
      <span id="taGlossText" class="ta-en" lang="en" style="display:none"></span></div>`;
}

// after an answer: the four characters with their meaning parts picked out
// and glossed — "氵 water — 清 clear". This is the teaching, not the score.
function tellApartWhyHtml(item) {
  return `<div class="ta-why">${item.choices.map(m => `
    <div class="ta-row${m.char === item.target.char ? ' ta-is' : ''}">
      <span class="ta-part">${esc(m.meaning_part)}</span>
      <span class="ta-pg" lang="en">${esc(m.part_gloss || '')}</span>
      <span class="ta-sep">—</span>
      <span class="ta-char">${esc(m.char)}</span>
      <span class="ta-cg" lang="en">${esc(m.gloss || '')}</span>
    </div>`).join('')}</div>`;
}

// ---------- the meaning track inside the quiz loop (plan 10 Phase 8b) ----------
// A form-of card in a review deck is a re-reading, not a test: no reading is
// quizzed, so there is nothing to get wrong. It is shown, graded right, and
// stepped past — which walks the ladder and pushes the next review out.
function presentPart(cur) {
  const row = semanticOf(cur.part);
  if (!row) { quiz.queue.shift(); return nextQuestion(); }
  answered = true;
  $('qprogress').textContent = `${quiz.queue.length} to go · a meaning part`;
  $('qword').innerHTML = partCardHtml(row);
  $('qchoices').innerHTML = '';
  quiz.done++;
  gradeCard(partKey(cur.part), true);
  quiz.queue.shift();
  $('feedback').style.display = 'none';
  $('qnext').style.display = '';
  $('qnext').focus();
}

function askTellApart(cur) {
  const item = tellApartItem(cur.fam);
  // a family can stop being quizzable between scheduling and asking — a
  // lapsed form-of card is the ordinary way. Skip rather than show nothing.
  if (!item) { quiz.queue.shift(); return nextQuestion(); }
  quiz.ta = item;
  $('qprogress').textContent =
    `${quiz.queue.length} to go · which character is it?`;
  $('qword').innerHTML = tellApartPromptHtml(item);
  $('qchoices').innerHTML = item.choices.map(m =>
    `<button data-c="${esc(m.char)}" class="ta-choice">${esc(m.char)}</button>`).join('');
  document.querySelectorAll('#qchoices button').forEach(b =>
    b.onclick = () => answer(b));
  const g = $('taGloss');
  if (g) g.onclick = ev => {
    ev.preventDefault();
    $('taGlossText').textContent = item.target.gloss || '';
    $('taGlossText').style.display = '';
    g.style.display = 'none';
  };
}

function answerTellApart(btn) {
  answered = true;
  quiz.done++;
  const item = quiz.ta;
  const right = btn.dataset.c === item.target.char;
  document.querySelectorAll('#qchoices button').forEach(b => {
    if (b.dataset.c === item.target.char) b.classList.add('right');
    else if (b === btn) b.classList.add('wrong');
    b.disabled = true;
  });
  // scheduled per FAMILY, not per item: the next review draws a fresh target,
  // so a learner cannot pass by memorising one question
  const key = famKey(item.head);
  if (cards[key]) gradeCard(key, right); else mintCard(key, right ? 0 : 0);
  quiz.queue.shift();
  if (!right) quiz.queue.push({fam: item.head});   // to the back, never next-up
  const note = cards[key] && right
    ? ` — next review in ${LADDER[cards[key].rung]} d` : '';
  $('feedback').style.display = '';
  $('feedback').innerHTML = `
    <span class="f-verdict ${right ? 'ok' : 'no'}">${right ? '✓' : '✗'}
      ${esc(item.target.char)}</span>${note}
    ${tellApartWhyHtml(item)}`;
  $('qnext').style.display = '';
  $('qnext').focus();
}
