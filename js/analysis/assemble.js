// assemble.js — build_page's own work: chars[], families, lines[], best_line.
//
// Patch plan 9 Phase 4b. What is left of build_page once the card half is a
// table lookup (cards.js) and the per-reading sections are their own file
// (readings.js): the row it assembles around them, the family index, the
// segmented reader body, and the line each reading quotes.
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  // the sheet's curated phonetic column outranks Wiktionary: a character with
  // a phonetic component is phono-semantic whatever the page says — and with
  // NO sound part in hand the page's own `phonosemantic` is dropped, because
  // the caption it prints is "形聲 sound + meaning" and there is nothing to
  // point at. The server half is pathbuilder.py:formation_type.
  function formationType(ch, family) {
    if (family && family !== ch) return 'phonosemantic';
    const r = A.charRow(ch);
    const f = (r && r.f) || 'unknown';
    return f === 'phonosemantic' ? 'unknown' : f;
  }

  function familyOf(ch) {
    const r = A.charRow(ch) || {};
    // MEMBERSHIP, not truthiness. 75 of the 115 adjudicated rulings are the
    // empty string — "this character has no phonetic" — and char_row reads
    // `RULINGS[ch] if ch in RULINGS`, so such a character takes "" and never
    // falls through to the root or the sheet's column.
    if ('ru' in r) return r.ru;
    return r.ro || r.ph || r.fp || r.wp || '';
  }

  A.buildCharRow = function (c, srcOf, ctxWords, winfo) {
    const ch = c.char;
    const fam = familyOf(ch);
    const pair = A.readingGloss(A.key(ch, c.reading));
    // analyse() sets gloss = R.g.gloss(ch, rd); for a character with no
    // reading that is just the plain gloss, which is what the chars table
    // carries — gloss(ch, "") and gloss(ch) are the same call in glosses.py.
    const gloss = c.reading ? pair[0] : A.charGloss(ch);
    const card = A.cardOf(ch, c.reading, gloss);
    const rp = A.readingsRow(ch, c.reading, ctxWords, winfo);

    // key order is ROW_ORDER's, and parity walks it
    const row = {
      char: ch,
      reading: c.reading,
      gloss: gloss,
      rank: c.rank,
      count: c.count,
      readings: rp[0],
      polyphonic: rp[1],
      derived: card.derived,
      components: card.components,
      phonetic: card.phonetic,
      decomp: card.decomp,
      layout: card.layout,
      family: fam,
      type: formationType(ch, fam),
    };
    if (ch in srcOf) {          // simplified-origin only — the 簡 line
      row.src = srcOf[ch];
      row.src_class = A.srcClass(srcOf[ch], ch);
    }
    if (card.cousins) row.cousins = card.cousins;
    return row;
  };

  // reading + gloss for every family key, so the client can label a collapsed
  // phonetic card. Sorted, and that is the point: pathbuilder.py:213 records
  // that this was the last thing in the payload following the interpreter's
  // hash seed, so two runs of the same text differed here and nowhere else.
  // Code-point order, not JS's default UTF-16 order — they part company for
  // an astral key, and 𡆧 is a phonetic.
  A.familiesOf = function (rows) {
    const keys = [...new Set(rows.map(r => r.family).filter(Boolean))]
      .sort(A.cmpCodePoint);
    const out = {};
    for (const k of keys) {
      const f = A.family(k);
      out[k] = {reading: (f && f[0]) || '', gloss: (f && f[1]) || ''};
    }
    return out;
  };

  // ------------------------------------------------------------- the body
  function wordPart(w, srcW, winfo, cinfo) {
    const info = winfo.get(w) || {};
    const wc = A.cps(w);
    let jp = (info.jyutping || '').split(' ').filter(Boolean);
    if (jp.length !== wc.length) {
      // dictionary jyutping doesn't line up 1:1
      jp = wc.map(ch => (cinfo.get(ch) || {}).reading || '');
    }
    const srcC = A.cps(srcW);
    return {
      type: 'word',
      word: w,
      gloss: info.gloss || '',
      chars: wc.map((ch, k) => {
        const cd = {char: ch, jp: jp[k] === undefined ? '' : jp[k]};
        if (k < srcC.length && srcC[k] !== ch) cd.src = srcC[k];
        return cd;
      }),
    };
  }

  // normalization is positional and never touches whitespace, so the pasted
  // text splits and strips into the same shape as the normalized text — each
  // segmented word gets its parallel pasted-form slice for `src`.
  A.linesOf = function (text, srcText, winfo, cinfo) {
    const lines = [];
    const a = text.split('\n'), b = srcText.split('\n');
    for (let n = 0; n < a.length; n++) {
      const line = a[n].trim();
      const lineSrc = (b[n] === undefined ? '' : b[n]).trim();
      if (!line) {
        if (lines.length && !lines[lines.length - 1].blank)
          lines.push({blank: true});
        continue;
      }
      const parts = [];
      let i = 0;                                   // code points, like Python
      const srcCps = A.cps(lineSrc);
      // String.split with a capturing group interleaves the separators, the
      // same shape re.split gives
      for (const piece of line.split(new RegExp('(' + A.CJK_RUN_SOURCE + ')', 'u'))) {
        if (!piece) continue;
        if (new RegExp('^' + A.CJK_RUN_SOURCE + '$', 'u').test(piece)) {
          for (const w of A.segment(A.cps(piece))) {
            const n2 = A.cpLen(w);
            parts.push(wordPart(w, srcCps.slice(i, i + n2).join(''), winfo, cinfo));
            i += n2;
          }
        } else {
          parts.push({type: 'text', text: piece});
          i += A.cpLen(piece);
        }
      }
      lines.push({parts});
    }
    while (lines.length && lines[lines.length - 1].blank) lines.pop();
    return lines;
  };

  // The shortest line of the text containing each (char, reading) pair, ties
  // to the FIRST occurrence. The map key is char + jyutping with no
  // separator: the character is exactly one code point and a jyutping
  // syllable is [a-z]+[0-9], so the join is already unambiguous. `pos` counts characters across all of the line's
  // parts, text pieces included, matching how the client flattens a line;
  // blank rows keep their lines[] index.
  A.attachLines = function (rows, lines) {
    const best = new Map();
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li];
      if (l.blank) continue;
      let length = 0;
      for (const p of l.parts)
        length += A.cpLen(p.type === 'word' ? p.word : p.text);
      let pos = 0;
      for (const p of l.parts) {
        if (p.type === 'word') {
          for (let k = 0; k < p.chars.length; k++) {
            const key = p.chars[k].char + p.chars[k].jp;
            const cur = best.get(key);
            if (!cur || length < cur[0]) best.set(key, [length, li, pos + k]);
          }
          pos += A.cpLen(p.word);
        } else {
          pos += A.cpLen(p.text);
        }
      }
    }
    for (const row of rows)
      for (const r of row.readings) {
        const b = best.get(row.char + r.jp);
        if (b) r.line = {i: b[1], pos: b[2]};
      }
  };
})(ANALYSIS);
