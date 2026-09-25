// cardview.js — the pieces the learn card and the quiz feedback card share:
// the text's own words, the dictionary example words, the reading's
// line, one per-reading section, and the mnemonic block (formation caption,
// decomposition tree, cousin line, series dropdowns).
// the text's own words — dictionary examples repeating them are filtered
// out client-side (the server mirrors this for gloss derivation)
const _pageWords = new WeakMap();
function textWordSet() {
  if (!page) return new Set();
  let s = _pageWords.get(page);
  if (!s) {
    s = new Set();
    for (const l of page.lines) if (!l.blank)
      for (const p of l.parts) if (p.type === 'word') s.add(p.word);
    _pageWords.set(page, s);
  }
  return s;
}
// first 3 dictionary example candidates not among the text's own words
function dictExamples(r) {
  const sw = textWordSet();
  return (r.examples || []).filter(e => !sw.has(e.word)).slice(0, 3);
}

// the mnemonic block: formation-type caption + decomposition tree. Shown on
// the learn card and the quiz feedback card.
const FORMATION_NAMES = {
  phonosemantic: '<b>形聲</b> sound + meaning',
  ideographic: '<b>會意</b> meaning parts combined',
  pictogram: '<b>象形</b> a picture of the thing',
  ideogram: '<b>指事</b> an abstract sign',
  loan: '<b>假借</b> borrowed for its sound',
  simplified: 'simplified form',
};
function mnemonicBlock(c) {
  const cap = formationCaption(c);
  const tree = decompTree(c.decomp);
  if (!cap && !tree) return '';
  // a caption alone (象形/指事 — nothing to decompose) still earns its line
  return `${cap}${tree}${cousinLine(c)}`;
}

// The caption on its own. The staged card (Phase 3) shows it a beat before
// the tree it introduces — "how they sit together" precedes "which one is the
// sound" — so the two halves of the mnemonic block are separable here rather
// than duplicated there.
const formationCaption = c =>
  FORMATION_NAMES[c.type] ? `<div class="dt-caption">${FORMATION_NAMES[c.type]}</div>` : '';

// `layout` is the server's word for how the parts are arranged — "left →
// right", "outside → inside". It has never been drawn; the staged card is
// where it belongs, because that beat is exactly the question it answers.
const layoutLine = c =>
  c.layout ? `<div class="dt-layout">${esc(c.layout)}</div>` : '';

// Only when the server sent cousins: the phonetic's own reading is no clue to
// this character's sound, so name the series members that are — "like 黨 dong2
// · 堂 tong4". Absent whenever the bold pick is close enough to stand alone.
function cousinLine(c) {
  if (!c.cousins || !c.cousins.length) return '';
  return `<div class="dt-cousins">like ` + c.cousins.map(x =>
    `<b>${esc(x.char)}</b> ${esc(x.jp)}`).join('<span class="n-sep">·</span>')
    + `</div>`;
}

// decomposition tree, one row per level: level-1 components side by side,
// their components (if any) on the next row, etc. Phonetic components purple
// with their jyutping; 會意 components and the semantic side of a 形聲
// character carry their curated role-gloss (cgloss) — never a dictionary gloss.
// Under a 形聲 parent each component is labelled with its role (sound/meaning).
function decompTree(d) {
  if (!d || !d.children || !d.children.length) return '';
  const rows = [];
  let level = d.children.map(k => ({n: k, parent: d}));
  while (level.length) {
    rows.push(level);
    level = level.flatMap(({n}) => (n.children || []).map(k => ({n: k, parent: n})));
  }
  return rows.map(row => `<div class="dt-row">` + row.map(({n, parent}) => {
    const isPhon = n.char === parent.phonetic;
    const rs = isPhon ? (n.readings || (n.jp ? [n.jp] : [])) : [];
    const jp = rs.length ? `<span class="n-jp">` + rs.map(r =>
      r === (n.best || rs[0]) ? `<b>${esc(r)}</b>` : `<span class="n-alt">${esc(r)}</span>`)
      .join('<span class="n-sep">·</span>') + `</span>` : '';
    const gloss = n.cgloss && (parent.type === 'ideographic' ||
          (parent.phonetic && n.char !== parent.phonetic))
      ? `<span class="n-gloss">${esc(n.cgloss)}</span>` : '';
    const role = parent.type === 'phonosemantic' && parent.phonetic
      ? `<span class="n-role${isPhon ? ' sound' : ''}">${isPhon ? 'sound' : 'meaning'}</span>`
      : '';
    return `<span class="dt-node${isPhon ? ' phon' : ''}">
      ${role}<span class="n-char">${esc(n.char)}</span>${jp}${gloss}</span>`;
  }).join('') + `</div>`).join('');
}

