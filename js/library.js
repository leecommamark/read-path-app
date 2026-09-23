// library.js — the library screen: coverage, the text list, lrclib search
// and paging, adding a text, the payload cache and its version, and the
// progress export / import buttons.
// ---------- library ----------
// a changed-tone (變調) reading has no card of its own — it folds into its
// base reading (靜靜 zing2 is covered by the 靜:zing6 card)
const cardJp = (c, jp) =>
  c?.readings?.find(r => r.jp === jp)?.variant_of || jp;
// the same fold over a coverage-index row, whose readings are `rs` and whose
// variant base is `v` (covIndexOf in store.js). Two shapes, two one-liners:
// one helper would have to sniff which of them it had been handed.
const cardJpIx = (row, jp) =>
  row?.rs?.find(r => r.jp === jp)?.v || jp;

// A character counts as covered when every reading this text uses is
// acquired. Coverage runs on index rows and never on payload rows: the
// library list and the Due deck have only the index, and the text screen
// derives one from the open page (covRows, built in openText), so there is
// one implementation rather than one per shape.
function inTextReadings(row) {
  const rs = [...new Set(row.rs.filter(r => r.t).map(r => r.v || r.jp))];
  return rs.length ? rs : (row.reading ? [cardJpIx(row, row.reading)] : []);
}
// `also` is an optional Set of card keys to count as known on top of the SRS
// store — what the learn card uses to say what the next five buy, without
// minting anything. Type-checked rather than merely truthy-checked: charDone
// gets passed straight to Array.filter in places, and filter hands a callback
// the index as its second argument, which is falsy only for the first row.
function charDone(row, also) {
  const extra = also instanceof Set ? also : null;
  const rs = inTextReadings(row);
  return rs.length > 0 && rs.every(jp =>
    isKnownKey(row.char, jp) || (extra && extra.has(keyOf(row.char, jp))));
}

function coverageOf(rows, also) {
  const total = rows.reduce((s, c) => s + c.count, 0);
  const got = rows.reduce((s, c) => s + (charDone(c, also) ? c.count : 0), 0);
  return total ? Math.round(100 * got / total) : 0;
}

// the same figure over a subset of the lines, for one reader section. Counted
// from the lines rather than from the index, because a character's count is
// document-wide and a section needs its own; what "done" means is unchanged,
// so the two figures are the same measure at two scales (plan 4 Phase 4).
function coverageOfLines(lines) {
  let total = 0, got = 0;
  for (const l of lines) {
    if (l.blank) continue;
    for (const p of l.parts) {
      if (p.type !== 'word') continue;
      for (const c of p.chars) {
        total++;
        if (covBy[c.char] && charDone(covBy[c.char])) got++;
      }
    }
  }
  return total ? Math.round(100 * got / total) : 0;
}

function show(screen) {
  for (const s of ['library', 'charscreen', 'due', 'text', 'howitworks'])
    $(s).style.display = s === screen ? '' : 'none';
}

// ---------- first run (plan 9 Phase 7) ----------
// The order FIRST_RUN_CONTENT.md asks for: how-it-works, then the placement
// test or a skip, then the library. Shown once, on an empty store; afterwards
// the "How it works" link on the library screen reaches it.
//
// The copy is supplied verbatim and lives in index.html; nothing here writes
// any of it. What this owns is when it appears and where each button goes.
const SEEN_INTRO = 'songpath.seenIntro';

function showIntro() { show('howitworks'); }

// The predicate boot.js decides on. It was `firstRunOrLibrary()`, which both
// decided and drew; plan 9.1 Phase 2 needed the decision on its own, because
// the draw now happens before the tables install rather than after. hydrate()
// has already defaulted the marker to `true` for any store that holds a
// library, so an existing learner is never a first run.
const seenIntro = () => load(SEEN_INTRO, false) === true;

function leaveIntro() {
  save(SEEN_INTRO, true);
}

$('toIntro').onclick = () => showIntro();
$('introSkip').onclick = () => { leaveIntro(); renderLibrary(); };
$('introPlacement').onclick = () => { leaveIntro(); openChars(); };

