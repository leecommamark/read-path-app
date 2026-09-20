// normalize.js — the variant / simplified pass, mirroring normalize.py.
//
// Patch plan 9 Phase 4a. Rewrites TW-standard and simplified forms into the
// forms the analysis is keyed on, guarded positionally by readability rank so
// a real dictionary-backed character (里, 干, 后) is never touched; classifies
// the pasted text's source script; and records the simplified source form per
// traditional card for the learn card's 簡 line.
//
// WHAT IS A TABLE HERE AND WAS LOGIC THERE. normalize.py's _variant_map,
// _readability, _src_class, _is_simp and the t2s classifier are all
// character-only, so build_dist precomputes them and this file looks them up.
// What is genuinely ported is the scanner loop and OpenCC's phrase-aware s2t.
//
// THE PHRASE PASS. normalize.py runs cc.convert() over the WHOLE text, and
// OpenCC's s2t chains STPhrases before STCharacters — load-bearing, because
// only the phrase layer splits 发 into 發/髮 (头发 -> 頭髮 but 发生 -> 發生).
// The .ocd2 files are MARISA tries and cannot be enumerated, so build_dist
// derives the entries that matter from the lexicon; see its t_variants
// docstring for the approximation and its named gap. Here that table is
// applied the way OpenCC applies its own: greedy longest match, longest key
// first, falling back to the character map.
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  const MAX_PHRASE = 6;        // longest key in the derived phrase table

  // OpenCC over the whole text, as far as the shipped tables can reproduce
  // it. Returns an array of code-point strings, same length as the input's
  // code points — normalize.py only uses the result when the conversion is
  // 1:1, and the derived table has no length-changing entries, so the array
  // stays aligned by construction.
  function s2tWhole(cpArr) {
    const V = A.variants();
    const out = new Array(cpArr.length);
    let i = 0;
    while (i < cpArr.length) {
      let hit = null;
      for (let n = Math.min(MAX_PHRASE, cpArr.length - i); n > 1; n--) {
        const span = cpArr.slice(i, i + n).join('');
        const rep = V.phrases[span];
        if (rep) { hit = [n, A.cps(rep)]; break; }
      }
      if (hit) {
        // guarded at build time: no derived entry changes code-point length
        for (let k = 0; k < hit[0]; k++) out[i + k] = hit[1][k];
        i += hit[0];
      } else {
        const c = cpArr[i];
        out[i] = V.s2t[c] || c;
        i += 1;
      }
    }
    return out;
  }

  const isSimp = ch => ch in A.variants().s2t;      // s2t would rewrite it
  const t2sChanges = ch => A.variants().t2sSet.has(ch);

  // 0 = no readings at all, 1 = sheet-fallback only, 2 = dictionary-backed.
  // Absent from the character table means absent from chars.tsv, which is 0.
  function readability(ch) {
    const r = A.charRow(ch);
    return (r && r.rd) || 0;
  }

  A.normalizeText = function (text) {
    const V = A.variants();
    if (!V.t2sSet) V.t2sSet = new Set(V.t2s);
    const vmap = V.vmap;                      // char -> canonical form

    const src = A.cps(text);
    const whole = s2tWhole(src);              // the phrase-aware pass

    // subs keeps insertion order — first occurrence of each (src, dst) pair —
    // because normalized[] is emitted in that order and parity compares it.
    const subs = new Map();
    let nSimp = 0, nTrad = 0;
    const out = new Array(src.length);

    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      let b = a;
      if (readability(a) < 2) {
        let cand = vmap[a] || whole[i];
        if (vmap[cand]) cand = vmap[cand];   // s2t may yield a TW form (說→説)
        if (cand !== a && readability(cand) > readability(a)) {
          b = cand;
          const key = a + b;
          const e = subs.get(key);
          if (e) e.count++;
          else subs.set(key, {src: a, dst: b, count: 1});
        }
      }
      if (A.isCjk(a)) {
        if (b !== a && isSimp(a)) nSimp++;
        else if (t2sChanges(a)) nTrad++;
      }
      out[i] = b;
    }

    const normalized = [...subs.values()].map(e =>
      ({src: e.src, dst: e.dst, count: e.count, simp: isSimp(e.src)}));

    const total = nSimp + nTrad;
    const ratio = total ? A.pyRound3(nSimp / total) : 0.0;
    const script = {
      kind: ratio > 0.6 ? 'simp' : ratio > 0.1 ? 'mixed' : 'trad',
      simp_ratio: ratio,
    };

    // simplified source form per traditional card — should a text hold both
    // 說 and 说, both normalize to 説 and the most frequent source wins. The
    // Python sorts subs by count descending; sorted() is stable, so ties keep
    // insertion order, and so must this.
    const srcOf = {};
    const byCount = A.stableSortBy([...subs.values()], e => [-e.count]);
    for (const e of byCount)
      if (isSimp(e.src) && !(e.dst in srcOf)) srcOf[e.dst] = e.src;

    return {
      text: out.join(''),
      srcText: text,
      normalized,
      script,
      srcOf,
    };
  };

  // src_class for the learn card's 簡 pairing line — near = "learn both now",
  // far = "a separate thing to remember". Precomputed by build_dist for every
  // (source, normalised) pair the scanner above can produce, so this is a
  // lookup rather than the IDS-overlap rule. Used by Phase 4b, which is what
  // puts src_class on a chars[] row.
  A.srcClass = function (src, dst) {
    const r = A.variants().sc[src];
    return r && r[0] === dst ? r[1] : 'far';
  };
})(ANALYSIS);
