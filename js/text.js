// text.js — the text shell: opening a text, the "as written" toggle, the
// card self-heal, tab switching, the coverage meter and the study queue.
// ---------- text ----------
async function openText(id, mode) {
  const s = texts.find(x => x.id === id);
  if (!s) return;
  textId = id;
  // core and lines only. The reader, calibrate, the meter and the quiz's
  // distractors need nothing else, so opening a text never waits on the card
  // store (plan 5 Phase 2); ensureCards pays for that when studying starts.
  await warmText(id);              // core and lines are lazy since plan 8 Phase 2
  const cached = loadCoreLines(id);
  if (cached) {
    adoptPage(cached, false);
  } else {                           // cache miss or stale schema — re-analyse
    const fresh = await analyse(s.text);
    savePage(id, fresh);
    adoptPage(fresh, true);          // a fresh payload arrives with its cards
  }
  foldVariantCards(page);
  show('text');
  $('textTitle').textContent = s.title + (s.source ? ' — ' + s.source : '');
  const simp = page.script && page.script.kind !== 'trad';
  $('textBadge').style.display = simp ? '' : 'none';
  $('readerScript').style.display = simp ? '' : 'none';
  $('asWritten').checked = !!s.asWritten;
  resetSections();           // a fresh text starts at its first section
  renderLines();
  await setMode(mode || 'learn');
}

// point the screen's state at a payload. `withCards` says whether it carries
// its card data — a fresh analysis does, a cached core+lines does not until
// ensureCards has run.
function adoptPage(p, withCards) {
  page = p;
  info = Object.fromEntries(page.chars.map(c => [c.char, c]));
  // the coverage index, derived rather than loaded: the payload is in hand,
  // so this cannot disagree with it
  covRows = covIndexOf(page).chars;
  covBy = Object.fromEntries(covRows.map(c => [c.char, c]));
  cardsReady = withCards;
}

// The learn and quiz cards are the only surfaces that need the card bucket —
// the decomposition tree, the series dropdowns, the cousin line, the
// dictionary example words. Attach them once per text per session, from the
// shared store when it can supply every one, and otherwise by re-analysing,
// which refills every bucket. A long text's cards will not all be resident
// (they are 1.27 MB against a 500 KB store), so this is the normal path for
// one, and it costs the wait once rather than on every card.
async function ensureCards() {
  if (cardsReady || !page) return;
  const keys = page.chars.map(c => keyOf(c.char, c.reading));
  await warmCards(keys);           // the card bucket is lazy too, and this is its await
  const have = readCharCards(keys);
  if (Object.keys(have).length === keys.length) {
    attachCharCards(page, have);
    cardsReady = true;
    return;
  }
  const s = curText();
  if (!s) return;
  try {
    const fresh = await analyse(s.text);
    savePage(textId, fresh);
    adoptPage(fresh, true);
  } catch (e) {
    // no server, or it failed: attach what the store did have and carry on.
    // The card renders without its mnemonic block rather than not at all.
    attachCharCards(page, have);
  }
}

// "as written": the Reader (and this text's quiz words) show the pasted
// glyphs; jyutping and the SRS card stay on the traditional form. Remembered
// per text — an additive field on the texts entry, no key-layout change.
$('asWritten').onchange = () => {
  const s = curText();
  if (!s) return;
  s.asWritten = $('asWritten').checked;
  save('songpath.texts', texts);
  renderLines();
  styleReader();
};

// self-heal: a card minted under a key the payload no longer uses merges
// into its current card — a 變調 variant reading (靜:zing2 from before the
// folding rule) into its base reading, and a pasted-glyph card (电:din6
// from before sheet-only simplified forms normalized) into the traditional
// card the glyph now maps to. The better-scheduled card wins.
function foldVariantCards(p) {
  let moved = false;
  const fold = (vk, bk) => {
    if (!cards[vk] || vk === bk) return;
    if (!cards[bk] || cards[bk].rung < cards[vk].rung) cards[bk] = cards[vk];
    delete cards[vk];
    moved = true;
  };
  for (const c of p.chars)
    for (const r of c.readings || []) {
      const jp = r.variant_of || r.jp;
      if (r.variant_of) fold(keyOf(c.char, r.jp), keyOf(c.char, jp));
      if (c.src) fold(keyOf(c.src, r.jp), keyOf(c.char, jp));
    }
  if (dropOrphanCards(p)) moved = true;
  if (moved) saveCards();
}

// A card for a reading the server no longer teaches. PAGE_V 14 stopped
// admitting the sheet's 異讀, so a store built before it holds 過:gwo1 and
// 些:so1 — and nothing reclaims them: the Due deck reads songpath.cards
// directly, so an orphan comes due forever with no text able to give it
// context. Deletable because readings[] is computed from the character and
// its dictionary evidence, not from the text: the set is identical in every
// text across the 1,409 characters of the library, so a reading missing from
// the payload in front of us is missing everywhere. The one exception is
// readings_row's no-context fallback, which inserts c.pron for a character
// the text gives no in-word evidence at all — for 45 of the 7,053 characters
// that value is in no dictionary and no sheet column (忄 sam1, 广 jin1, 凵
// ham1: bare components, not text characters), so their payloads can carry a
// row others don't and a card earned there would be dropped here. One card,
// for a radical, and per DESIGN.md the store is test data — the alternative
// was wiping songpath.cards whole. Only characters this payload carries are
// judged; the rest are simply unknown here.
function dropOrphanCards(p) {
  let dropped = false;
  for (const c of p.chars) {
    const live = new Set((c.readings || []).map(r => r.variant_of || r.jp));
    if (!live.size) continue;                  // no rows: judge nothing
    for (const k of cardsOf(c.char))
      if (!live.has(k.slice(k.indexOf(':') + 1))) {
        delete cards[k];
        dropped = true;
      }
  }
  return dropped;
}

$('back').onclick = () => renderLibrary();
document.querySelectorAll('nav button').forEach(b =>
  b.onclick = () => setMode(b.dataset.mode));
$('toLearn').onclick = () => setMode('learn');

async function setMode(mode) {
  for (const m of ['calibrate', 'learn', 'review', 'reader'])
    $(m).style.display = m === mode ? '' : 'none';
  document.querySelectorAll('nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'calibrate') renderCalibrate();
  if (mode === 'learn' || mode === 'review') {
    if (!cardsReady) $('learnPhase').textContent = 'Preparing cards…';
    await ensureCards();
    if (mode === 'learn') startLearn(); else startReviewMode();
  }
  if (mode === 'reader') { styleReader(); applyReaderMode(); }
  updateMeter();
}

function updateMeter() {
  if (!textId || !page) return;              // no text open (e.g. the Due screen)
  const pct = coverageOf(covRows);
  const n = covRows.filter(c => charDone(c)).length;
  $('meterFill').style.width = pct + '%';
  // no denominator: 1,098 characters is what the text contains, not a target,
  // and putting it here made the meter read as a progress bar towards
  // finishing rather than towards reading (plan 7 Phase 1)
  $('meterText').textContent =
    `${pct}% readable — ${n} character${n === 1 ? '' : 's'} acquired`;
}

// the study queue: one entry per unacquired (character, reading) pair the
// text actually uses, biggest readability payoff first
function unacquiredKeys() {
  const keys = [];
  for (const c of covRows)
    for (const jp of inTextReadings(c))
      if (!isKnownKey(c.char, jp)) keys.push({char: c.char, jp, count: c.count});
  return keys.sort((a, b) => b.count - a.count);
}