// optional enrichment: two dropdowns — characters sharing the phonetic
// component, and characters that take THIS character as their phonetic
function seriesRows(list) {
  return list.map(s => {
    // `info` is this text's table and there may be no text: a card drawn for
    // a character in none of them (plan 12 Phase 1) has nothing to be "in".
    const inText = !!info && s.char in info;
    return `<div class="sr${inText ? ' intext' : ''}"><b>${esc(s.char)}</b>
      <span class="sr-jp">${esc(s.jp || '?')}</span>${esc(s.gloss || '')}${inText ? ' — in this text' : ''}</div>`;
  }).join('');
}

function seriesBlock(c) {
  let out = '';
  const phonNode = (c.decomp?.children || []).find(k => k.char === c.decomp.phonetic);
  const sibs = phonNode?.series || [];
  if (sibs.length) {
    const label = phonNode.series_root
      ? `${sibs.length} character${sibs.length === 1 ? '' : 's'} in the wider `
        + `${esc(phonNode.series_root)} sound family`
      : `${sibs.length} other character${sibs.length === 1 ? '' : 's'} `
        + `with phonetic ${esc(c.decomp.phonetic)}`;
    out += `<details class="lc-series"><summary>${label}</summary>
      ${seriesRows(sibs)}</details>`;
  }
  const derived = c.derived || [];
  // 258 of the 3,000 ranked characters have exactly one derived character —
  // 人 都 係 你 among them — so the singular is the common case, not the edge
  // one, and it needs the verb and the possessive to agree, not just the noun.
  if (derived.length)
    out += `<details class="lc-series">
      <summary>${derived.length === 1
        ? `1 character takes ${esc(c.char)} as its phonetic`
        : `${derived.length} characters take ${esc(c.char)} as their phonetic`}</summary>
      ${seriesRows(derived)}</details>`;
  return out;
}

// the reading's line from the text, in reader card markup: jyutping above unacquired
// only (same predicate as the Reader), the target character highlighted.
// A long line clips to the clause around the target, cuts marked with an
// ellipsis. Glyphs follow the text's "as written" toggle like the quiz words
// — except in the Due deck (`due`), which always shows traditional
// (DESIGN.md).
//
// Sentence enders count as delimiters, not just the comma-ish ones (plan 4
// Phase 4). A lyric line is one clause and never needed them; pasted prose
// arrives as a paragraph on a single line, where searching only for ，、
// walks straight through 。 and hands the card a 31-character run-on of
// three sentences. With enders in, the same card clips to 11.
const CLAUSE_SEP = /[　 ，、,。！？；：!?;:]/;
const CLIP_LEN = 14;
function contextLineHtml(r, due) {
  const l = r.line && page && page.lines[r.line.i];
  if (!l || l.blank) return '';
  const aw = !due && curText()?.asWritten;
  // flatten to per-character cells — offsets match the server's pos
  const cells = [];
  for (const p of l.parts) {
    if (p.type === 'word')
      for (const c of p.chars)
        cells.push({ch: aw && c.src ? c.src : c.char, char: c.char, jp: c.jp});
    else
      for (const t of p.text) cells.push({ch: t, text: true});
  }
  const pos = r.line.pos;
  let start = 0, end = cells.length;
  if (cells.length > CLIP_LEN) {
    for (let i = pos - 1; i >= 0; i--)
      if (cells[i].text && CLAUSE_SEP.test(cells[i].ch)) { start = i + 1; break; }
    for (let i = pos + 1; i < cells.length; i++)
      if (cells[i].text && CLAUSE_SEP.test(cells[i].ch)) { end = i; break; }
  }
  const html = cells.slice(start, end).map((c, k) => {
    if (c.text) return `<span class="plain">${esc(c.ch)}</span>`;
    // same guard: a context line only exists where a text does, but this must
    // not be the thing that throws if one is ever drawn without one
    const known = isKnownKey(c.char, cardJp(info && info[c.char], c.jp));
    return `<span class="card${known ? ' known' : ''}${start + k === pos ? ' target' : ''}">
      <span class="c-jp">${esc(c.jp || '')}</span>
      <span class="c-char">${esc(c.ch)}</span></span>`;
  }).join('');
  return `<div class="lc-line">${start > 0 ? '<span class="plain">…</span>' : ''}${html}${end < cells.length ? '<span class="plain">…</span>' : ''}</div>`;
}

