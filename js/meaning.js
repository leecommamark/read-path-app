// meaning.js — the meaning track's own screen: what the learner is holding
// under `@part:` and `@fam:`, which until plan 13 no surface showed them.
// Reached from the Characters screen. Read-only here; its actions are Phase 4.
//
// THE THIRD DOOR to ensureMeaning(). `setMode` and `openDue` are the others
// and this one awaits exactly as they do. The rule is unchanged: never from
// hydrate, because an empty profile must see the intro while the tables are
// still arriving (plan 9.1 Phase 2); the failure caught and swallowed, since
// the sound track does not depend on these tables; and the scheduling run on
// every call, because what is quizzable changes as characters are acquired
// and a door is exactly where that should be noticed.
//
// It reads `MC_WORDING` and `semanticOf` for the meaning line, so a part
// reads here the way it reads on its own card — "Often to do with …" for a
// loose part, the plain meaning for a strong one. Nothing is called at load
// time, so index.html's order is free to keep this file with the screens.

$('toMeaning').onclick = () => openMeaning();
$('meaningBack').onclick = () => openChars();

// How many family rows the list draws before it offers the rest. A placed-out
// learner has EVERY family due at once — scheduleFamilies mints them due
// immediately (2026-09-21) — so 252 rows is the ordinary first case here, not
// an edge one, and an uncapped list would bury the parts above it. Same
// "show N more" the calibrate strip uses, for the same reason.
const FAM_STEP = 20;
let famShown = FAM_STEP;

async function openMeaning() {
  show('meaningscreen');
  famShown = FAM_STEP;
  $('partRows').innerHTML = '<p class="hint" lang="en">Loading…</p>';
  $('famSummary').textContent = '';
  $('famRows').innerHTML = '';
  try { await ensureMeaning(); } catch (e) { /* no meaning track this run */ }
  scheduleFamilies();
  renderMeaning();
}

// The store's own semantics, in the learner's words rather than a ladder
// invented for this screen. A lapse sets `due` to now, so lapsed implies due
// and is tested first — it is the stronger thing to know. "not met" is the
// absence of a card, which for a part means it has never been offered in a
// Learn batch, and for a family cannot happen (a family only exists carded).
//
// Days are CALENDAR days, through due.js's own helper: the learner is asking
// which morning to come back on. Spelled "in 6 days" rather than the quiz's
// "in 30 d", which counts ladder days and is a different measure.
const MS_NEW = {cls: 'ms-new', text: 'not met'};
function cardState(key) {
  const c = cards[key];
  if (!c) return MS_NEW;
  const now = Date.now();
  if (c.rung === 0 && c.lapses > 0 && c.due <= now)
    return {cls: 'ms-lapsed', text: 'lapsed'};
  if (c.due <= now) return {cls: 'ms-due', text: 'due now'};
  const days = calendarDays(c.due);
  return {cls: 'ms-later',
          text: days <= 0 ? 'next review later today'
              : days === 1 ? 'next review tomorrow'
              : `next review in ${days} days`};
}

const stateHtml = st =>
  `<span class="mp-state ${st.cls}" lang="en">${esc(st.text)}</span>`;

const actBtn = (ch, act, label) =>
  `<button class="mp-act" data-part="${esc(ch)}" data-act="${act}" lang="en">`
  + `${label}</button>`;

function partRowHtml(ch) {
  const row = semanticOf(ch);
  // MC_WORDING escapes what it interpolates, so this is already safe HTML —
  // the same frame the form-of card draws, minus the card
  const meaning = row
    ? (MC_WORDING[row.reliability] || MC_WORDING.strong)(row.meaning) : '';
  const c = cards[partKey(ch)];
  // "I know this" is offered only where it would do something: knowPart
  // never downgrades, so on a card already at or past the mature rung the
  // button would be a no-op dressed as an action.
  const acts = (c && c.rung >= MATURE_RUNG ? '' : actBtn(ch, 'know', 'I know this'))
    + (c ? actBtn(ch, 'forget', 'Forget') : '');
  return `<div class="mp-row" data-part="${esc(ch)}">
      <span class="mp-char">${esc(ch)}</span>
      <span class="mp-meaning">${meaning}</span>
      ${stateHtml(cardState(partKey(ch)))}
      <span class="mp-acts">${acts}</span>
    </div>`;
}

