// due.js — the Due deck: the day's due cards across all texts, run through
// the shared quiz with context borrowed from any cached text.
// ---------- due: the same quiz over every due card, across all texts ----------
let dueIx = [];        // [{id, ix}] — coverage indexes, for the context search
let duePageId = null;  // which text `page` is holding during a due run

// Sound-track keys only. Every key here is handed to the quiz, which reads it
// as `char:reading` and draws a character card from it — so a meaning-track
// key arriving in this deck would not be a wrong question, it would be a
// broken screen. The meaning track's own due items are dueMeaningKeys below,
// and plan 10 Phase 8 decides where they surface; until then they are
// scheduled and simply not offered, which is why this filter is the whole of
// the change and not a temporary one.
function dueKeys() {
  const now = Date.now();
  return Object.keys(cards)
    .filter(k => !isMeaningKey(k) && cards[k].due <= now)
    .sort((a, b) => cards[a].due - cards[b].due);
}

// A DUE card the deck can actually put in front of the learner. A form-of
// card always can — askPart falls back to the re-reading when it cannot build
// a question — but a family stops being askable the moment nothing in it can
// be a target, and `askTellApart` skips such an item without touching the
// card. Skipped and still due is a card that is counted for ever and never
// asked: delete every sound card and the button reads "Daily review (252)"
// while the deck opens, skips all 252 and says nothing is due (plan 13).
//
// The filter lives HERE, in the one function the button and the deck both
// call, so the two cannot drift apart again — which is the bug plan 10.1
// Phase 3 fixed by making the button count both tracks.
//
// Unknown counts as askable. Without the tables loaded there is no way to
// tell a live family from a dead one, and the library is deliberately not a
// door — `scheduleFamilies` is a no-op there while MEANING is null — so a
// cold render must not hide a scheduled card behind a table that has not
// arrived. That would be "Daily review (0)" again, from the other direction.
const famAskable = head => !meaningIndex() || familyQuizzable(head);

function dueMeaningKeys() {
  const now = Date.now();
  return Object.keys(cards)
    .filter(k => isMeaningKey(k) && cards[k].due <= now
                 && (meaningKind(k) !== 'fam' || famAskable(meaningOf(k))))
    .sort((a, b) => cards[a].due - cards[b].due);
}

// ---------- what is in the deck, and when the next one lands ----------
// A count alone does not tell a placed-out learner why their deck is 92
// tell-apart questions and no characters, and "nothing due" with no date
// reads as a broken screen rather than a finished one. Both are the same
// fix: say what the ladder is actually doing.
const DUE_KINDS = [['character', 'characters'],      // a sound-track key
                   ['family', 'families'],           // @fam: — tell-apart
                   ['meaning part', 'meaning parts']];  // @part: — form-of
function dueBreakdown(keys) {
  const n = [0, 0, 0];
  for (const k of keys) n[k.fam ? 1 : k.part ? 2 : 0]++;
  // a kind with none of its own is left out, never shown as "0 families"
  return n.map((c, i) => c ? `${c} ${DUE_KINDS[i][c === 1 ? 0 : 1]}` : '')
          .filter(Boolean).join(' · ');
}