// one per-reading section — the learn card shows every reading, the quiz
// feedback card just the answered one. gloss → dictionary words → the
// line, each of the last two under its own label: unlabelled, a row of
// Chinese was ambiguous — the words and the line read alike. Words come
// first so the line, the hook the learner already knows, sits closest to the
// mnemonic block below. 變調 variants live inside their base reading's
// section (their word evidence still comes from in_text — a variant has no
// line of its own on the card).
// `only` is the staged card's (Phase 3) — `'reading'` draws the jyutping and
// the gloss alone, `'words'` the evidence alone, and an absent `only` the
// whole section, which is what the quiz feedback card still asks for. One
// function rather than two: the staged card is the same card revealed in
// order, and a second copy of this markup is how the two would drift.
function readingSection(cur, r, c, due, only) {
  const all = c.readings || [];
  const words = dictExamples(r).map(e =>
    `<span class="lc-w">${esc(e.word)} <span class="lc-exjp">${esc(e.jp)}</span></span>`).join('');
  const intextWord = w =>
    `<span class="intext">${esc(w.word)}</span> <span class="lc-exjp">${esc(w.jp)}</span>`;
  const vars = all.filter(v => v.variant_of === r.jp).map(v => {
    const ws = v.in_text?.length
      ? v.in_text.map(intextWord).join('　')
      : v.examples?.[0]
        ? `${esc(v.examples[0].word)} <span class="lc-exjp">${esc(v.examples[0].jp)}</span>`
        : '';
    return `<div class="lc-var"><b>變調</b> changed tone <span class="lc-exjp">${esc(v.jp)}</span>${ws ? ` in ${ws}` : ''}</div>`;
  }).join('');
  const line = contextLineHtml(r, due);
  const head = only !== 'words'
    ? `<div class="lc-jp">${esc(r.jp || '?')}</div>
       <div class="lc-gloss">${esc(r.gloss || '')}</div>` : '';
  const body = only !== 'reading'
    ? `${words ? `<div class="lc-label">Words using it</div>
                  <div class="lc-words">${words}</div>` : ''}
       ${line ? `<div class="lc-label">In the text</div>${line}` : ''}
       ${vars}` : '';
  // an empty box still draws its own-reading background, so a reading with
  // no evidence contributes nothing to the evidence beat rather than a blank
  if (!head.trim() && !body.trim()) return '';
  return `<div class="lc-reading${r.jp === cur.jp ? ' own' : ''}">
    ${head}${body}
  </div>`;
}

// ---------- the form-of card (plan 10 Phase 6) ----------
// The meaning track's presentation card: what a squeezed shape MEANS, and the
// characters it marks. It is deliberately light — no reading is shown and none
// is ever quizzed, because 辶's "caang1" is a spelling no dictionary attests
// and teaching it was the mistake plan 10 exists to undo.
//
// A full character used as a meaning part (木 言 女 虫) gets no card of its
// own: whoever knows 虫 already knows what it means. This draws whatever the
// scheduler hands it; deciding which parts earn a card is the value floor's
// job, and when is plan 10 Phase 8's.

// The wording, approved by Mark 2026-09-21. The shapes are his, from the
// brief: strong states the meaning plainly, loose hedges it, misleading leads
// with the note. "Often to do with insect." reads a little oddly where the
// curated meaning is a bare noun; it was put to him and he kept it, so change
// the TABLE's wording rather than this frame if it ever grates.
const MC_WORDING = {
  strong: m => esc(m),
  loose: m => 'Often to do with ' + esc(m) + '.',
  misleading: m => esc(m),          // the note leads; this follows it, muted
};
const MC_EXAMPLES = 8;

function partCardHtml(row) {
  if (!row) return '';
  const mis = row.reliability === 'misleading';
  // "from 手" only where the curated table has a full form. 61 of the 76 rows
  // leave it blank — most meaning parts ARE the full character — so an
  // absent line is the common case, not an edge one.
  const from = row.full_form
    ? `<div class="mc-from">from <b>${esc(row.full_form)}</b></div>` : '';
  // the note is always shown for a misleading part, because for those the
  // note IS the card; elsewhere it qualifies the meaning and follows it
  const note = row.note
    ? `<div class="mc-note">${esc(row.note)}</div>` : '';
  const meaning =
    `<div class="mc-meaning${mis ? ' mc-quiet' : ''}">` +
    `${(MC_WORDING[row.reliability] || MC_WORDING.strong)(row.meaning)}</div>`;
  // known first, then the shipped order, which is by commonness. The shipped
  // order is a starting point rather than the answer: which characters the
  // learner already reads is not knowable at build time.
  const ex = (row.examples || [])
    .map(([ch, gloss]) => ({ch, gloss, known: isKnownChar(ch)}))
    .sort((a, b) => b.known - a.known)
    .slice(0, MC_EXAMPLES);
  return `
    <div class="mc">
      <div class="mc-label" lang="en">meaning part</div>
      <div class="mc-char">${esc(row.component)}</div>
      ${from}
      ${mis ? note + meaning : meaning + note}
      <div class="mc-ex">${ex.map(e => `
        <span class="mc-e${e.known ? ' known' : ''}">
          <span class="mc-e-char">${esc(e.ch)}</span>
          <span class="mc-e-gloss">${esc(e.gloss)}</span>
        </span>`).join('')}</div>
      <div class="mc-marks" lang="en">marks ${row.marks} of your 3,000 characters</div>
    </div>`;
}

