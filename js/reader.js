// reader.js — the reader tab: the text with jyutping above unacquired
// pairs only, the Read / Mark modes, "Show all meanings", and — for a text
// too long to put on the page at once — sections.
// ---------- sections ----------
// A lyric sheet is short enough to render whole, and did until plan 4 Phase
// 4; a 5,000-character article is not, and putting one in the DOM costs a
// visible pause on a phone. So a long text is read a section at a time.
//
// Boundaries are the blank lines the writer already put there, which is the
// document's own structure. A block with no blank lines in it — one pasted
// paragraph, the common prose shape — falls back to a character budget and
// splits at line boundaries, never mid-line.
const SECTION_MIN = 1500;      // at or under this, render whole, as before
const SECTION_TARGET = 1200;   // characters to aim for in one section

const partsChars = ps =>
  ps.reduce((n, p) => n + (p.type === 'word' ? p.chars.length : p.text.length), 0);
const lineChars = l => l.blank ? 0 : partsChars(l.parts);

// A section holds entries, and an entry is either a line index or a slice of
// one line's parts — {i, from, to}. The slice exists for the text that has no
// blank lines to break on and no line breaks either: one pasted wall of
// prose, which is a shape the web hands you often enough. Splitting falls on
// word boundaries, never inside a word, and page.lines itself is untouched,
// so the learn card's `line: {i, pos}` still points where it always did.
const entryParts = (p, e) => typeof e === 'number'
  ? (p.lines[e].blank ? [] : p.lines[e].parts)
  : p.lines[e.i].parts.slice(e.from, e.to);
const entryLine = e => typeof e === 'number' ? page.lines[e]
  : {blank: false, parts: page.lines[e.i].parts.slice(e.from, e.to)};

// one line -> the entries needed to render it within budget
function splitLine(p, i) {
  const parts = p.lines[i].parts;
  if (partsChars(parts) <= SECTION_TARGET) return [i];
  const out = [];
  let from = 0, n = 0;
  for (let k = 0; k < parts.length; k++) {
    const c = partsChars([parts[k]]);
    if (n + c > SECTION_TARGET && k > from) { out.push({i, from, to: k}); from = k; n = 0; }
    n += c;
  }
  if (from < parts.length) out.push({i, from, to: parts.length});
  return out;
}

function sectionsOf(p) {
  const all = p.lines.map((l, i) => i);
  const total = p.lines.reduce((n, l) => n + lineChars(l), 0);
  if (total <= SECTION_MIN) return [all];

  // blank-line-separated blocks, in document order; a blank line belongs to
  // the block it closes so the gap still renders inside a section
  const blocks = [];
  let cur = [];
  for (let i = 0; i < p.lines.length; i++) {
    cur.push(i);
    if (p.lines[i].blank) { blocks.push(cur); cur = []; }
  }
  if (cur.length) blocks.push(cur);

  const out = [];
  let acc = [], accN = 0;
  const flush = () => { if (acc.length) { out.push(acc); acc = []; accN = 0; } };
  for (const b of blocks) {
    const n = b.reduce((m, i) => m + lineChars(p.lines[i]), 0);
    if (n > SECTION_TARGET) {
      // a single block over budget: split it at line boundaries, and a single
      // line still over budget at word boundaries inside itself
      flush();
      let part = [], partN = 0;
      for (const i of b) {
        for (const e of splitLine(p, i)) {
          const c = partsChars(entryParts(p, e));
          if (partN + c > SECTION_TARGET && part.length) { out.push(part); part = []; partN = 0; }
          part.push(e); partN += c;
        }
      }
      if (part.length) out.push(part);
      continue;
    }
    if (accN + n > SECTION_TARGET && acc.length) flush();
    acc = acc.concat(b); accN += n;
  }
  flush();
  return out.length ? out : [all];
}

let sections = [[]], section = 0;

function resetSections() {
  sections = sectionsOf(page);
  section = 0;
}

function gotoSection(i) {
  section = Math.max(0, Math.min(sections.length - 1, i));
  renderLines();
  styleReader();
  window.scrollTo({top: 0, behavior: 'smooth'});
}
for (const id of ['secPrev', 'secPrevFoot']) $(id).onclick = () => gotoSection(section - 1);
for (const id of ['secNext', 'secNextFoot']) $(id).onclick = () => gotoSection(section + 1);

// coverage at both scales: the document figure lives in the meter above, the
// section's own sits with the section nav, so a learner reading section 4 of
// 9 can see that this part is the hard one (plan 4 Phase 4)
function renderSectionNav() {
  const many = sections.length > 1;
  $('sectionNav').style.display = many ? '' : 'none';
  $('sectionNavFoot').style.display = many ? '' : 'none';
  if (!many) return;
  const pct = coverageOfLines(sections[section].map(entryLine));
  $('secLabel').textContent =
    `Section ${section + 1} of ${sections.length} · ${pct}% readable here`;
  $('secPrev').disabled = $('secPrevFoot').disabled = section === 0;
  $('secNext').disabled = $('secNextFoot').disabled = section === sections.length - 1;
}