// The starter text, imported through the ordinary path — same preview rules,
// same analysis, same store — so it is deletable like any other text and
// carries no special case anywhere. It ships as a plain file beside the app
// (build_dist.py writes dist/starter/; server.py serves the same URL from
// ../texts for the dev loop), which is the only text that ships.
const STARTER_URL = 'starter/starter_jamcaa.txt';

async function importStarter() {
  const btn = $('trySample');
  btn.disabled = true;
  const was = btn.textContent;
  btn.textContent = 'Adding…';
  try {
    const r = await fetch(STARTER_URL);
    if (!r.ok) throw new Error('could not read the sample text');
    const body = (await r.text()).trim();
    const lines = body.split('\n').filter(l => l.trim());
    // the file leads with its own title line, as a pasted text would
    const title = lines.length > 1 ? lines[0].trim() : '飲茶';
    const rest = lines.length > 1 ? lines.slice(1).join('\n').trim() : body;
    await addTextData(title, 'Read Path sample', rest);
  } catch (e) {
    $('status').innerHTML = '<span class="error">' + esc(e.message) + '</span>';
    btn.disabled = false;
    btn.textContent = was;
  }
}

$('trySample').onclick = importStarter;
$('addOwn').onclick = () => {
  $('newText').focus();
  $('newText').scrollIntoView();
};

function renderLibrary() {
  show('library');
  // A write that did not land, said out loud. Nothing read `flushFailed`
  // before plan 8 Phase 3, and a store that fails in silence is the exact bug
  // Phase 0 found in the store this one replaced.
  // The tables are the other thing that can fail before this screen is
  // reached, and until plan 9.1 Phase 2 a failed install showed nothing at
  // all — the boot chain stopped and the page stayed blank. It is read here
  // rather than announced once by boot() so that it survives a re-render.
  const bad = storeTrouble();
  const warn = bad
    ? `Some progress could not be saved (${bad.message}). ` +
      `${bad.pending} item${bad.pending === 1 ? '' : 's'} still pending — ` +
      `use Export progress to keep a copy.`
    : tablesFailed
      ? `The character tables could not be loaded (${tablesFailed.message}). ` +
        `Adding a text and the placement test both need them — reopen the app ` +
        `once you have a connection.`
      : '';
  $('storeWarn').style.display = warn ? '' : 'none';
  $('storeWarn').textContent = warn;
  // BOTH TRACKS. Counting sound keys alone let the button read "Due today
  // (0)" with 92 families waiting behind it — which is what a placed-out
  // learner sees, since the placement test mints every sound card at the
  // mature 30 d rung and the families are due at once (Mark, 2026-09-21).
  //
  // And schedule first, or the count is a card behind: a family becomes
  // quizzable the moment its member is acquired, but nothing notices until a
  // DOOR runs — and the library is not one. Coming back from a Learn batch,
  // the button would say 4 and the deck would then hold 6.
  //
  // This is a door only when the tables are ALREADY in memory:
  // scheduleFamilies is a no-op while MEANING is null, so the install stays
  // behind the paint where plan 9.1 Phase 2 put it, and no await enters the
  // library's render path.
  scheduleFamilies();
  $('toDue').textContent =
    `Daily review (${dueKeys().length + dueMeaningKeys().length})`;
  $('textlist').innerHTML = texts.length ? texts.map(s => {
    const ix = loadCov(s.id);
    const cov = ix ? coverageOf(ix.chars) + '% readable' : '';
    return `<div class="textrow" data-id="${s.id}">
      <span class="s-title">${esc(s.title)}${s.source ? ` <span class="s-source">— ${esc(s.source)}</span>` : ''}</span>
      ${scriptBadge(ix)}
      <span class="s-cov">${cov}</span>
      <button class="s-del" title="delete" aria-label="Delete this text">✕</button>
    </div>`;
  }).join('') : '<p class="hint">No texts yet — add one below.</p>';
  // while the library is empty, offer the two ways in. Once any text exists
  // the library looks exactly as it did (FIRST_RUN_CONTENT.md).
  $('emptyActions').style.display = texts.length ? 'none' : '';
  // The library with nothing in flight is the safe moment to pick up a new
  // build, and it is usually not the moment the new worker claimed the page.
  // boot.js decides; this only says "now would be a good time".
  reloadForNewBuild();
  for (const row of document.querySelectorAll('.textrow')) {
    row.querySelector('.s-title').onclick = () => openText(+row.dataset.id);
    row.querySelector('.s-del').onclick = () => {
      if (!confirm('Delete this text?')) return;
      texts = texts.filter(s => s.id !== +row.dataset.id);
      save('songpath.texts', texts);
      dropTextCache(row.dataset.id);   // its own keys; never the shared cards
      renderLibrary();
    };
  }
}

