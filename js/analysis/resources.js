// resources.js — analyse.Resources, as table lookups.
//
// Patch plan 9 Phase 4a. The Python builds these from chars.tsv,
// char_jyutping_counts.json, the frequency lists and the gloss merge at
// import time and keeps a few hundred MB resident. Here they are already
// decided: build_dist precomputed every one of them, so what is left is the
// segmenter's loop and four lookups.
//
// `segment` is the reason the lexicon has to be resident rather than in the
// store — it tests membership at every position of every CJK run, thousands
// of times per text, synchronously.
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  const MAX_WORD = 6;          // analyse.py

  // Greedy longest match; anything unmatched becomes a single character.
  // segment_exclude is already subtracted from the shipped lexicon, because
  // the Python only ever tests `in lexicon and not in seg_exclude`
  // (analyse.py:144-152), so baking it is exact rather than an optimisation.
  //
  // Iterates CODE POINTS: `run` is given as an array of them, because a
  // substring taken with string indices would split an astral character in
  // half and then match nothing.
  A.segment = function (runCps) {
    const lex = A.lexicon();
    const out = [];
    let i = 0;
    while (i < runCps.length) {
      let hit = 0;
      for (let n = Math.min(MAX_WORD, runCps.length - i); n > 1; n--) {
        const w = runCps.slice(i, i + n).join('');
        if (lex.has(w)) { out.push(w); i += n; hit = n; break; }
      }
      if (!hit) { out.push(runCps[i]); i += 1; }
    }
    return out;
  };

  // Readings backed by more than one dictionary entry, plus the sheet
  // spellings some dictionary lists at all — precomputed, because the
  // arbitration rule is character-only (analyse.py:114-142).
  A.attested = ch => {
    const r = A.charRow(ch);
    return new Set((r && r.a) || []);
  };

  // The jyutping a segmented token evidences for its characters. A
  // multi-character token has the word's own dictionary jyutping; a
  // one-character token has no word context, so it reads as cantodict says
  // and, where cantodict is silent, by the dominant dictionary reading. Both
  // branches are baked: `tjp` on the character row is exactly
  // Resources.token_jyutping for the single-character case.
  A.tokenJyutping = w => {
    if (A.cpLen(w) > 1) {
      const e = A.word(w);
      return (e && e[0]) || '';
    }
    const r = A.charRow(w);
    return (r && r.tjp) || '';
  };

  // The dictionary gloss for a word, used for the tokens of the text.
  A.wordGloss = w => {
    const e = A.word(w);
    return (e && e[1]) || '';
  };

  // reading_of (analyse.py:184-188): the most common in-context reading,
  // else the first dictionary reading, else the order.csv reading, else "".
  // `ctx` is the character's reading counter, in first-occurrence order, so
  // most_common's tie-break falls out of the Map rather than needing a sort
  // key that does not exist in the Python either.
  A.readingOf = (ch, ctx) => {
    if (ctx && ctx.size) return A.mostCommon(ctx)[0][0];
    const r = A.charRow(ch);
    if (r && r.r && r.r.length) return r.r[0][0];
    return (r && r.or) || '';
  };

  A.rankOf = ch => {
    const r = A.charRow(ch);
    return r && typeof r.rk === 'number' ? r.rk : null;
  };

  // A character outside chars.tsv has no row but can still have a dictionary
  // gloss, which its chars[] row and its decomposition node both carry.
  A.charGloss = ch => {
    const r = A.charRow(ch);
    if (r && r.g) return r.g;
    return A.tables().offgloss[ch] || '';
  };

  // components, as analyse emits them: "".join(dc.parents), unordered here —
  // _order_components is applied by the card half, which is Phase 4b.
  A.parentsOf = ch => {
    const r = A.charRow(ch);
    return (r && r.p) || '';
  };

  // the direct phonetic, for colouring: the sheet's column, else the family
  // parent (analyse.py:196-212)
  A.phoneticOf = ch => {
    const r = A.charRow(ch);
    return (r && (r.ph || r.fp)) || '';
  };

  A.hasReadings = ch => {
    const r = A.charRow(ch);
    return !!(r && r.r && r.r.length);
  };
})(ANALYSIS);
