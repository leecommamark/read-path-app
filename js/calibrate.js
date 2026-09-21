// calibrate.js — the calibrate tab: tap-to-know over the characters this
// text needs and the learner doesn't have yet.
// ---------- calibrate: only characters not already known ----------
// How many of the unknown characters the strip draws at once. A real
// 4,700-character text has around 1,100 of them, and a wall that size is not
// a tap-to-know surface, it is a discouragement. Capped for display only —
// "show more" raises it, so every character stays reachable, and the queue
// itself is untouched (plan 7 Phase 2). A control rather than a plain hint,
// because tapping a token toggles it rather than re-rendering the strip, so a
// hint alone would have put everything past the sixtieth out of reach.
const CAL_STEP = 60;
let calShown = CAL_STEP;

function renderCalibrate() {
  // every unknown character in the text, including ones with no reading on
  // file (those are excluded from Learn/Review but should still be visible)
  const all = page.chars.filter(c => !charDone(covBy[c.char]))
    .sort((a, b) => b.count - a.count);
  const cs = all.slice(0, calShown);
  const norm = page.normalized || [];
  $('calNorm').style.display = norm.length ? '' : 'none';
  $('calNorm').innerHTML = norm.length
    ? `${norm.some(n => n.simp)
         ? 'The source used simplified forms — shown in traditional (HK) form.'
         : 'Variant forms were normalized to the HK standard.'}
       <details><summary>${norm.length} conversion${norm.length > 1 ? 's' : ''}</summary>
       ${norm.map(n => `${n.simp ? '<span class="s-badge">簡</span> ' : ''}${esc(n.src)}→${esc(n.dst)}${n.count > 1 ? ' ×' + n.count : ''}`).join(', ')}
       </details>`
    : '';
  $('calTokens').innerHTML = cs.length ? cs.map(c => `
    <span class="token${isKnownKey(c.char, cardJp(c, c.reading)) ? ' known' : ''}" data-char="${esc(c.char)}"
      title="${esc(c.reading || '?')} — ${esc(c.gloss || '')} · ${c.count}× in text">
      ${esc(c.char)}</span>`).join('')
    : '<p class="hint">No new characters — you know everything in this text.</p>';
  if (all.length > cs.length)
    $('calTokens').innerHTML +=
      `<p class="hint"><a href="#" id="calMore">show ${
        Math.min(CAL_STEP, all.length - cs.length)} more</a> of ${
        all.length - cs.length} left</p>`;
  const more = $('calMore');
  if (more) more.onclick = ev => {
    ev.preventDefault();
    calShown += CAL_STEP;
    renderCalibrate();
  };
  document.querySelectorAll('#calTokens .token').forEach(el => {
    el.onclick = () => {
      // toggles the primary-reading card (the documented simplification for
      // the tap-to-know surfaces); enters at the mature rung
      const c = info[el.dataset.char];
      if (!c || !c.reading) return;
      const jp = cardJp(c, c.reading);
      const key = keyOf(c.char, jp);
      if (cards[key]) { delete cards[key]; saveCards(); }
      else mintCard(key, MATURE_RUNG);
      el.classList.toggle('known', isKnownKey(c.char, jp));
      updateMeter();
    };
  });
}