// A card the learner holds for a shape the track does not teach. They arise:
// an older table carded it, an import brought it, a console wrote it. However
// they arise they are exactly what this screen exists to end — a card you
// cannot see, reset or say you know — so they are listed rather than left
// invisible for want of a row. No "I know this": nothing will ever quiz them,
// so there is nothing to know, and Forget is the only honest action.
function heldRowHtml(ch) {
  const row = semanticOf(ch);
  const meaning = row
    ? (MC_WORDING[row.reliability] || MC_WORDING.strong)(row.meaning) : '';
  return `<div class="mp-row mp-held" data-part="${esc(ch)}">
      <span class="mp-char">${esc(ch)}</span>
      <span class="mp-meaning">${meaning}</span>
      ${stateHtml(cardState(partKey(ch)))}
      <span class="mp-acts">${actBtn(ch, 'forget', 'Forget')}</span>
    </div>`;
}

function famRowHtml(key) {
  const head = meaningOf(key);
  const ix = meaningIndex();
  const row = ix && ix.rows.get(head);
  const n = row ? row[2].length : 0;
  // the head's own reading and how many characters hang off it — what makes
  // one family recognisable from another in a list of 252
  const about = `${row && row[3] ? esc(row[3]) + ' · ' : ''}`
    + `${n} member${n === 1 ? '' : 's'}`;
  return `<div class="mp-row" data-fam="${esc(head)}">
      <span class="mp-char">${esc(head)}</span>
      <span class="mp-meaning" lang="en">${about}</span>
      ${stateHtml(cardState(key))}
    </div>`;
}

// Carded, due and lapsed. `due` comes from dueMeaningKeys and not from the
// cards directly, so this line and the library button count the same thing:
// a family that cannot be asked is in neither (plan 13 Phase 2). Lapsed is a
// SUBSET of due — a lapse is due now — and a row shows the stronger of the
// two, so nothing is listed twice.
function famStats() {
  const now = Date.now();
  const isFam = k => isMeaningKey(k) && meaningKind(k) === 'fam';
  const carded = Object.keys(cards).filter(isFam);
  const due = dueMeaningKeys().filter(isFam);
  const lapsed = carded.filter(k => {
    const c = cards[k];
    return c.rung === 0 && c.lapses > 0 && c.due <= now;
  });
  return {carded, due, lapsed};
}

// ---------- the actions ----------
// Delegated on the container, because the rows are rewritten on every render
// and the harness's querySelectorAll returns [] — the same reason the
// Characters grid delegates its 3,000 tokens.
const rowAction = e => {
  const b = e.target && e.target.closest && e.target.closest('button');
  if (!b || !b.dataset.part) return;
  (b.dataset.act === 'know' ? knowPartHere : forgetPart)(b.dataset.part);
};
$('partRows').onclick = rowAction;
$('heldRows').onclick = rowAction;

// Marking a part known makes every family that needed it quizzable, so the
// count can RISE a moment after the learner says they know something. That is
// correct — it is what meeting the part in a Learn batch would have done — and
// the screen shows it rather than letting it surprise them on the library
// button: scheduleFamilies runs here, and the families summary below is
// redrawn in the same breath.
function knowPartHere(ch) {
  if (!knowPart(ch)) return;          // already at or past the mature rung
  scheduleFamilies();
  renderMeaning();
}

