// due.js — the Due deck: the day's due cards across all texts, run through
// the shared quiz with context borrowed from any cached text.
// ---------- due: the same quiz over every due card, across all texts ----------
let dueIx = [];        // [{id, ix}] — coverage indexes, for the context search
let duePageId = null;  // which text `page` is holding during a due run

function dueKeys() {
  const now = Date.now();
  return Object.keys(cards).filter(k => cards[k].due <= now)
    .sort((a, b) => cards[a].due - cards[b].due);
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
  const keys = dueKeys().map(k => {
    const i = k.indexOf(':');
    return {char: k.slice(0, i), jp: k.slice(i + 1)};
  });
  if (!keys.length) {
    $('quizbox').style.display = 'none';
    $('dueStats').textContent = '';
    $('dueDone').style.display = '';
    return;
  }
  $('dueDone').style.display = 'none';
  $('dueStats').textContent =
    `${keys.length} card${keys.length > 1 ? 's' : ''} due across your library.`;
  dueIx = texts.map(s => ({id: s.id, ix: loadCov(s.id)})).filter(e => e.ix);
  // the cards for exactly the keys the deck will ask about, and the core and
  // lines of every text it could borrow from
  await warmCards(Object.keys(cards).filter(k => cards[k].due <= Date.now()));
  await warm(dueIx.flatMap(e => ['songpath.page.' + e.id, 'songpath.lines.' + e.id]));
  startQuiz(keys, 'dueQuizSlot', () => {
    $('dueStats').textContent = '';
    $('dueDone').style.display = '';
  }, true);
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
