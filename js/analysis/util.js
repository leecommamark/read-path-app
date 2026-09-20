// util.js — the small things the port gets wrong if it is careless.
//
// Patch plan 9 Phase 4a. Everything here exists because Python and JavaScript
// disagree about something, and the disagreement reaches the payload.
//
// LOAD ORDER DOES NOT MATTER. These files are loaded as classic scripts —
// tools/parity.js runs them in readdirSync().sort() order, index.html will
// list them in its own — so nothing here executes at load time except
// declarations. `var ANALYSIS = ANALYSIS || {}` is the idiom that makes the
// namespace survive any order.
//
// WHY A NAMESPACE AT ALL. The twelve client files share one script scope
// (store.js). library.js already has `async function analyse(text)`, which is
// the very seam Phase 5 replaces; an analysis file with a top-level `analyse`
// or `segment` would collide the moment both are loaded. So everything lives
// on ANALYSIS, and `buildPage` is the single bare global, because that is the
// contract tools/parity.js documents.
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  // ---------------------------------------------------------- code points
  // Python's len(), indexing, slicing and `for ch in s` all count CODE
  // POINTS. JS string indexing counts UTF-16 units. The data has Extension B
  // characters in it (𠝹 𠱁 𡆧), so every place the Python counts characters
  // has to become an array of code points here. This is not hypothetical:
  // expandLines in store.js had exactly this bug and it silently corrupted
  // every word containing an astral character (fixed in 280709f).
  A.cps = s => Array.from(s);
  A.cpLen = s => {
    // faster than Array.from for the common all-BMP case, and identical
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      n++;
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) i++;
    }
    return n;
  };

  // The ranges CJK_RUN matches in pathbuilder.py, with the `u` flag so the
  // astral range means code points rather than surrogate halves. `g` is set
  // where it is used, not here — a shared regex with `g` carries lastIndex
  // between calls and that is a classic source of skipped matches.
  A.CJK_RUN_SOURCE = '[\\u3400-\\u4dbf\\u4e00-\\u9fff\\u{20000}-\\u{2ffff}]+';
  A.cjkRun = () => new RegExp(A.CJK_RUN_SOURCE, 'gu');
  A.isCjk = ch => new RegExp('^' + A.CJK_RUN_SOURCE + '$', 'u').test(ch);

  // ------------------------------------------------------------- rounding
  // Python's round(x, 3) is half-to-even on the exact value of the double;
  // Math.round is half-up. script.simp_ratio is round(n_simp / total, 3), and
  // the two part company whenever the ratio lands exactly on a half-way case:
  // 1/16 = 0.0625 gives Python 0.062 and Math.round 0.063. There are 320 such
  // ties for totals under 400 and half of them diverge, so this is ordinary
  // rather than exotic — texts/edge_ratio_tie.txt pins one.
  //
  // A tie is only reachable when x is exactly k/2000 AND dyadic, so x * 1000
  // is exactly k/2 and representable. That is what makes the `=== 0.5` test
  // safe here rather than the usual float-comparison mistake.
  A.pyRound3 = x => {
    const y = x * 1000;
    const f = Math.floor(y);
    const r = y - f;
    let n;
    if (r === 0.5) n = (f % 2 === 0) ? f : f + 1;   // half to even
    else n = Math.round(y);
    return n / 1000;
  };

  // ----------------------------------------------------------------- hash
  // Must agree with build_dist.fnv1a, which hashes CODE POINTS. Hashing
  // charCodeAt units instead disagrees for every astral word, silently
  // sending it to the wrong shard — dist/tables/manifest.json carries a
  // hashCheck sample including 𠝹紙 and 𠱁人 so the divergence cannot ship.
  A.fnv1a = s => {
    let h = 0x811c9dc5;
    for (const ch of s) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };

  // ------------------------------------------------------------- ordering
  // Counter.most_common() is a stable sort by count descending, so ties keep
  // insertion order — which for a character count is first occurrence in the
  // text. Array.prototype.sort has been stable since ES2019, so the sort
  // itself is fine; what matters is that the input array was built in first
  // occurrence order. A Map guarantees that. A plain object does not: it
  // orders integer-like keys numerically first, and jyutping keys like "1"
  // would reorder silently.
  A.mostCommon = counter => [...counter.entries()]
    .sort((a, b) => b[1] - a[1]);

  // Python's sorted() is stable too. Used for prereq, whose key is
  // (rank is None, rank or 0) over dict insertion order.
  A.stableSortBy = (arr, key) => arr
    .map((v, i) => [v, i])
    .sort((a, b) => {
      const ka = key(a[0]), kb = key(b[0]);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return a[1] - b[1];
    })
    .map(p => p[0]);

  // Python's sorted() compares CODE POINTS; JS's default sort compares
  // UTF-16 units. They agree across the BMP and part company the moment an
  // astral character meets a BMP one at or above U+E000, because a surrogate
  // half sorts below it. Family keys can be astral — 𡆧 is a phonetic — so
  // anything the payload sorts by character uses this.
  A.cmpCodePoint = (x, y) => {
    const a = A.cps(x), b = A.cps(y);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = a[i].codePointAt(0) - b[i].codePointAt(0);
      if (d) return d;
    }
    return a.length - b.length;
  };

  // A counting Map that keeps first-insertion order, the shape Counter has.
  A.counter = () => {
    const m = new Map();
    m.bump = (k, n) => m.set(k, (m.get(k) || 0) + (n === undefined ? 1 : n));
    return m;
  };
})(ANALYSIS);