// Deleting where the learner can see what goes, which is what plan 10 Phase 5
// withheld a delete for want of. Through the shared undo toast, so it is the
// same promise the reader and the Learn card make about a deletion.
function forgetPart(ch) {
  const key = partKey(ch);
  if (!cards[key]) return;
  const snap = {key, card: {...cards[key]}};
  delete cards[key];
  saveCards();
  renderMeaning();
  showUndo(`meaning part ${ch} forgotten`, snap, s => {
    cards[s.key] = s.card;
    saveCards();
    renderMeaning();
  });
}

// RESET, not clear, and the wording says so. scheduleFamilies mints a card for
// every quizzable family that has none, and it runs at every door — so cards
// deleted here are back before the learner reaches the library, and a button
// labelled "clear" would undo itself in front of them. What deleting them
// actually does is drop the rung and the lapses: the questions come back from
// the start. Suppressing them for good would need a stored "not this track"
// marker, which is a new key shape and a different plan.
$('famReset').onclick = () => {
  const keys = Object.keys(cards).filter(k => isMeaningKey(k)
                                           && meaningKind(k) === 'fam');
  if (!keys.length) return;
  if (!confirm(`Reset all ${keys.length} tell-apart card`
    + `${keys.length === 1 ? '' : 's'}? Their review history goes and the `
    + 'questions start again. Your characters and meaning parts are not '
    + 'touched.')) return;
  for (const k of keys) delete cards[k];
  saveCards();
  renderMeaning();
};

function renderMeaning() {
  const ix = meaningIndex();
  if (!ix) {
    // absent, not broken: a build whose tables did not install still has a
    // working sound track, and this screen says so rather than throwing
    $('partRows').innerHTML = '<p class="hint" lang="en">The meaning track\'s '
      + 'tables have not loaded. Open a text or Daily review once, then come '
      + 'back.</p>';
    $('partsHint').style.display = 'none';
    $('heldBlock').style.display = 'none';
    $('famSummary').textContent = '';
    $('famReset').style.display = 'none';
    $('famRows').innerHTML = '';
    return;
  }
  // value order — the order the track introduces them, which is what
  // newMeaningParts sorts by, so the screen reads as the queue it is
  const parts = [...ix.cardable.keys()]
    .sort((a, b) => ix.cardable.get(b) - ix.cardable.get(a));
  $('partRows').innerHTML = parts.map(partRowHtml).join('');
  $('partsHint').style.display = '';

  // and anything held that the list above does not cover
  const held = Object.keys(cards)
    .filter(k => isMeaningKey(k) && meaningKind(k) === 'part')
    .map(meaningOf)
    .filter(ch => !ix.cardable.has(ch))
    .sort();
  $('heldBlock').style.display = held.length ? '' : 'none';
  $('heldRows').innerHTML = held.map(heldRowHtml).join('');

  const {carded, due, lapsed} = famStats();
  $('famReset').style.display = carded.length ? '' : 'none';
  const bits = [`${carded.length} carded`];
  if (due.length) bits.push(`${due.length} due`);
  if (lapsed.length) bits.push(`${lapsed.length} lapsed`);
  $('famSummary').textContent = carded.length
    ? bits.join(' · ')
    : 'None yet — a family is carded once you have met one of its characters '
      + 'and been introduced to the meaning part that tells it apart.';

  // only what a learner might act on: lapsed first, then the rest of the due
  const lapsedSet = new Set(lapsed);
  const rows = [...lapsed, ...due.filter(k => !lapsedSet.has(k))];
  const shown = rows.slice(0, famShown);
  $('famRows').innerHTML = shown.map(famRowHtml).join('')
    + (rows.length > shown.length
        ? `<p class="hint"><a href="#" id="famMore">show ${
            Math.min(FAM_STEP, rows.length - shown.length)} more</a> of ${
            rows.length - shown.length} left</p>`
        : '');
  const more = $('famMore');
  if (more) more.onclick = ev => {
    ev.preventDefault();
    famShown += FAM_STEP;
    renderMeaning();
  };
}
