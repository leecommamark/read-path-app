// buildpage.js — buildPage(text), mirroring pathbuilder.build_page.
//
// Patch plan 9, Phase 4a of two. The one bare global in the analyser, because
// that is the contract tools/parity.js documents; everything else is on
// ANALYSIS so it cannot collide with the twelve client files, which share one
// script scope and already have an `analyse`.
//
// Phase 4a filled v, tokens, distinct, normalized, script and prereq — what
// the counting pass determines. Phase 4b filled chars, families and lines,
// and with them the port is whole: parity reports zero diffs on every key of
// every fixture, which is the first point at which the device can be said to
// say what the Python says.
var ANALYSIS = ANALYSIS || {};

// Keep in sync with PAGE_V in pathbuilder.py and library.js.
ANALYSIS.PAGE_V = 16;
// How many "worth meeting first" rows the payload carries (PREREQ_MAX).
ANALYSIS.PREREQ_MAX = 40;

// ASYNC, AND THE TWO AWAITS ARE FORCED BY THE DATA. `words` and `cards` are
// read by key from IndexedDB in the browser — 58 MB and 29.6 MB of heap if
// they were held instead (measured, Phase 1) — but the lookups sit inside
// synchronous loops: tokenJyutping in the counting pass, cardOf in assembly.
// So the work splits where the dependencies split, and nowhere else:
//
//   normalise        resident tables only
//   segment          resident lexicon only          -> which words are needed
//   await warm       the word shards
//   count            needs word jyutping            -> which cards are needed
//   await warm       the cards
//   assemble         sync
//
// `A.warm` is a no-op in node, where tools/parity.js has everything resident,
// so there is one shape rather than one per environment.
async function buildPage(text) {
  const A = ANALYSIS;
  A.checkHash();                 // the shard hash must agree with the build

  const N = A.normalizeText(text);
  await A.warmWords(A.wordsNeeded(N.text));
  const R = A.analyse(N.text);
  await A.warmCards(R.chars.map(c => A.key(c.char, c.reading)));

  // winfo / cinfo: build_page's two lookups over what analyse() found. The
  // word's jyutping falls back to the in-context readings when the dictionary
  // has none or it does not line up 1:1, which is analyse.py:213-221.
  const cinfo = new Map(R.chars.map(c => [c.char, c]));
  const winfo = new Map();
  for (const [w, count] of R.wordCount) {
    const cp = A.cps(w);
    let jp = cp.length === 1 ? '' : A.tokenJyutping(w);
    if (!jp) jp = cp.map(ch => (cinfo.get(ch) || {}).reading || '?').join(' ');
    winfo.set(w, {word: w, count, jyutping: jp,
                  gloss: cp.length === 1 ? A.charGloss(w) : A.wordGloss(w)});
  }

  const chars = A.stableSortBy(
    R.chars.map(c => A.buildCharRow(c, N.srcOf, R.ctxWords, winfo)),
    c => [c.rank === null ? 1 : 0, c.rank || 0, -c.count]);
  const families = A.familiesOf(chars);
  const lines = A.linesOf(N.text, N.srcText, winfo, cinfo);
  A.attachLines(chars, lines);

  // analyse() sorts prereq by rank; build_page then caps and reshapes it.
  // `why` is a set in the Python and is emitted sorted; `for_` keeps its
  // insertion order and is capped at 6. The gloss is clipped to 48.
  const prereq = R.prereq.slice(0, A.PREREQ_MAX).map(e => ({
    char: e.char,
    jp: e.reading || '',
    gloss: (e.gloss || '').slice(0, 48),
    rank: e.rank,
    why: [...e.why].sort(),
    for_: e.for_.slice(0, 6),
  }));

  return {
    v: A.PAGE_V,
    tokens: R.tokens,
    distinct: R.chars.length,
    chars,
    families,
    lines,
    normalized: N.normalized,
    script: N.script,
    prereq,
  };
}
