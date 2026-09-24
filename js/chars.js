// chars.js — the Characters screen: the standalone learning-order list and
// the binary-search placement test.
// ---------- characters screen + placement test ----------
$('toChars').onclick = () => openChars();
$('charsBack').onclick = () => renderLibrary();

async function openChars() {
  show('charscreen');
  if (!charlist) {
    $('charStats').textContent = 'Loading the learning order…';
    // the same stamp as `analyse`: shipped table or server, never a probe.
    // The shipped table is the same rows GET /api/charlist answers with,
    // built from output/order.csv by tools/build_dist.py.
    //
    // This is the second of the two doors into the tables (analyse() is the
    // other). Since plan 9.1 Phase 2 the install runs behind the first-run
    // screen, and "Take the placement test" is one tap away from that screen,
    // so it may well arrive first. The line above is already the right thing
    // to say while waiting. The catch is new: without one a failed install
    // left this screen saying "Loading the learning order…" for ever.
    try {
      if (BUILD_MODE === 'device') {
        await tablesReady;
        // positional, in pathbuilder.CHARLIST_FIELDS order
        charlist = ANALYSIS.tables().charlist.map(
          r => ({char: r[0], rank: r[1], reading: r[2], gloss: r[3],
                 wrank: r[4]}));
      } else {
        charlist = await (await fetch('api/charlist')).json();
      }
    } catch (e) {
      $('charStats').textContent =
        'Could not load the learning order — ' + e.message;
      return;
    }
  }
  renderCharList();
}

function renderCharList() {
  $('charStats').textContent =
    `${knownChars.size} known of ${charlist.length} in the learning order.`;
  $('charTokens').innerHTML = charlist.map(c => `
    <span class="token${isKnownChar(c.char) ? ' known' : ''}" data-char="${esc(c.char)}"
      data-jp="${esc(c.reading || '')}"
      title="#${c.rank} ${esc(c.reading || '?')} — ${esc(c.gloss || '')}">${esc(c.char)}</span>`).join('');
}
// Sound-track cards only, and the count and the wording both say so. This
// button sits under a grid of 3,000 characters and offers to clear it, so its
// scope is that grid — which is the principle plan 10 Phase 5 was reaching
// for when it wrote "silently deleting progress a screen does not show is
// worse than leaving it". That reasoning held while the meaning track had
// nowhere of its own; since plan 13 it has a screen, and each surface clears
// what it shows.
$('deselectAll').onclick = () => {
  const keys = Object.keys(cards).filter(k => !isMeaningKey(k));
  if (!keys.length) return;
  if (!confirm(`Delete all ${keys.length} character card${keys.length === 1 ? '' : 's'}? `
    + 'This wipes the reading schedule for every text. Meaning parts and '
    + 'tell-apart families have their own screen and are not touched.')) return;
  for (const k of keys) delete cards[k];
  saveCards();
  renderCharList();
};
$('charTokens').onclick = e => {              // delegated: 3,000 tokens
  const el = e.target.closest('.token');
  if (!el) return;
  const ch = el.dataset.char;
  if (isKnownChar(ch)) {                      // off = forget every reading of it
    for (const k of cardsOf(ch)) delete cards[k];
    saveCards();
  } else if (el.dataset.jp) {                 // on = its primary reading, mature
    mintCard(keyOf(ch, el.dataset.jp), MATURE_RUNG);
  }
  el.classList.toggle('known', isKnownChar(ch));
  $('charStats').textContent =
    `${knownChars.size} known of ${charlist.length} in the learning order.`;
};

// placement: binary search on the learner's frontier, but forgiving — each
// level asks up to 3 characters from the same band and moves on the majority
// (first two answers agreeing skip the third), so one careless tap or one
// unlucky rare character can't halve the estimate on its own.
// "I don't know this one" is an explicit miss: with four choices a guess is
// right a quarter of the time, which pushes the frontier estimate too far
// down the order, so the honest answer gets its own button.
//
// WHAT IT SEARCHES, since plan 9.2: written-Chinese frequency (`wrank`), not
// the learning order. The testers are heritage speakers with some Chinese
// school — they read the commonest characters of standard written Chinese,
// and they did not learn them in this project's order, which deliberately
// differs from school order most at the start. The learning order itself is
// untouched: the queue keeps its order and skips what placement marked known,
// and the grid above still draws all 3,000 in learning order, so after "Mark
// those N" the known tokens are scattered through it rather than a solid
// block at the top. That is expected.
let pt = null;   // {lo, hi, level, levelResults, results: [{char, right}]}
const PT_LEVELS = 7;

