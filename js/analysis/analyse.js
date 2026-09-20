// analyse.js — the counting pass, mirroring analyse.analyse().
//
// Patch plan 9 Phase 4a. What does a learner need to read THIS text: segment
// every CJK run, count characters, record which reading each character
// evidences in context, and work out the prerequisites.
//
// ONLY WHAT build_page READS. analyse() also computes `sections` (the
// blank-line blocks, ranked), `to_learn` and a `phonetic` join on the word
// rows. build_page touches none of them — it takes tokens, chars, words,
// ctx_words and prereq — so they are not ported. `words` is reduced to what
// build_page actually reads off it: jyutping and gloss, keyed by word.
//
// THREE ORDERINGS REACH THE PAYLOAD and each is a one-line mistake here:
//   * char_count.most_common() is a stable sort by count descending, so ties
//     keep FIRST-OCCURRENCE order. A Map preserves that; a plain object would
//     reorder integer-like keys.
//   * ctx_reading[ch].most_common(1) picks the in-context reading, and its
//     tie is first occurrence too.
//   * prereq's dict is built walking to_learn in most_common order, and each
//     character's components before its phonetic head.
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  // Pass one: segment every line, using nothing but the resident lexicon.
  // This exists so the caller can learn which words a text needs BEFORE the
  // counting pass asks for their jyutping — in the browser the word table is
  // in IndexedDB, read by key, and the counting loop is synchronous. Cheap
  // enough to run twice (1.3-4.8 ms on prose_long, measured Phase 1) and far
  // simpler than threading a promise through the loop.
  A.wordsNeeded = function (text) {
    const out = new Set();
    for (const line of text.split('\n')) {
      const re = A.cjkRun();
      let m;
      while ((m = re.exec(line.trim())) !== null)
        for (const w of A.segment(A.cps(m[0]))) out.add(w);
    }
    return [...out];
  };

  A.analyse = function (text) {
    const lines = text.split('\n').map(l => l.trim());

    const charCount = A.counter();                 // char -> n
    const wordCount = A.counter();                 // word -> n
    const ctxReading = new Map();                  // char -> Map(reading -> n)
    const ctxWords = new Map();                    // char -> Map(reading -> Map(word -> n))
    const segLines = [];

    for (const line of lines) {
      const words = [];
      const re = A.cjkRun();
      let m;
      while ((m = re.exec(line)) !== null) {
        for (const w of A.segment(A.cps(m[0]))) words.push(w);
      }
      segLines.push([line, words]);
      for (const w of words) {
        wordCount.bump(w);
        const jp = A.tokenJyutping(w).split(' ').filter(Boolean);
        const wc = A.cps(w);
        for (let k = 0; k < wc.length; k++) {
          const ch = wc[k];
          charCount.bump(ch);
          // a word's syllable counts as this character's in-context reading
          // only if it is an attested reading of the character — guards
          // against dictionary typos such as 平淡 "ping4 ping4"
          if (jp.length === wc.length && A.attested(ch).has(jp[k])) {
            if (!ctxReading.has(ch)) ctxReading.set(ch, A.counter());
            ctxReading.get(ch).bump(jp[k]);
            if (!ctxWords.has(ch)) ctxWords.set(ch, new Map());
            const byR = ctxWords.get(ch);
            if (!byR.has(jp[k])) byR.set(jp[k], A.counter());
            byR.get(jp[k]).bump(w);
          }
        }
      }
    }

    // chars, in most_common order — the order build_page then re-sorts by
    // rank, stably, so this order decides every tie
    const chars = A.mostCommon(charCount).map(([ch, n]) => {
      const rank = A.rankOf(ch);
      const rd = A.readingOf(ch, ctxReading.get(ch));
      return {
        char: ch,
        count: n,
        reading: rd,
        rank,
        // known_n is always 0 from build_page, so nothing is ever "known"
        status: rank !== null ? 'learn' : 'unranked',
        phonetic: A.phoneticOf(ch),
        components: A.parentsOf(ch),
      };
    });

    const tokens = [...charCount.values()].reduce((a, b) => a + b, 0);

    // prerequisites: components and phonetic heads of the characters to
    // learn, that are learnable (have a reading), not yet known, and not in
    // the text. Insertion order is the payload's order, so the walk has to
    // match: to_learn in most_common order, components before phonetic head.
    const prereq = new Map();
    for (const c of chars) {
      if (!A.charRow(c.char)) continue;            // R.ds.get(ch) is None
      const cands = [];
      for (const p of A.cps(A.parentsOf(c.char))) cands.push([p, 'component']);
      if (c.phonetic) cands.push([c.phonetic, 'phonetic head']);
      for (const [p, why] of cands) {
        if (charCount.has(p) || !A.hasReadings(p)) continue;
        let e = prereq.get(p);
        if (!e) {
          const row = A.charRow(p);
          e = {char: p, reading: row.r[0][0], rank: A.rankOf(p),
               gloss: A.charGloss(p), why: new Set(), for_: []};
          prereq.set(p, e);
        }
        e.why.add(why);
        if (!e.for_.includes(c.char)) e.for_.push(c.char);
      }
    }
    const prereqSorted = A.stableSortBy([...prereq.values()],
                                        e => [e.rank === null ? 1 : 0, e.rank || 0]);

    return {tokens, chars, charCount, wordCount, ctxWords, segLines,
            prereq: prereqSorted};
  };
})(ANALYSIS);