// CALENDAR days, not elapsed ones. "in 2 days" for something 30 hours off
// is arithmetically true and is not what a learner reads it as; the
// question they are asking is which morning to come back on. Local
// midnight to local midnight, which is also what the ladder's own day
// boundaries feel like from the outside.
//
// One definition, because the meaning screen says the same thing per card
// (plan 13 Phase 3) and two of these would drift a day apart at midnight.
const midnight = t => { const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const calendarDays = (to, from) =>
  Math.round((midnight(to) - midnight(from === undefined ? Date.now() : from)) / DAY);

// The soonest `due` still ahead of us, across BOTH tracks — reduced rather
// than spread, because a library's card count is in the thousands and
// Math.min(...keys) is a stack overflow waiting for a big enough learner.
function nextDueText() {
  const now = Date.now();
  let soonest = Infinity;
  for (const k in cards) if (cards[k].due > now && cards[k].due < soonest)
    soonest = cards[k].due;
  if (soonest === Infinity) return '';
  const days = calendarDays(soonest, now);
  return days <= 0 ? 'Your next card falls due later today.'
       : days === 1 ? 'Your next card falls due tomorrow.'
       : `Your next card falls due in ${days} days.`;
}

function showDueDone() {
  const next = nextDueText();
  $('dueStats').textContent = '';
  $('dueDone').innerHTML = 'Nothing due right now.'
    + (next ? `<br><span class="dd-next">${next}</span>` : '');
  $('dueDone').style.display = '';
}

$('toDue').onclick = () => openDue();
$('dueBack').onclick = () => {
  page = null; info = null; duePageId = null;
  releaseTexts(dueIx.map(e => e.id));   // openDue warmed every candidate; give them back
  dueIx = [];
  renderLibrary();
};

// The one screen that had to grow an await (plan 8 Phase 2). dueContext, below,
// reads the store synchronously inside nextQuestion and cannot wait — so the
// warming happens here instead, where the deck's shape is already known: the
// due keys are the cards the deck will ask about, and dueIx is the set of texts
// it can borrow context from.
async function openDue() {
  show('due');
  duePageId = textId;   // arriving from a text: its payload is already loaded
  textId = null;
  try { await ensureMeaning(); } catch (e) { /* no meaning track this run */ }
  // The day's deck is both tracks. A meaning item carries no text context and
  // borrows none — it is global — so it is simply another entry in the queue.
  const keys = [...dueKeys().map(k => {
    const i = k.indexOf(':');
    return {char: k.slice(0, i), jp: k.slice(i + 1)};
  }), ...dueMeaningKeys().map(k => meaningKind(k) === 'fam'
    ? {fam: meaningOf(k)} : {part: meaningOf(k)})];
  if (!keys.length) {
    $('quizbox').style.display = 'none';
    showDueDone();
    return;
  }
  $('dueDone').style.display = 'none';
  $('dueStats').innerHTML =
    `${keys.length} card${keys.length > 1 ? 's' : ''} due across your library.`
    + `<br><span class="ds-kinds">${dueBreakdown(keys)}</span>`;
  dueIx = texts.map(s => ({id: s.id, ix: loadCov(s.id)})).filter(e => e.ix);
  // the cards for exactly the keys the deck will ask about, and the core and
  // lines of every text it could borrow from
  await warmCards(Object.keys(cards).filter(k => cards[k].due <= Date.now()));
  await warm(dueIx.flatMap(e => ['songpath.page.' + e.id, 'songpath.lines.' + e.id]));
  startQuiz(keys, 'dueQuizSlot', showDueDone, true);
}

// point page/info at a cached payload that can give this card context —
// ideally one where the card's reading actually occurs in the text. The
// search runs over the coverage indexes and only the text that wins is parsed
// as a payload; before plan 5 Phase 1 every cached text in the library was.
// Order is unchanged: a text the reading occurs in, else the one already
// loaded if it has the character at all, else any text that has it.
function dueContext(cur) {
  const fits = e => e.ix.chars.some(x => x.char === cur.char &&
    x.rs.some(r => r.jp === cur.jp && r.t));
  const weak = e => e.ix.chars.some(x => x.char === cur.char);
  const here = page ? dueIx.find(e => e.id === duePageId) : null;
  if (here && fits(here)) return;
  for (const pick of [...dueIx.filter(fits),
                      ...(here && weak(here) ? [here] : []),
                      ...dueIx.filter(weak)]) {
    if (pick.id === duePageId && page) return;
    const p = loadCoreLines(pick.id);
    if (p) {
      // whatever cards the shared store holds, and no more: this runs inside
      // nextQuestion and cannot wait. A card the store has lost costs the
      // mnemonic block, not the question — and that is still more than before
      // plan 5 Phase 2, when a text with no cached page gave a bare character.
      attachCharCards(p, readCharCards(p.chars.map(c => keyOf(c.char, c.reading))));
      page = p;
      info = Object.fromEntries(p.chars.map(c => [c.char, c]));
      duePageId = pick.id;
      return;
    }
    // indexed but the text's core or lines has been evicted since — drop it
    // and try the next,
    // rather than falling to a bare-char question while another text fits
    dueIx = dueIx.filter(e => e !== pick);
  }
  page = null; info = {}; duePageId = null;   // no context anywhere
}