// ---------- progress export / import (backup insurance — DESIGN.md) ----------
// These follow the bytes. Since plan 8 Phase 2 the store is IndexedDB, and an
// export that still walked localStorage would have downloaded an empty file
// and called it a backup — which matters more now, not less, because the
// IndexedDB bucket is best-effort and reclaimable under storage pressure.
// Export reads the whole store, not the cache, because most of it is lazy and
// a backup of what happens to be warm is not a backup.
$('exportProgress').onclick = async () => {
  await flush();
  const dump = {};
  for (const [k, v] of await dbAll()) if (k.startsWith('songpath.')) dump[k] = v;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 1)],
                                        {type: 'application/json'}));
  a.download = `songpath-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('importProgress').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0];
  $('importFile').value = '';
  if (!f) return;
  let dump;
  try { dump = JSON.parse(await f.text()); } catch { alert('Not a Read Path export.'); return; }
  const keys = Object.keys(dump || {}).filter(k => k.startsWith('songpath.'));
  if (!keys.length) { alert('Not a Read Path export.'); return; }
  if (!confirm(`Replace all progress with ${keys.length} stored `
    + `key${keys.length === 1 ? '' : 's'} from “${f.name}”?`)) return;
  await replaceStore(Object.fromEntries(keys.map(k => [k, dump[k]])));
  location.reload();
};

let search = null;  // {rs, capped, shown} — last search, for paging

$('doSearch').onclick = async () => {
  // A shipped build makes no network call but for its own static files, and
  // this handler is the third fetch site — registered unconditionally, with
  // FEATURES.lyricsSearch only hiding the box that reaches it. The flag is
  // not flipped and the route stays mounted in server.py; device mode simply
  // has no server to ask.
  if (BUILD_MODE === 'device') return;
  const q = $('q').value.trim(), artist = $('qArtist').value.trim();
  if (!q && !artist) return;
  $('results').innerHTML = '<p class="hint">Searching…</p>';
  try {
    const params = new URLSearchParams();
    if (q && artist) { params.set('title', q); params.set('artist', artist); }
    else if (artist) params.set('artist', artist);
    else params.set('q', q);
    const r = await fetch('api/search?' + params);
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    search = {rs: body.results, capped: body.capped, shown: Math.min(10, body.results.length)};
    renderResults();
  } catch (e) {
    $('results').innerHTML = '<p class="error">' + esc(e.message) + '</p>';
  }
};
for (const id of ['q', 'qArtist'])
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('doSearch').click(); });

function renderResults() {
  const {rs, capped, shown} = search;
  if (!rs.length) {
    $('results').innerHTML = '<p class="hint">No results — try the artist field, or paste the text into the box above.</p>';
    return;
  }
  const uploads = rs.reduce((s, x) => s + x.copies, 0);
  $('results').innerHTML =
    `<p class="hint">${rs.length} result${rs.length === 1 ? '' : 's'}${uploads > rs.length ? ` · ${uploads} uploads` : ''}</p>` +
    rs.slice(0, shown).map((x, i) => `
      <div class="result" data-i="${i}">
        <div class="r-head">
          <b>${esc(x.title)}</b> — ${esc(x.artist)}
          <span class="r-meta">${esc(x.album)}${x.duration ? ' · ' + Math.floor(x.duration / 60) + ':' + String(x.duration % 60).padStart(2, '0') : ''}${x.synced ? ' · synced' : ''}</span>${x.copies > 1 ? `<span class="r-copies">×${x.copies} copies</span>` : ''}
        </div>
        <div class="r-preview">
          <div class="r-text">${esc(x.lyrics)}</div>
          <button class="r-add">Add</button><a href="#" class="r-edit">Edit first</a>
        </div>
      </div>`).join('') +
    (shown < rs.length ? `<p><button id="moreResults">Show ${Math.min(10, rs.length - shown)} more</button></p>` : '') +
    (shown >= rs.length && capped ? '<p class="hint">LRCLIB returns at most 20 — narrow by artist to see others.</p>' : '');
  for (const el of document.querySelectorAll('.result')) {
    const x = search.rs[+el.dataset.i];
    el.querySelector('.r-head').onclick = () => el.classList.toggle('open');
    el.querySelector('.r-add').onclick = () => addTextData(x.title, x.artist, x.lyrics);
    el.querySelector('.r-edit').onclick = ev => {
      ev.preventDefault();
      $('newTitle').value = x.title;
      $('newSource').value = x.artist;
      $('newText').value = x.lyrics;
      titleAuto = false; importNote = 'from lrclib.net'; stageImport();
      $('newText').scrollIntoView({behavior: 'smooth', block: 'center'});
    };
  }
  const more = $('moreResults');
  if (more) more.onclick = () => { search.shown = Math.min(search.shown + 10, search.rs.length); renderResults(); };
}

// `source` is free text — an LRCLIB artist is one kind of source, and from
// Phase 3 an imported file's name is another.
async function addTextData(title, source, body) {
  $('status').textContent = 'Analysing…';
  try {
    const p = await analyse(body);
    const id = texts.length ? Math.max(...texts.map(s => s.id)) + 1 : 1;
    texts.push({id, title: title || 'Untitled', source, text: body});
    save('songpath.texts', texts);
    savePage(id, p);
    $('newTitle').value = ''; $('newSource').value = ''; $('newText').value = '';
    importNote = ''; titleAuto = true; stageImport();
    $('status').textContent = '';
    if (FEATURES.lyricsSearch) {
      $('results').innerHTML = ''; $('q').value = ''; $('qArtist').value = '';
      search = null;
    }
    openText(id, 'calibrate');
  } catch (e) {
    $('status').innerHTML = '<span class="error">' + esc(e.message) + '</span>';
  }
}

// ---------- import: paste or a local file, no network ----------
// Keep in sync with MAX_TEXT in server.py. Checked here as well as there so
// the learner gets told before a 20,000-character POST, and told what to do.
const MAX_TEXT_CHARS = 20_000;
// the title field is inferred until the learner types in it, after which
// their title stands however the body changes
let titleAuto = true;

const firstLine = body => (body.split(/\n/).find(l => l.trim()) || '').trim();

// One source of truth: whatever is in the textarea is what gets imported. An
// LRC is stripped on arrival rather than at Add time, so the preview shows
// the real thing and stays editable.
function stageImport() {
  const body = $('newText').value;
  const trimmed = body.trim();
  $('preview').style.display = trimmed ? '' : 'none';
  if (!trimmed) return;
  if (titleAuto) $('newTitle').value = firstLine(trimmed).slice(0, 60);
  const lines = trimmed.split(/\n/).filter(l => l.trim()).length;
  // the same rule the batch applies, so a paste and a file cannot disagree
  const problem = importProblem(trimmed);
  if (problem) {
    $('previewMeta').className = 'error';
    $('previewMeta').textContent = problem.startsWith('no Chinese')
      ? 'No Chinese characters in this — there would be nothing to learn.'
      : problem + (problem.includes('limit')
          ? '. Split it and import the parts; nothing has been cut.' : '.');
    $('addText').disabled = true;
    return;
  }
  $('previewMeta').className = 'hint';
  $('previewMeta').textContent =
    `${lines} line${lines === 1 ? '' : 's'}, ` +
    `${body.length.toLocaleString()} character${body.length === 1 ? '' : 's'}` +
    (importNote ? ` · ${importNote}` : '');
  $('addText').disabled = false;
}

let importNote = '';                     // e.g. what a file arrived as

$('newText').addEventListener('input', () => { importNote = ''; stageImport(); });
$('newTitle').addEventListener('input', () => { titleAuto = false; });

// Mirrors CJK_RUN in pathbuilder.py — ext A, the BMP block, and plane 2 — so
// the client and the analysis agree on what counts as a Chinese character. A
// text with none of them analyses perfectly happily into a payload with zero
// characters, which is a text the learner can do nothing with; this is what
// stops one being added at all, on both the paste path and the batch.
const CJK = /[\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}\u{20000}-\u{2ffff}]/u;

// what the file picker does to one file, before anything looks at the result:
// the extension is a hint and the content decides, so a pasted or mis-named
// LRC is still an LRC
function bodyOfFile(raw) {
  if (!looksLikeLRC(raw)) return {body: raw, note: ''};
  return {body: plainFromLRC(parseLRC(raw)), note: 'timestamps stripped'};
}

// Why a text cannot be added, or '' if it can. One rule, two surfaces: the
// preview disables Add and says this, and the batch logs it and moves on.
// The duplicate test is on the **body**, not the title — two files can fairly
// open with the same line, and what a learner actually does by accident is
// select overlapping folders and import the same file twice.
function importProblem(body) {
  if (!body) return 'empty';
  if (!CJK.test(body)) return 'no Chinese characters in it';
  if (body.length > MAX_TEXT_CHARS)
    return `${body.length.toLocaleString()} characters — the limit is ` +
           `${MAX_TEXT_CHARS.toLocaleString()}`;
  const dup = texts.find(t => (t.text || '').trim() === body);
  return dup ? `already in your library as “${dup.title}”` : '';
}

$('pickFile').onclick = () => $('textFile').click();
$('textFile').onchange = async () => {
  const files = [...$('textFile').files];
  $('textFile').value = '';               // so the same files can be re-picked
  if (!files.length) return;
  // One file keeps the preview, which is the good path: the title and source
  // are editable and the learner sees exactly what will be imported. Several
  // cannot be previewed, so they queue.
  if (files.length > 1) return importFiles(files);
  const f = files[0];
  const {body, note} = bodyOfFile(await f.text());
  importNote = note;
  $('newText').value = body;
  titleAuto = true;
  $('newSource').value = f.name.replace(/\.[^.]+$/, '');
  stageImport();
  $('preview').scrollIntoView({behavior: 'smooth', block: 'nearest'});
};

// ---------- batch import (plan 8 Phase 3) ----------
// One file at a time, with a running count, a cancel that leaves what has
// already landed, and a line per file saying what happened to it. It waits on
// each analysis, so the progress line is real rather than decorative, and it
// flushes after each file so that a store which has stopped accepting writes
// is discovered on the file that broke it rather than twenty files later.
//
// **A folder picker is the shell's call, not this one's.** A browser gives
// multi-file selection; a genuine folder browse is the native document
// provider and arrives with the wrapper.
let bulkRun = null;                        // {cancel} while a batch is running

const bulkLine = (name, what, cls) => {
  const p = document.createElement('p');
  p.className = cls || 'hint';
  p.textContent = `${name} — ${what}`;
  $('bulkLog').appendChild(p);
};

async function importFiles(files) {
  if (bulkRun) return;
  const run = bulkRun = {cancel: false};
  clearStoreTrouble();
  $('bulk').style.display = '';
  $('bulkLog').innerHTML = '';
  $('bulkCancel').style.display = '';
  $('bulkDone').style.display = 'none';
  $('preview').style.display = 'none';
  $('status').textContent = '';
  let added = 0, skipped = 0, failed = 0, stopped = '';

  for (let i = 0; i < files.length; i++) {
    if (run.cancel) { stopped = 'Cancelled'; break; }
    const f = files[i];
    $('bulkProgress').textContent =
      `Importing ${i + 1} of ${files.length} — ${f.name}`;
    try {
      const {body: raw, note} = bodyOfFile(await f.text());
      const body = raw.trim();
      const problem = importProblem(body);
      if (problem) { skipped++; bulkLine(f.name, 'skipped: ' + problem); continue; }
      const p = await analyse(body);
      if (run.cancel) { stopped = 'Cancelled'; break; }   // nothing written yet
      const id = texts.length ? Math.max(...texts.map(s => s.id)) + 1 : 1;
      texts.push({id, title: firstLine(body).slice(0, 60) || f.name,
                  source: f.name.replace(/\.[^.]+$/, ''), text: body});
      save('songpath.texts', texts);
      savePage(id, p);
      // the ceiling, discovered here rather than silently: the store is large
      // now, not infinite, and a batch is exactly how it would be found
      await flush();
      const bad = storeTrouble();
      if (bad) {
        texts.pop();                       // never half a text in the library
        save('songpath.texts', texts);
        dropTextCache(id);
        await flush();
        stopped = `Storage stopped accepting writes — ${bad.message}`;
        failed++;
        bulkLine(f.name, 'could not be stored', 'error');
        break;
      }
      added++;
      bulkLine(f.name, note ? `added, ${note}` : 'added');
    } catch (e) {
      // one file failing must not take the rest with it
      failed++;
      bulkLine(f.name, 'failed: ' + e.message, 'error');
    }
  }

  const parts = [`${added} added`];
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  const left = files.length - added - skipped - failed;
  if (left > 0) parts.push(`${left} not reached`);
  $('bulkProgress').textContent =
    (stopped ? stopped + '. ' : '') + parts.join(', ') + '.';
  $('bulkCancel').style.display = 'none';
  $('bulkDone').style.display = '';
  bulkRun = null;
  renderLibrary();
  $('bulk').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  return {added, skipped, failed, stopped};
}

$('bulkCancel').onclick = () => {
  if (!bulkRun) return;
  bulkRun.cancel = true;
  $('bulkProgress').textContent = 'Cancelling — finishing the current file…';
};
$('bulkDone').onclick = () => { $('bulk').style.display = 'none'; };

$('cancelImport').onclick = () => {
  $('newText').value = ''; $('newTitle').value = ''; $('newSource').value = '';
  importNote = ''; titleAuto = true;
  $('status').textContent = '';
  stageImport();
};

$('addText').onclick = () => {
  let body = $('newText').value.trim();
  if (!body) { $('status').textContent = 'Paste some text first.'; return; }
  // a learner who pastes an LRC straight into the box gets the same treatment
  // the file picker gives one
  if (looksLikeLRC(body)) body = plainFromLRC(parseLRC(body));
  if (body.length > MAX_TEXT_CHARS) { stageImport(); return; }
  addTextData($('newTitle').value.trim(), $('newSource').value.trim(), body);
};

// the lyrics search is one source among two, and off in a shipped build —
// see features.js. Nothing else in the codebase knows about it.
if (!FEATURES.lyricsSearch) $('searchBox').style.display = 'none';

// payload schema version, emitted by the server (build_page) — a cached
// songpath.page.* whose v differs is discarded and re-fetched on open.
// Keep in sync with PAGE_V in pathbuilder.py.
const PAGE_V = 16;

// THE SEAM (patch plan 9 Phase 5). One function, four call sites — the paste
// box, the batch import, a cache miss in openText, and ensureCards when the
// shared bucket cannot supply every key — and one payload contract: the whole
// build_page payload, cards inline, or a throw whose .message is shown.
//
// Which side it takes is STAMPED BY THE BUILD (mode.js), never sniffed. The
// source tree is `server` and the authoring loop is untouched; build_dist.py
// writes `device` into dist/, and a device build makes no network call but
// for its own static files.
//
// Nothing downstream changes: splitPage, packCore, compactLines, slimCard,
// packCard, covIndexOf and savePage all operate on what this returns, and the
// device-mode payload is the same payload — tools/parity.js holds it to zero
// diffs on every key of every fixture.
async function analyse(text) {
  // The install runs behind the first-run screen since plan 9.1 Phase 2, so
  // this is one of the two doors that has to wait for it (chars.js has the
  // other). Every caller of analyse() already shows a progress line and
  // catches into an error surface, which is why the wait lives here rather
  // than on the buttons that lead here.
  if (BUILD_MODE === 'device') { await tablesReady; return buildPage(text); }
  const r = await fetch('api/path', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text}),
  });
  const p = await r.json();
  if (!r.ok) throw new Error(p.error || r.statusText);
  return p;
}
