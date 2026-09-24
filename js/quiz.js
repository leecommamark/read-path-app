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

// ONE CARD, BOTH QUESTIONS (plan 10.1 Phase 2). Jyutping small above,
// character large below; either cell may be empty, because the two questions
// blank opposite halves of it. The sound quiz blanks the JYUTPING and asks
// for it; the tell-apart quiz blanks the CHARACTER and asks for that. They
// are mirrors and DESIGN.md says so, so they are drawn by the same thing —
// before this the tell-apart prompt was a line of inline text and read as
// unfinished beside the card the sound quiz draws ("janky" — Mark, on the
// phone, 2026-09-21).
//
// `cls` carries the states: `target` (the slot being asked about, amber),
// `blank` (the character cell is an empty box to be filled).
function qwCard(ch, jp, cls) {
  return `
    <span class="qw-card${cls ? ' ' + cls : ''}">
      <span class="qc-jp">${jp ? esc(jp) : ''}</span>
      <span class="qc-char">${ch ? esc(ch) : ''}</span>
    </span>`;
}

function renderQWord(w, cur) {
  const card = (ch, jp, target) =>
    qwCard(ch, target ? '' : jp, target ? 'target' : '');
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
  quiz.ta = quiz.pt = null;
  $('feedback').style.display = 'none'; $('qnext').style.display = 'none';
  if (!quiz.queue.length) { $('quizbox').style.display = 'none'; quiz.onDone(); return; }
  const cur = quiz.queue[0];
  // the meaning track's two kinds. A form-of card has no question — nothing
  // about it is quizzed — so it is presented and stepped past; a family is
  // the tell-apart question.
  if (cur.part) return askPart(cur);
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
  if (quiz.pt) return answerPart(btn);
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
// The prompt is a real Cantonese word containing the target, drawn on the
// sound quiz's own card component: the target's slot is an empty box with its
// jyutping above it in amber, and the rest of the word is written out. The
// word's meaning sits beneath it.
//
// This builds and draws an item. WHEN one is offered is plan 10 Phase 8's.
const TA_CHOICES = 4;
const MEMBER_FIELDS = ['char', 'meaning_part', 'part_gloss', 'gloss',
                       'reading', 'syllable', 'words', 'twins'];
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
  for (const [w, jp, ix, gloss] of m.words || []) {
    const others = [...w].filter((_, i) => i !== ix);
    const score = others.filter(isKnownChar).length - others.length * 0.01;
    if (score > bestScore) { bestScore = score; best = {w, jp, ix, gloss}; }
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
  // A sibling glossed exactly as the target is never an answer beside it
  // (decision A-iii, 2026-09-21). 秘 and 祕 are both "secret", 漂 and 飄 both
  // "to float": with one of them on the answer row the question has two
  // right answers, and neither the word nor the English fallback can say
  // which was meant. The BUILD decides which those are and ships the list —
  // the same list its own prompt-word filter uses, so the two cannot drift.
  const others = members.filter(m => m.char !== target.char
                                  && !(target.twins || '').includes(m.char));
  // siblings that share the syllable first, tone aside: those are the ones a
  // sound cannot separate, which is the whole point of the question
  const same = shuffle(others.filter(m => m.syllable === target.syllable));
  const rest = shuffle(others.filter(m => m.syllable !== target.syllable));
  const distractors = [...same, ...rest].slice(0, TA_CHOICES - 1);
  if (!distractors.length) return null;
  return {head, headReading: row[3] || '', target, distractors,
          choices: shuffle([target, ...distractors]),
          word: tellApartWord(target)};
}

// The prompt, drawn on the sound quiz's own card (plan 10.1 Phase 2): every
// syllable of the word is a `.qw-card`, the target's card carries its
// jyutping in amber over an EMPTY box, and the learner fills the box by
// choosing. The rest of the word is written out.
//
// The rule about what may be shown is unchanged and is not "no characters":
// the target's own characters are the four choices, so writing the target
// would hand over the answer, but the rest of the word never could, and
// leaving it as bare jyutping made the prompt two puzzles instead of one
// ("cing1 co2" asked the learner to decode co2 first, for nothing). A
// context character that is ALSO one of the four answers is blanked the same
// way — jyutping over an empty box — but not in amber: it is not the slot
// being asked about. 10 of 251 prompts have one.
//
// The word's meaning sits UNDER the word, and is shown (decision A-i,
// 2026-09-21). Plan 10 hid it behind a tap so the question would not become a
// translation question — but that reasoning predates writing the context out
// in characters. It is the WORD's meaning and never the target's, so it
// cannot be the answer; and it is what makes "cing1 楚" a question at all.
const TA_WORD_FIELDS = ['word', 'jyutping', 'index', 'gloss'];
function tellApartPromptHtml(item) {
  const w = item.word;
  // The English fallback, in the same frame rather than a different layout:
  // one card, the target's own reading over the empty box, its meaning
  // beneath. The reading is shown here for the same reason it is shown on a
  // word prompt — it is what makes a differently-sounding sibling a fair
  // choice on a prompt that has no word to carry the sound.
  if (!w)
    return qwCard('', item.target.reading, 'target blank')
      + meaningHtml(item.target.gloss);
  const chars = [...w.w];
  const syls = w.jp.split(' ');
  const answers = new Set((item.choices || []).map(c => c.char));
  // A context character is glossed only where the learner would still need
  // it, which is the sound quiz's rule for neighbours. It asks `isKnownChar`
  // rather than the key-level `isKnownKey` the sound quiz uses: there is no
  // `info` here — a tell-apart item belongs to no text — and character level
  // is also the notion `tellApartWord` scored the word on, so the two agree
  // about which characters this prompt was built from.
  return chars.map((ch, i) => i === w.ix
    ? qwCard('', syls[i] || '', 'target blank')
    : answers.has(ch)
      ? qwCard('', syls[i] || '', 'blank')
      : qwCard(ch, isKnownChar(ch) ? '' : (syls[i] || ''), '')).join('')
    + meaningHtml(w.gloss);
}

// the meaning line under a prompt. `flex-basis: 100%` in the stylesheet is
// what puts it on its own row inside #qword's flex line, so this needs no
// wrapper of its own and #qword's rules are untouched.
const meaningHtml = g => g
  ? `<span class="qw-meaning" lang="en">${esc(g)}</span>` : '';

// after an answer: the four characters, said and glossed, each with the part
// that tells it apart — "清 cing1 clear — 氵 water". This is the teaching,
// not the score.
//
// THE CHARACTER LEADS (Mark, 2026-09-21). It used to be the part: "氵 water
// — 清 clear", which asks the reader to hold a shape they do not know yet
// before meeting the character it belongs to. The row now reads the way the
// thought goes — this character, said this way, means this, and the part
// that carries it is this — and it carries the JYUTPING, which the card had
// never shown even though every choice is a character with a reading.
const whyRow = (m, on) => `
    <div class="ta-row${on ? ' ta-is' : ''}">
      <span class="ta-char">${esc(m.char)}</span>
      <span class="ta-jp">${esc(m.reading || '')}</span>
      <span class="ta-cg" lang="en">${esc(m.gloss || '')}</span>
      <span class="ta-sep">—</span>
      <span class="ta-part">${esc(m.part)}</span>
      <span class="ta-pg" lang="en">${esc(m.part_gloss || '')}</span>
    </div>`;

function tellApartWhyHtml(item) {
  // The shared sound part, alone and first, and now with its own reading:
  // which component the four have in common is not obvious from four whole
  // characters — 清 晴 請 情 share 青 — and the sound they share is the whole
  // reason the question was hard.
  return `<div class="ta-why">
    <div class="ta-head">
      <span class="ta-head-label" lang="en">they all share</span>
      <span class="ta-head-char">${esc(item.head)}</span>
      <span class="ta-head-jp">${esc(item.headReading || '')}</span>
    </div>
    ${item.choices.map(m => whyRow(
      {char: m.char, reading: m.reading, gloss: m.gloss,
       part: m.meaning_part, part_gloss: m.part_gloss},
      m.char === item.target.char)).join('')}</div>`;
}

// ---------- the meaning track inside the quiz loop (plan 10 Phase 8b) ----------
// The form-of question (plan 10.1 Phase 5), the mirror of tell-apart within
// the same frame. There the prompt is a sound and the choices are characters;
// here the prompt is a MEANING and the choices are characters, exactly one of
// which contains the part that carries it. "Which of these has the part for
// movement?" — 過 冷 補 神.
//
// Until now a form-of card in a quiz was a re-reading: shown, graded right,
// stepped past. Nothing ever asked the learner anything about 辶, and
// acknowledging a shape's existence is not learning it (Mark, 2026-09-21).
// The answer is finding the shape inside a whole character, which is the
// skill the card claims to teach, and characters as the choices keep it the
// same shape as the tell-apart question.
const PART_CHOICES = 4;
const DISTRACTOR_FIELDS = ['char', 'part', 'part_gloss', 'gloss',
                           'confusable', 'reading'];
const asDistractor = d =>
  Object.fromEntries(DISTRACTOR_FIELDS.map((k, i) => [k, d[i]]));

function partItem(part) {
  const row = semanticOf(part);
  // A part with too few shippable wrong answers stays a re-reading. The
  // build guarantees three for every carded part today and refuses to ship
  // otherwise, so this is a guard against a future table, not a live case.
  if (!row || (row.distractors || []).length < PART_CHOICES - 1) return null;
  // the right answer: one of the part's own examples, known characters
  // first — recognising the part inside a character you already read is the
  // question; inside one you have never met is a different, harder one
  const ex = (row.examples || []).map(([ch, gloss, reading]) =>
    ({ch, gloss, reading}));
  if (!ex.length) return null;
  const known = ex.filter(e => isKnownChar(e.ch));
  const pick = shuffle(known.length ? known : ex)[0];
  // the target's part is glossed with the phrase the PROMPT used, so the
  // explanation closes the loop it opened — "the part for movement" then
  // "辶 movement — 這 this" — and reads the same length as the other three,
  // which carry the short role-gloss the build shipped
  const target = {char: pick.ch, part, part_gloss: row.asks,
                  gloss: pick.gloss, reading: pick.reading};
  // three wrong answers, drawn fresh each time so nobody memorises one
  // question. Curated confusables come first in the shipped pool and are
  // preferred here; no two from the same part, so the four choices are four
  // different shapes rather than one against three of another.
  const pool = row.distractors.map(asDistractor);
  const conf = shuffle(pool.filter(d => d.confusable));
  const rest = shuffle(pool.filter(d => !d.confusable));
  const distractors = [], used = new Set();
  for (const pass of [0, 1]) {            // one per part first, then fill
    for (const d of [...conf, ...rest]) {
      if (distractors.length >= PART_CHOICES - 1) break;
      if (distractors.includes(d)) continue;
      if (!pass && used.has(d.part)) continue;
      distractors.push(d);
      used.add(d.part);
    }
  }
  if (distractors.length < PART_CHOICES - 1) return null;
  return {part, row, target, distractors,
          choices: shuffle([target, ...distractors])};
}

// after an answer: the four characters with their parts picked out and
// glossed, the same rows the tell-apart explanation uses — minus its head
// line, since what these four share is nothing, which is the point.
function partWhyHtml(item) {
  // The same rows, and no head line — what these four share is nothing.
  // The COMPONENT still carries no reading here: 辶's caang1 has no
  // dictionary behind it, and teaching it is the mistake the form-of card
  // exists to undo. The four characters are ordinary characters and do.
  return `<div class="ta-why">${item.choices.map(m =>
    whyRow(m, m.char === item.target.char)).join('')}</div>`;
}

function askPart(cur) {
  const item = partItem(cur.part);
  // no question to put: fall back to the re-reading rather than show nothing
  if (!item) return presentPart(cur);
  quiz.pt = item;
  $('qprogress').textContent = `${quiz.queue.length} to go · a meaning part`;
  $('qword').innerHTML =
    `<span class="pq-ask" lang="en">Which of these has the part for` +
    ` <b>${esc(item.row.asks)}</b>?</span>`;
  $('qchoices').innerHTML = item.choices.map(m =>
    `<button data-c="${esc(m.char)}" class="ta-choice">${esc(m.char)}</button>`)
    .join('');
  document.querySelectorAll('#qchoices button').forEach(b =>
    b.onclick = () => answer(b));
}

function answerPart(btn) {
  answered = true;
  quiz.done++;
  const item = quiz.pt;
  const right = btn.dataset.c === item.target.char;
  document.querySelectorAll('#qchoices button').forEach(b => {
    if (b.dataset.c === item.target.char) b.classList.add('right');
    else if (b === btn) b.classList.add('wrong');
    b.disabled = true;
  });
  // Graded like a family, not like a fresh sound pair: the card already
  // exists — learn.js mints it the moment the part is SHOWN, which is what
  // stops it being offered again from another text — so every answer is a
  // real review and one right answer walks the ladder (decision B-i). A
  // wrong answer lapses it, and isPartKnown then withholds every family that
  // needs the part until it is answered right again. That rule is plan 10's
  // and is kept: askTellApart already skips a family that has stopped being
  // quizzable between scheduling and asking.
  const key = partKey(item.part);
  if (cards[key]) gradeCard(key, right); else mintCard(key, right ? 0 : 0);
  quiz.queue.shift();
  if (!right) quiz.queue.push({part: item.part});  // to the back, never next-up
  const note = cards[key] && right
    ? ` — next review in ${LADDER[cards[key].rung]} d` : '';
  $('feedback').style.display = '';
  $('feedback').innerHTML = `
    <span class="f-verdict ${right ? 'ok' : 'no'}">${right ? '✓' : '✗'}
      ${esc(item.target.char)}</span>${note}
    ${partWhyHtml(item)}`;
  $('qnext').style.display = '';
  $('qnext').focus();
}

// The fallback, and what every form-of card in a quiz used to be: shown,
// graded right, stepped past. Reached only when the shipped table cannot
// furnish three wrong answers.
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
  // lapsed form-of card is the ordinary way, and `p10-8b5` holds the two
  // predicates in step for the shipped table in the state it can check.
  // Skip rather than show nothing, and PARK it: a day out, rung, lapses and
  // `added` untouched. Skipping alone left the card due, so it came back to
  // be skipped again on every deck, counted every time and asked none of
  // them; parking takes it out of the count until something changes, without
  // deleting scheduling history that is the learner's (plan 13 Phase 2).
  if (!item) {
    const c = cards[famKey(cur.fam)];
    if (c) { c.due = Date.now() + DAY; saveCards(); }
    quiz.queue.shift();
    return nextQuestion();
  }
  quiz.ta = item;
  $('qprogress').textContent =
    `${quiz.queue.length} to go · which character is it?`;
  $('qword').innerHTML = tellApartPromptHtml(item);
  $('qchoices').innerHTML = item.choices.map(m =>
    `<button data-c="${esc(m.char)}" class="ta-choice">${esc(m.char)}</button>`).join('');
  document.querySelectorAll('#qchoices button').forEach(b =>
    b.onclick = () => answer(b));
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
