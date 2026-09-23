// readings.js — the per-reading sections of a character's card.
//
// Patch plan 9 Phase 4b, mirroring reading_rows.readings_row. Every reading
// the card should teach, each with its dictionary example words, its gloss,
// and the 高升變調 fold that keeps a changed-tone reading from becoming a card
// of its own. See DESIGN.md, "Learning unit = the (character, reading) pair".
//
// THE ORDER IS THE CONTRACT: in-text readings first by count, then the other
// attested ones in corpus order, then the sheet-only spellings. The primary
// is inserted at the boundary when it is not already there. Each of those is
// a stable sort in the Python and has to be one here.
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  // Cantonese 高升變調: a tone-2 reading whose base syllable also exists as a
  // clearly stronger reading of the same character is a changed-tone variant,
  // not a lexical polyphone (靜靜 zing2 <- 靜 zing6, 電話 waa2 <- 話 waa6).
  // Genuine tone-2 lexical readings (好 hou2, 少 siu2) are never caught: they
  // are the stronger reading, so no candidate base outranks them.
  function changedTones(order, entries) {
    const out = new Map();
    const base = s => (s && /[0-9]$/.test(s)) ? s.slice(0, -1) : s;
    for (const r of order) {
      if (!r.endsWith('2')) continue;
      const cands = order.filter(b =>
        b !== r && !b.endsWith('2') && base(b) === base(r) &&
        (entries[b] || 0) > Math.max(entries[r] || 0, 1));
      // Python's max() keeps the FIRST maximal element; reduce with a strict
      // `>` does the same, where `>=` would keep the last.
      if (cands.length)
        out.set(r, cands.reduce((a, b) =>
          (entries[b] || 0) > (entries[a] || 0) ? b : a));
    }
    return out;
  }

  A.readingsRow = function (ch, primary, ctxWords, winfo) {
    const row = A.charRow(ch);
    const att = (row && row.a) || [];
    const attSet = new Set(att);
    const ctxw = ctxWords.get(ch) || new Map();     // reading -> Map(word -> n)
    const dictOrder = ((row && row.r) || []).map(x => x[0]);
    const entries = Object.fromEntries(((row && row.r) || []));

    // in-text readings by summed count, stable over ctx_words insertion order
    const inText = A.stableSortBy([...ctxw.keys()], r =>
      [-[...ctxw.get(r).values()].reduce((a, b) => a + b, 0)]);
    const rest = dictOrder.filter(r => attSet.has(r) && !ctxw.has(r));
    const sheetOnly = att.filter(r => !ctxw.has(r) && !dictOrder.includes(r))
                         .sort(A.cmpCodePoint);
    const order = [...inText, ...rest, ...sheetOnly];
    if (primary && !order.includes(primary)) order.splice(inText.length, 0, primary);

    const variants = changedTones(order, entries);
    // the character-level gloss describes the dominant dictionary reading
    // (河 ho4 keeps "river" rather than inheriting 銀河's "Milky Way")
    const dominant = dictOrder.length ? dictOrder[0] : primary;

    const rows = order.map(r => {
      // every ctx_words word had a full dictionary jyutping when it was
      // recorded (analyse.py guards on it); single-char words fall back to
      // the reading itself
      const ws = A.stableSortBy([...(ctxw.get(r) || new Map()).keys()],
                                w => [-ctxw.get(r).get(w)]);
      const inTextWs = ws.map(w => ({
        word: w,
        jp: (A.cpLen(w) > 1 ? (A.word(w) || [])[0] : r) || r,
      }));
      // AND IT MUST HAVE A GLOSS — the mirror of reading_rows.py's gate
      // (Mark, 2026-09-22). 140 example words had none and shipped a learn
      // card with an empty meaning line. Python and JS both build this row,
      // so a filter in one and not the other is a parity failure, which is
      // exactly how this copy was found.
      const exs = (A.examples(A.key(ch, r)) || [])
        .map(e => ({word: e[0], jp: e[1], gloss: e[2]}))
        .filter(e => e.gloss);
      const pair = A.readingGloss(A.key(ch, r));    // [gloss, reading_sense]
      const cg = pair[0];
      let gl;
      if (r === dominant && cg) {
        gl = cg;
      } else {
        // a word the text already uses cannot be the gloss source
        const ex = exs.find(e => !winfo.has(e.word) && e.gloss);
        gl = pair[1] || (ex ? ex.gloss : null) || cg;
      }
      return {
        jp: r,
        in_text: inTextWs,
        attested: attSet.has(r),
        variant_of: variants.has(r) ? variants.get(r) : null,
        examples: exs,
        gloss: gl,
      };
    });

    // >= 2 readings each backed by more than one dictionary entry, 變調
    // variants excluded — a reading one dictionary lists once (拜 baai1, for
    // 拜拜) does not count
    const poly = !!row && ((row.r || []).filter(
      x => x[1] > 1 && !variants.has(x[0])).length >= 2);

    return [rows, poly];
  };
})(ANALYSIS);