// ---------- the staged card (plan 12 Phase 3) ----------
// The learn card handed over everything at once — the character, the 簡
// pairing, every reading with its gloss, its dictionary words and its line,
// the formation caption, the decomposition tree, the cousins, the count and
// the series dropdowns. There were no steps to climb because it was all one
// step, and Mark's complaint about the track ("acknowledging its existence is
// not learning it") applies to a card as much as to a question.
//
// So the same card, revealed in order: the parts you have already met → how
// they sit together → which part carries the sound and what it sounds like →
// the reading → the character in a word. NOT a second card design — every
// beat below is a piece this file already drew, moved rather than rewritten,
// and a fully revealed staged card holds exactly what the old card held.
//
// An empty beat is dropped rather than shown blank, so the sequence is as
// long as the character has something to say: 清 climbs all five, 人 — a
// pictogram with nothing to decompose — has its caption, its reading and its
// word, and the card is three beats rather than a wall with three holes.

// Beat 1. The level-1 components, and WHICH OF THEM THE LEARNER HAS MET —
// the whole staging rests on leading from what they have to what they have
// not, so this is the beat that says where they are standing. It is also the
// one that can lie: a part listed without qualification reads as a part they
// know, so the two groups are labelled separately and the "you've met" label
// is absent entirely when nothing has been.
//
// No readings here, met or not. That is beat 3's, and giving 青's cing1 away
// in beat 1 would collapse the sequence into the wall it replaces.
function partsRow(c) {
  const kids = (c.decomp && c.decomp.children) || [];
  // code points, not UTF-16 units — spread over a string iterates code points,
  // and 16 of the sound parts in this plan are astral
  const chars = [...new Set(kids.length ? kids.map(k => k.char)
                                        : [...(c.components || '')])];
  if (!chars.length) return '';
  const group = (label, list, cls) => list.length
    ? `<div class="lp-group"><span class="lp-label" lang="en">${label}</span>` +
      list.map(ch => `<span class="lp-part${cls}">${esc(ch)}</span>`).join('') +
      `</div>`
    : '';
  return `<div class="lc-parts">` +
    group("you've met", chars.filter(metPart), ' met') +
    group('new to you', chars.filter(ch => !metPart(ch)), '') +
    `</div>`;
}

// The beats, in order, each with the cue that reveals it — the cue is the
// learner's own question, because a button that says "Next" teaches nothing
// and a button that asks where the sound is has already made the point.
//
// Beat 3 is the sound part under a 形聲 character. 606 of the 3,000 have no
// sound part (decision 12-ii) and for those the SAME tree is the meaning
// parts with their curated role-glosses, so only the cue changes: the card
// stages on the meaning instead of the sound rather than losing the beat.
function cardStages(cur, c, due) {
  // the Pleco layout the learn card has always had: one section per reading,
  // the card's own first. Staging splits each section in two — its reading on
  // one beat, its evidence on the next — and does not change which sections
  // there are or what order they come in.
  const all = c.readings || [{jp: c.reading, gloss: c.gloss, in_text: []}];
  const secs = all.filter(r => !r.variant_of)
    .sort((a, b) => (b.jp === cur.jp) - (a.jp === cur.jp));
  const sound = !!(c.decomp && c.decomp.phonetic);
  const sec = only => secs.map(r => readingSection(cur, r, c, due, only)).join('');
  return [
    {cue: '', html: partsRow(c)},
    {cue: 'How do they fit together?', html: formationCaption(c) + layoutLine(c)},
    {cue: sound ? 'Which part gives the sound?' : 'What do the parts mean?',
     html: decompTree(c.decomp) + cousinLine(c)},
    {cue: 'What is the reading?', html: sec('reading')},
    {cue: 'Show it in a word', html: sec('words') + seriesBlock(c)},
  ].filter(s => s.html.trim());
}