// The pool: the characters standard written Chinese actually uses, commonest
// first. The 71 with no written count carry no `wrank` (pathbuilder.py), and
// they are exactly the bound components and the colloquial characters — 辶,
// 佢, 咁 — which nobody learned at Chinese school. So they are neither asked
// about nor marked known, and the search's upper bound is this list's length
// rather than charlist's. Cached: charlist is loaded once and never mutated.
let ptOrder = null;
function placementOrder() {
  if (!ptOrder)
    ptOrder = charlist.filter(c => c.wrank && c.reading)
                      .sort((a, b) => a.wrank - b.wrank);
  return ptOrder;
}

$('ptStart').onclick = () => {
  pt = {lo: 0, hi: placementOrder().length, level: 0, levelResults: [], results: []};
  $('ptStart').style.display = 'none'; $('ptResult').style.display = 'none';
  $('ptQuiz').style.display = '';
  askPlacement();
};

function askPlacement() {
  if (pt.level >= PT_LEVELS || pt.hi - pt.lo < 20) return finishPlacement();
  const mid = Math.floor((pt.lo + pt.hi) / 2);
  const band = placementOrder().slice(Math.max(0, mid - 40), mid + 40)
    .filter(c => !pt.results.some(r => r.char === c.char));
  const c = band[Math.floor(Math.random() * band.length)];
  if (!c) return finishPlacement();
  pt.cur = {c, mid};
  $('ptProgress').textContent =
    `Level ${pt.level + 1} of ${PT_LEVELS}, question ${pt.levelResults.length + 1} — how is this pronounced?`;
  $('ptChar').textContent = c.char;
  const pool = shuffle(charlist.filter(x => x.reading && x.reading !== c.reading)
    .map(x => x.reading));
  const choices = shuffle([c.reading, ...[...new Set(pool)].slice(0, 3)]);
  $('ptChoices').innerHTML = choices.map(r =>
    `<button data-r="${esc(r)}">${esc(r)}</button>`).join('');
  document.querySelectorAll('#ptChoices button').forEach(b => b.onclick = () =>
    answerPlacement(b.dataset.r === pt.cur.c.reading));
}

// one answer, however it arrived — a chosen jyutping or "I don't know this
// one" (always a miss, and it lapses the character's cards like any other
// wrong answer does, in applyPtResults below)
function answerPlacement(right) {
  if (!pt || !pt.cur) return;
  pt.results.push({char: pt.cur.c.char, right});
  pt.levelResults.push(right);
  const wins = pt.levelResults.filter(Boolean).length;
  const losses = pt.levelResults.length - wins;
  if (wins === 2 || losses === 2) {             // majority settled
    wins === 2 ? pt.lo = pt.cur.mid : pt.hi = pt.cur.mid;
    pt.level++;
    pt.levelResults = [];
  }
  askPlacement();
}
$('ptUnknown').onclick = () => answerPlacement(false);

function finishPlacement() {
  pt.cur = null;                                // no stray answer after the end
  $('ptQuiz').style.display = 'none';
  const n = pt.lo;
  const nRight = pt.results.filter(r => r.right).length;
  $('ptResult').style.display = '';
  $('ptResult').innerHTML = `
    <p>${nRight}/${pt.results.length} correct. Estimated frontier: you can read
    roughly the <b>${n}</b> most common characters in written Chinese.</p>
    <button id="ptApply">Mark those ${n} as known</button>
    <button id="ptRetry">Retry</button>
    <p class="hint">Characters you answered wrong go back for review either way;
    right answers are marked known either way.</p>`;
  $('ptApply').onclick = () => {
    for (const c of placementOrder().slice(0, n))
      if (!isKnownChar(c.char))                 // never downgrade an existing card
        cards[keyOf(c.char, c.reading)] = newCard(MATURE_RUNG);
    saveCards();
    applyPtResults(); renderCharList();
    $('ptResult').style.display = 'none'; $('ptStart').style.display = '';
  };
  $('ptRetry').onclick = () => { applyPtResults(); $('ptStart').click(); };
  applyPtResults();

  function applyPtResults() {
    // right = enter at the mature rung (if not already carded); wrong = a
    // lapse of whatever cards exist — never a deletion, scheduling history
    // survives a bad day
    const now = Date.now();
    for (const r of pt.results) {
      if (r.right) {
        const cl = charlist.find(c => c.char === r.char);
        if (cl?.reading && !isKnownChar(r.char))
          cards[keyOf(r.char, cl.reading)] = newCard(MATURE_RUNG);
      } else {
        for (const k of cardsOf(r.char)) {
          const c = cards[k];
          c.rung = 0; c.due = now; c.last = now; c.lapses++;
        }
      }
    }
    saveCards();
  }
}
