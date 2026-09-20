// lrc.js — the LRC parser, written to patch plan 3 Phase 0's specification.
//
// Plan 3 (karaoke playback) was specified and never coded, so this arrives
// with plan 4 Phase 3 instead, where it does a smaller job: a learner who
// already has an .lrc file gets the words out of it and a text like any
// other. The timestamps are parsed rather than thrown away so that karaoke,
// if FEATURES.karaoke is ever turned back on, has its data path waiting —
// which is why parseLRC returns the timings and not just the words.
//
// Nothing here knows about LRCLIB, or about any other source: it takes text.

// gap after which a rest becomes a blank line in the plain text, ms
const REST_GAP = 6000;

const _LRC_TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const _LRC_OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]$/i;
// [ar:] [ti:] [al:] [by:] [length:] and friends — a word tag, not a time
const _LRC_META = /^\[[a-z]+:.*\]$/i;
// enhanced LRC puts a timestamp before each word: <mm:ss.xx>word
const _LRC_WORD = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>([^<]*)/g;

function _ms(mm, ss, frac) {
  // a 2-digit fraction is centiseconds, a 3-digit one milliseconds
  const f = frac ? (frac.length === 3 ? +frac : +frac * 10) : 0;
  return (+mm * 60 + +ss) * 1000 + f;
}

// parseLRC(text) -> {offset, lines: [{t, text, words?}]}
//
// Handles [mm:ss.xx] and [mm:ss.xxx]; several timestamps on one line (a
// repeated chorus line emits one entry per timestamp); [offset:] folded into
// `offset`; metadata tags dropped; timed lines with empty text kept, because
// they are the instrumental rests plainFromLRC turns into blank lines;
// anything unparseable skipped rather than thrown. Sorted by time.
function parseLRC(text) {
  const lines = [];
  let offset = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const off = _LRC_OFFSET.exec(line);
    if (off) { offset = +off[1]; continue; }

    _LRC_TIME.lastIndex = 0;
    const times = [];
    let m, end = 0;
    while ((m = _LRC_TIME.exec(line))) {
      // only the run of timestamps at the head of the line counts; a stray
      // [1:23] inside the words is words
      if (m.index !== end) break;
      times.push(_ms(m[1], m[2], m[3]));
      end = _LRC_TIME.lastIndex;
    }
    if (!times.length) continue;              // metadata or junk — drop it
    if (_LRC_META.test(line)) continue;

    const rest = line.slice(end).trim();
    const words = _words(rest);
    const plain = words ? words.map(w => w.text).join('') : rest;
    for (const t of times) {
      const e = {t, text: plain};
      // an enhanced line repeated at two timestamps keeps its word timings
      // relative to each, which is the caller's problem, not the parser's
      if (words) e.words = words;
      lines.push(e);
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return {offset, lines};
}

// word timings, or null when the line is ordinary LRC
function _words(rest) {
  _LRC_WORD.lastIndex = 0;
  const out = [];
  let m;
  while ((m = _LRC_WORD.exec(rest)))
    out.push({t: _ms(m[1], m[2], m[3]), text: m[4]});
  return out.length ? out : null;
}

// plainFromLRC(parsed) -> the text handed to analyse(): one line per timed
// line, and a blank line wherever the gap to the next timestamp exceeds
// REST_GAP, so verse structure survives into page.lines. A timed line with no
// words is itself a rest and contributes only its blank line.
function plainFromLRC(parsed) {
  const lines = (parsed && parsed.lines) || [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i], next = lines[i + 1];
    if (cur.text) out.push(cur.text);
    const gap = next ? next.t - cur.t : 0;
    const rest = (!cur.text && next) || (next && gap > REST_GAP);
    if (rest && out.length && out[out.length - 1] !== '') out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// does this text look like LRC? one timed line is enough — the extension is
// a hint, not evidence, and a pasted LRC has no extension at all
function looksLikeLRC(text) {
  return parseLRC(text).lines.length > 0;
}