// ---------- reader ----------
function renderLines() {
  // "as written" swaps only the visible glyph to the pasted form; data-char
  // stays traditional, so known-state, jyutping and the tap handler are
  // untouched
  const aw = curText()?.asWritten;
  if (!sections.length || sections[section] === undefined) resetSections();
  $('lines').innerHTML = sections[section].map(entryLine).map(l => {
    if (l.blank) return '<div class="verse-gap"></div>';
    const parts = l.parts.map(p => {
      if (p.type === 'text') return `<span class="plain">${esc(p.text)}</span>`;
      const cs = p.chars.map(c => `
        <span class="card" data-char="${esc(c.char)}" data-jp="${esc(c.jp || '')}">
          <span class="c-jp">${esc(c.jp || '')}</span>
          <span class="c-char">${esc(aw && c.src ? c.src : c.char)}</span>
        </span>`).join('');
      return `<span class="word">
        <span class="cards">${cs}</span>
        ${p.gloss ? `<span class="w-gloss">${esc(p.gloss)}</span>` : ''}
      </span>`;
    }).join('');
    return `<div class="line">${parts}</div>`;
  }).join('');
  renderSectionNav();
  openAllGlosses();          // fresh DOM — re-apply "Show all meanings"
}

// two explicit modes (DESIGN.md — one gesture was carrying three intents, and
// a fully-known word couldn't be opened at all). Read: a tap anywhere in a
// word toggles its gloss, cards never change. Mark: a tap on a card mints it
// known (grey — per-reading exact, mature rung) or lapses it (green — the
// self-honesty valve), with a ~5 s Undo toast; a second tap on the same card
// inside the window also undoes.
// the default; hydrate() replaces it with what the store holds, because the
// store is no longer readable synchronously at load time
let readerMode = {mode: 'read', showAll: false};
const saveReaderMode = () => save('songpath.readerMode', readerMode);

function applyReaderMode() {
  $('rmRead').classList.toggle('active', readerMode.mode === 'read');
  $('rmMark').classList.toggle('active', readerMode.mode === 'mark');
  $('lines').classList.toggle('markmode', readerMode.mode === 'mark');
  $('showAllWrap').style.display = readerMode.mode === 'read' ? '' : 'none';
  $('showAllMeanings').checked = readerMode.showAll;
  $('readerHint').textContent = readerMode.mode === 'read'
    ? 'Jyutping appears above characters you haven’t acquired yet; it ' +
      'disappears as you learn. Tap a word for its meaning.'
    : 'Tap a character to mark it: grey → you already know it, green → ' +
      'send it back for review. Undo appears for a few seconds.';
  openAllGlosses();
}
$('rmRead').onclick = () => { readerMode.mode = 'read'; saveReaderMode(); applyReaderMode(); };
$('rmMark').onclick = () => { readerMode.mode = 'mark'; saveReaderMode(); applyReaderMode(); };

// "Show all meanings": ticking opens every word, unticking closes every word;
// a per-word tap still toggles individually either way
function openAllGlosses() {
  if (readerMode.mode === 'read' && readerMode.showAll)
    document.querySelectorAll('#lines .word').forEach(w => w.classList.add('open'));
}
$('showAllMeanings').onchange = () => {
  readerMode.showAll = $('showAllMeanings').checked;
  saveReaderMode();
  document.querySelectorAll('#lines .word').forEach(w =>
    w.classList.toggle('open', readerMode.showAll));
};

$('lines').onclick = e => {
  if (readerMode.mode === 'read') {
    const word = e.target.closest('.word');
    if (word) word.classList.toggle('open');
    return;
  }
  const el = e.target.closest('.card');
  if (!el) return;
  const c = info[el.dataset.char];
  const jp = cardJp(c, el.dataset.jp);
  if (!jp) return;                         // no reading on file — nothing to mark
  const key = keyOf(el.dataset.char, jp);
  if (undo && undo.snapshot?.key === key) { doUndo(); return; }
  const snap = {key, card: cards[key] ? {...cards[key]} : null};
  if (el.classList.contains('known')) {
    if (!cards[key]) return;               // known via nothing tangible — ignore
    lapseCard(key);                        // rung 0, due now — scaffolding returns
    showUndo(`${el.dataset.char} marked forgotten`, snap, restoreCard);
  } else {
    mintCard(key, MATURE_RUNG);            // per-reading, exact
    showUndo(`${el.dataset.char} ${jp} marked known`, snap, restoreCard);
  }
  styleReader();
  updateMeter();
  renderSectionNav();        // the section's own figure moves too
};

function styleReader() {
  const kn = el =>
    isKnownKey(el.dataset.char, cardJp(info[el.dataset.char], el.dataset.jp));
  document.querySelectorAll('#lines .card').forEach(el =>
    el.classList.toggle('known', kn(el)));
  document.querySelectorAll('#lines .line').forEach(el => {
    const cs = [...el.querySelectorAll('.card')];
    el.classList.toggle('readable', cs.length > 0 && cs.every(kn));
  });
}
