// store.js — the client's own state: the storage layer, the text library
// list, the SRS card store (songpath.cards) and the shared undo toast.
// Loaded first: every other file reads these.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------- the storage layer (plan 8 Phase 2) ----------
// The store is IndexedDB, behind a synchronous in-memory cache. `load` and
// `save` keep the signatures they had over localStorage and stay synchronous,
// because one caller cannot wait: dueContext runs inside nextQuestion and says
// so in its own comment. Writes land in `mem` and flush on the next microtask;
// a startup hydrate fills `mem` with the keys every screen needs.
//
// What makes that safe is that a `load` of a key which is not resident returns
// the default, and **every caller already handles it** — it is the cache-miss
// path they were written against. loadCoreLines returns null and openText
// re-analyses; readCharCards returns a partial bucket and ensureCards
// re-analyses or renders without the mnemonic block. A cold read degrades to a
// known path, never to a bug.
//
// Why the move at all: localStorage is 5,120 KB (10,118 KB on some Chromes) and
// one long text owns 781 KB of it, so the library held five. Worse, it failed
// by *eviction* — a sixth text swept every other text's page and lines away,
// returned true, and said nothing — and songpath.cards was reachable, with
// QuotaExceededError escaping mintCard uncaught at about a thousand cards.
// IndexedDB offers 10 GB and holds twenty long texts in 7 MB (plan 8 Phase 0).
//
// It is not, however, durable by fiat: the bucket is best-effort and
// navigator.storage.persist() was refused, so it can still be reclaimed under
// storage pressure. That is a reason to keep Export working, not a reason to
// stay.
const DB_NAME = 'songpath', DB_STORE = 'kv', DB_V = 1;

// `mem` holds the stored *string* for each resident key, never the parsed
// object: parsing happens in load() and the result belongs to the caller, so
// the cache costs what the store costs and not what the payload costs.
const mem = new Map();          // key -> the JSON string, exactly as stored
const dirty = new Set();        // written since the last flush; absent from
                                // `mem` means "delete me"
let dbh = null;                 // IDBDatabase, or null when IndexedDB is unusable
let flushQueued = false;
let flushFailed = null;         // the last flush error, for the UI to surface

const load = (k, d) => (mem.has(k) ? JSON.parse(mem.get(k)) : d);
const save = (k, v) => { mem.set(k, JSON.stringify(v)); dirty.add(k); flushSoon(); };
// remove from the store as well as the cache — as against `release`, below,
// which drops a key from memory and leaves it on disk
const forget = k => { mem.delete(k); dirty.add(k); flushSoon(); };

// One flush drains the whole dirty set in one transaction, which is what makes
// the tiering Phase 1 asked for unnecessary: savePage's cov + cards + core +
// lines coalesce into a single write, and songpath.cards still lands on the
// next microtask. Scheduled with a promise rather than a timer because that is
// what a bare vm context has, and because it means `await` drains it.
function flushSoon() {
  if (flushQueued) return;
  flushQueued = true;
  Promise.resolve().then(() => { flushQueued = false; flush(); });
}

function flush() {
  if (!dirty.size) return Promise.resolve(0);
  const keys = [...dirty];
  dirty.clear();
  if (!dbh) return Promise.resolve(fallbackWrite(keys));
  return new Promise(res => {
    let tx;
    const failed = e => {
      // put them back rather than dropping them: the cache is still right and
      // the next flush gets another go
      for (const k of keys) dirty.add(k);
      flushFailed = (e && e.target && e.target.error) || e || new Error('flush failed');
      // Phase 0's finding was a store that failed silently; this is not going to
      // be the same bug wearing a new API. Surfacing it to the learner is
      // Phase 3's, which owns the failure modes — until then it is at least loud.
      console.warn('songpath: flush failed, ' + keys.length + ' keys still pending',
                   flushFailed);
      res(0);
    };
    try {
      tx = dbh.transaction(DB_STORE, 'readwrite');
      const os = tx.objectStore(DB_STORE);
      for (const k of keys) mem.has(k) ? os.put(mem.get(k), k) : os.delete(k);
      tx.oncomplete = () => res(keys.length);
      tx.onerror = failed;
      tx.onabort = failed;
    } catch (e) { failed(e); }
  });
}

// No IndexedDB — a private window on some engines, or a webview with it turned
// off. The session still works out of `mem`; this writes through to
// localStorage so the two keys that matter survive a reload, and lets the
// derived buckets fail quietly, since they are recomputable and they are what
// would not fit anyway.
function fallbackWrite(keys) {
  let n = 0;
  for (const k of keys) {
    try {
      if (mem.has(k)) localStorage.setItem(k, mem.get(k));
      else localStorage.removeItem(k);
      n++;
    } catch (e) {
      if (KEEP.includes(k)) flushFailed = e;
    }
  }
  return n;
}

// Whether a write has failed to land, and what pending work is still owed.
// `flushFailed` is set by flush() and by the localStorage fallback, and until
// plan 8 Phase 3 nothing read it. Now the batch import checks it after every
// file, because the store's ceiling is high and not infinite and has to fail
// with a count rather than silently — which is the exact shape of the bug
// Phase 0 found in the store this one replaced.
const storeTrouble = () => (flushFailed
  ? {error: flushFailed, message: String((flushFailed && flushFailed.message) || flushFailed),
     pending: dirty.size}
  : null);
const clearStoreTrouble = () => { flushFailed = null; };

function openDB() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) return rej(new Error('no indexedDB'));
    const r = indexedDB.open(DB_NAME, DB_V);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
    r.onblocked = () => rej(new Error('indexedDB blocked'));
  });
}

const dbGet = k => new Promise(res => {
  if (!dbh) return res(undefined);
  try {
    const r = dbh.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(k);
    r.onsuccess = e => res(e.target.result);
    r.onerror = () => res(undefined);
  } catch (e) { res(undefined); }
});

// several keys through one transaction: warming a text is two keys and warming
// a Due deck is as many as the deck has due cards
const dbGetMany = keys => new Promise(res => {
  const out = new Map();
  if (!dbh || !keys.length) return res(out);
  try {
    const tx = dbh.transaction(DB_STORE, 'readonly'), os = tx.objectStore(DB_STORE);
    for (const k of keys) {
      const r = os.get(k);
      r.onsuccess = e => { if (e.target.result !== undefined) out.set(k, e.target.result); };
    }
    tx.oncomplete = () => res(out);
    tx.onerror = () => res(out);
    tx.onabort = () => res(out);
  } catch (e) { res(out); }
});

// every key under a prefix, values included — the coverage indexes, which are
// the one eager bucket there is an unknown number of
const dbPrefix = prefix => new Promise(res => {
  const out = new Map();
  if (!dbh) return res(out);
  try {
    const range = IDBKeyRange.bound(prefix, prefix + '￿', false, false);
    const tx = dbh.transaction(DB_STORE, 'readonly');
    const cur = tx.objectStore(DB_STORE).openCursor(range);
    cur.onsuccess = e => {
      const c = e.target.result;
      if (!c) return;
      out.set(c.key, c.value);
      c.continue();
    };
    tx.oncomplete = () => res(out);
    tx.onerror = () => res(out);
    tx.onabort = () => res(out);
  } catch (e) { res(out); }
});

// Bulk write, straight to the database and deliberately NOT through `mem`.
// Added by plan 9 Phase 5 for one caller: importing the shipped tables, which
// is ~19,000 rows a device build writes once and then reads by key. Putting
// them through save() would fill the in-memory cache with tens of megabytes
// the app never reads as a whole, which is the thing the resident/keyed split
// exists to avoid.
//
// Additive: no existing function changes behaviour, and nothing under
// `songpath.` goes through here. Shipped tables use the `dist.` prefix, so
// Export skips them by construction (see the filter in library.js) — they are
// re-downloadable, and a learner's backup should not carry 26 MB of them.
const dbPutMany = pairs => new Promise((res, rej) => {
  if (!dbh) return rej(new Error('no indexedDB'));
  try {
    const tx = dbh.transaction(DB_STORE, 'readwrite'), os = tx.objectStore(DB_STORE);
    for (const [k, v] of pairs) os.put(v, k);
    tx.oncomplete = () => res(pairs.length);
    tx.onerror = e => rej((e.target && e.target.error) || new Error('put failed'));
    tx.onabort = e => rej((e.target && e.target.error) || new Error('put aborted'));
  } catch (e) { rej(e); }
});

// Everything in the store, keys and values, for Export. The one place the
// whole store is read at once, and deliberately not through `mem`: most of it
// is lazy, and a backup of what happens to be warm is not a backup.
const dbAll = () => dbPrefix('');

// Replace the store wholesale, for Import. The caller reloads afterwards, so
// `mem` is not repaired here — the next hydrate builds it from what landed.
function replaceStore(entries) {
  mem.clear();
  dirty.clear();
  if (!dbh) {
    try {
      const all = [];                              // snapshot: see migrate()
      for (let i = 0; i < localStorage.length; i++) all.push(localStorage.key(i));
      for (const k of all) if (k && k.startsWith('songpath.')) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    } catch (e) { flushFailed = e; }
    return Promise.resolve();
  }
  return new Promise(res => {
    const tx = dbh.transaction(DB_STORE, 'readwrite'), os = tx.objectStore(DB_STORE);
    os.clear();
    for (const [k, v] of Object.entries(entries)) os.put(v, k);
    // an import of a pre-Phase-2 export carries no marker, and must not be
    // migrated over on the next boot
    os.put(JSON.stringify({at: Date.now(), carried: 0, via: 'import'}), MIGRATED);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
    tx.onabort = () => res();
  });
}

// ---------- what hydrates, and what waits ----------
// Eager is what draws the library list and the Due count, and it is small:
// at twenty long texts the coverage indexes are 1.5 MB, the text bodies
// 0.2 MB and three thousand SRS cards 0.5 MB. Lazy is everything that belongs
// to an open text — core above all, which at 524 KB a text is the *largest* of
// the three text-scoped keys and is read by nothing but loadCoreLines.
// songpath.seenIntro joined in plan 9 Phase 7. Eager, because the boot has to
// know before it draws anything whether this is a first run.
const KEEP = ['songpath.texts', 'songpath.cards', 'songpath.readerMode',
              'songpath.seenIntro'];
const MIGRATED = 'songpath.migrated';
const COV_PREFIX = 'songpath.cov.';

// the texts whose core and lines are resident, most recent last. Memory only:
// releasing one never touches the store.
const warmTexts = [];
const WARM_TEXTS = 3;           // the open text, the one before it, and a Due borrow

async function hydrate() {
  try { dbh = await openDB(); } catch (e) { dbh = null; }
  await migrate();
  for (const [k, v] of await dbGetMany(KEEP)) mem.set(k, v);
  for (const [k, v] of await dbPrefix(COV_PREFIX)) mem.set(k, v);
  // the module-scope state every other file reads. It is assigned here rather
  // than at its declaration because the store is no longer readable
  // synchronously at load time; `readerMode` is reader.js's and reachable
  // because classic scripts share one scope, which beats a registry for three
  // variables.
  texts = load('songpath.texts', []);
  cards = load('songpath.cards', {});
  readerMode = load('songpath.readerMode', {mode: 'read', showAll: false});
  // A store that already holds a library belongs to someone who has been using
  // the app, and they must not meet a first-run screen. Defaulting the marker
  // rather than leaving it absent is the migration plan 9 Phase 7 owes:
  // CLAUDE.md retired wiping a songpath.* key, so a phase that adds one writes
  // what it means for a store that predates it.
  if (load('songpath.seenIntro', null) === null)
    save('songpath.seenIntro', texts.length > 0);
  reclaimStale();
  return true;
}

// The one-time move out of localStorage, and the last place localStorage is
// read (plan 8 Phase 2; the rule that would have allowed a wipe instead was
// retired in Phase 1). Only two things are carried, because only two things
// cannot be rebuilt: songpath.texts holds the raw body of every text, so every
// other bucket derives from it, and songpath.cards is the learner's SRS
// progress and derives from nothing. readerMode rides along because it is a
// preference and costs nothing. The derived keys are not carried — they rebuild
// on first open, exactly as they already do after a PAGE_V bump — and once the
// carry has landed they are deleted, which reclaims up to 5 MB of pure waste
// and subsumes the songpath.card.* orphan sweep plan 5 left behind.
//
// songpath.texts and songpath.cards are deliberately left in localStorage as a
// backstop; the marker is what stops a second migration from clobbering them.
async function migrate() {
  if (await dbGet(MIGRATED)) return false;
  let carried = 0;
  for (const k of KEEP) {
    let v = null;
    try { v = localStorage.getItem(k); } catch (e) { /* no localStorage either */ }
    if (v === null) continue;
    mem.set(k, v);
    dirty.add(k);
    carried++;
  }
  save(MIGRATED, {at: Date.now(), carried});
  if (await flush() === 0 && carried) return false;   // it did not land; try again next boot
  const derived = ['songpath.page.', 'songpath.lines.', COV_PREFIX,
                   'songpath.charcard', 'songpath.card.', 'songpath.cardlru'];
  try {
    // the keys are snapshotted before any of them is removed. localStorage.key(i)
    // is an index into a live list and Chrome reorders it on removal, so the
    // walk-and-remove this replaced left four of 176 card keys behind — which
    // the node harness could not see, because a Map's key order is insertion
    // order and the same loop is safe over it.
    const all = [];
    for (let i = 0; i < localStorage.length; i++) all.push(localStorage.key(i));
    for (const k of all) {
      if (!k || KEEP.includes(k)) continue;           // never the two that matter
      if (derived.some(p => k === p || k.startsWith(p))) localStorage.removeItem(k);
    }
  } catch (e) { /* nothing to reclaim */ }
  return true;
}

// A cache from before a PAGE_V bump is never read again — loadCoreLines and
// loadCov both reject it on `v` — so reclaim it. This used to happen inside
// loadCov on the first library render; it happens here instead because a cold
// page is now indistinguishable from an absent one down that path, and the
// coverage indexes are hydrated, so the test is free.
function reclaimStale() {
  for (const k of [...mem.keys()]) {
    if (!k.startsWith(COV_PREFIX)) continue;
    const ix = load(k, null);
    if (ix && ix.v === PAGE_V) continue;
    dropTextCache(k.slice(COV_PREFIX.length));
  }
}

// ---------- warming: the lazy keys, pulled in before a screen needs them ----------
// Every await point in the app is one of these. openText and ensureCards were
// already async; openDue became async for it, because dueContext cannot.
async function warm(keys) {
  const need = keys.filter(k => !mem.has(k));
  if (!need.length) return 0;
  for (const [k, v] of await dbGetMany(need)) mem.set(k, v);
  return need.length;
}

async function warmText(id) {
  await warm(['songpath.page.' + id, 'songpath.lines.' + id]);
  noteWarm(id);
}

const warmCards = keys => warm(keys.map(k => 'songpath.charcard.' + k));

// Drop a text's core and lines from memory, leaving them on disk — the other
// half of warmText. The Due deck needs every candidate text warm at once,
// because dueContext picks between them synchronously, so it warms them all and
// gives them back when the deck closes; without this a twenty-text library
// would hold 14 MB of reader bodies for the rest of the session.
function releaseTexts(ids) {
  for (const id of ids) {
    if (warmTexts.includes(+id)) continue;        // the open text keeps its own
    for (const k of ['songpath.page.' + id, 'songpath.lines.' + id])
      if (!dirty.has(k)) mem.delete(k);
  }
}

// Memory only: the store keeps every text. Dirty keys are left alone, because
// dropping one before it has flushed would lose the write.
function noteWarm(id) {
  const i = warmTexts.indexOf(id);
  if (i >= 0) warmTexts.splice(i, 1);
  warmTexts.push(id);
  while (warmTexts.length > WARM_TEXTS) {
    const old = warmTexts.shift();
    for (const k of ['songpath.page.' + old, 'songpath.lines.' + old])
      if (!dirty.has(k)) mem.delete(k);
  }
}

// ---------- the payload's three buckets ----------
// Mirrors split_page / join_page in pathbuilder.py, key orders included, so a
// rejoined payload serialises to the same string. The server still sends one
// payload — the wire is unchanged in plan 5 Phase 2 — and the client splits it
// on arrival, because the pieces have different lifetimes:
//
//   core   the library list, the meter, the study queue, calibrate, the quiz
//          distractors. Belongs to one text.
//   lines  the reader body, and the line a card quotes. Belongs to one text.
//   cards  the decomposition, the series, the cousins, the example words —
//          computed from the character and its in-context reading and nothing
//          else about the text, so a card is the same object in every text
//          that contains the character and one store serves the whole library.
//
// Never give a card a text-scoped field: it would be wrong for the next text
// that shares the character.
const CARD_FIELDS = ['derived', 'components', 'phonetic', 'decomp', 'layout', 'cousins'];
const PAYLOAD_ORDER = ['v', 'tokens', 'distinct', 'chars', 'families', 'lines',
                       'normalized', 'script', 'prereq'];
const ROW_ORDER = ['char', 'reading', 'gloss', 'rank', 'count', 'readings',
                   'polyphonic', 'derived', 'components', 'phonetic', 'decomp',
                   'layout', 'family', 'type', 'src', 'src_class', 'cousins'];
const READING_ORDER = ['jp', 'in_text', 'attested', 'variant_of', 'examples',
                       'gloss', 'line'];
// The key both the analysis bucket and the SRS store use, because they
// describe the same unit: one (character, reading) pair. A character with no
// reading on file keys as "X:" rather than "X:null".
const keyOf = (ch, jp) => ch + ':' + (jp || '');

function ordered(o, order) {
  const out = {};
  for (const k of order) if (k in o) out[k] = o[k];
  for (const k of Object.keys(o)) if (!order.includes(k)) out[k] = o[k];
  return out;
}

function splitPage(p) {
  const charcards = {}, core = {};
  for (const k of Object.keys(p)) if (k !== 'lines') core[k] = p[k];
  core.chars = p.chars.map(c => {
    const card = {};
    for (const k of CARD_FIELDS) if (k in c) card[k] = c[k];
    const row = {};
    for (const k of Object.keys(c)) if (!CARD_FIELDS.includes(k)) row[k] = c[k];
    if (row.readings) row.readings = row.readings.map(r => {
      const rr = {};
      for (const k of Object.keys(r)) {
        if (k === 'examples') (card.examples || (card.examples = {}))[r.jp] = r[k];
        else rr[k] = r[k];
      }
      return rr;
    });
    charcards[keyOf(c.char, c.reading)] = card;
    return row;
  });
  return {core, lines: {lines: p.lines}, charcards};
}

function joinPage(core, lines, charcards) {
  const p = {};
  for (const k of Object.keys(core)) p[k] = core[k];
  p.chars = core.chars.map(c => {
    const card = {...(charcards[keyOf(c.char, c.reading)] || {})};
    const examples = card.examples || {};
    delete card.examples;
    const row = {...c, ...card};
    if (row.readings) row.readings = row.readings.map(r => ordered(
      r.jp in examples ? {...r, examples: examples[r.jp]} : {...r}, READING_ORDER));
    return ordered(row, ROW_ORDER);
  });
  p.lines = lines.lines;
  return ordered(p, PAYLOAD_ORDER);
}

// merge whatever cards are to hand into a payload's rows, in place. What is
// missing stays missing: every renderer treats the card fields as optional, so
// a partial store costs the mnemonic block and the example words, not the card
// (which is what lets the Due deck run without waiting for anything).
function attachCharCards(p, charcards) {
  for (const c of p.chars) {
    const card = charcards[keyOf(c.char, c.reading)];
    if (!card) continue;
    for (const k of CARD_FIELDS) if (k in card) c[k] = card[k];
    for (const r of c.readings || [])
      if (card.examples && r.jp in card.examples) r.examples = card.examples[r.jp];
  }
}

// Core and the coverage index, packed for store (plan 6 Phase 3), mirroring
// pack_core / unpack_core and pack_cov / unpack_cov in pathbuilder.py slot for
// slot. Core is 76% of what a text owns and readings[] alone spent 119 bytes a
// row on keys and braces; packing takes core to 54% and cov to 52%, and a long
// text from 503 KB of quota to 297 KB.
//
// `v` stays a named key so loadCoreLines and loadCov can check the version
// without unpacking. `variant_of` is present-and-null on every reading row and
// must survive as null; `attested` and `polyphonic` are booleans stored as 1/0.
const CORE_ROW = ['char', 'reading', 'gloss', 'rank', 'count', 'readings',
                  'polyphonic', 'family', 'type', 'src', 'src_class'];
const CORE_READING = ['jp', 'in_text', 'attested', 'variant_of', 'gloss', 'line'];

function packReading(r) {
  const out = [];
  for (const f of CORE_READING) {
    if (f === 'in_text') out.push(r.in_text.map(w => [w.word, w.jp]));
    else if (f === 'attested') out.push(r[f] ? 1 : 0);
    else if (f === 'line') out.push('line' in r ? [r.line.i, r.line.pos] : 0);
    else out.push(r[f]);
  }
  while (out.length && out[out.length - 1] === 0) out.pop();
  return out;
}

function unpackReading(a) {
  const r = {};
  CORE_READING.forEach((f, i) => {
    const v = i < a.length ? a[i] : 0;
    if (f === 'in_text') r[f] = v.map(w => ({word: w[0], jp: w[1]}));
    else if (f === 'attested') r[f] = !!v;
    else if (f === 'line') { if (v !== 0) r[f] = {i: v[0], pos: v[1]}; }
    else r[f] = v;
  });
  return r;
}

function packCore(core) {
  const row = c => {
    const out = [];
    for (const f of CORE_ROW) {
      if (f === 'readings') out.push(c.readings.map(r => packReading(r)));
      else if (f === 'polyphonic') out.push(c[f] ? 1 : 0);
      else out.push(f in c ? c[f] : 0);
    }
    while (out.length && out[out.length - 1] === 0) out.pop();
    return out;
  };
  const out = {};
  for (const k of Object.keys(core))
    if (k !== 'chars' && k !== 'families' && k !== 'prereq') out[k] = core[k];
  out.c = core.chars.map(row);
  out.f = Object.entries(core.families).map(([k, v]) => [k, v.reading, v.gloss]);
  out.p = core.prereq.map(e => [e.char, e.jp, e.gloss, e.rank, e.why, e.for_]);
  return out;
}

function unpackCore(a) {
  const row = x => {
    const c = {};
    CORE_ROW.forEach((f, i) => {
      const v = i < x.length ? x[i] : 0;
      if (f === 'readings') c[f] = v.map(r => unpackReading(r));
      else if (f === 'polyphonic') c[f] = !!v;
      else if (f === 'src' || f === 'src_class') { if (v !== 0) c[f] = v; }
      else c[f] = v;
    });
    return c;
  };
  const out = {};
  for (const k of Object.keys(a)) if (k !== 'c' && k !== 'f' && k !== 'p') out[k] = a[k];
  out.chars = a.c.map(row);
  out.families = Object.fromEntries(a.f.map(([k, r, g]) => [k, {reading: r, gloss: g}]));
  out.prereq = a.p.map(e => ({char: e[0], jp: e[1], gloss: e[2], rank: e[3],
                              why: e[4], for_: e[5]}));
  return ordered(out, PAYLOAD_ORDER);
}

function packCov(cv) {
  return {v: cv.v, script: cv.script,
          c: cv.chars.map(c => [c.char, c.count, c.reading,
                                c.rs.map(r => [r.jp, 'v' in r ? r.v : 0,
                                               't' in r ? r.t : 0])])};
}

function unpackCov(a) {
  return {v: a.v, script: a.script, chars: a.c.map(c => ({
    char: c[0], count: c[1], reading: c[2],
    rs: c[3].map(r => {
      const o = {jp: r[0]};
      if (r[1] !== 0) o.v = r[1];
      if (r[2] !== 0) o.t = r[2];
      return o;
    }),
  }))};
}

// ---------- the reader body, packed for store ----------
// Mirrors compact_lines / expand_lines in pathbuilder.py. lines[] is a quarter
// of the payload and most of that is JSON punctuation: 4,437 word tokens over
// 318 distinct words in a 5,000-character text, each spelled out in full. A
// word table plus index rows takes it from 358,409 bytes to 30,539.
//
// This is a storage shape only. The server still sends the verbose lines and
// the payload in memory keeps them, which is what leaves the reader's
// sectioning, the quiz's context word and the card's quoted line untouched —
// and with them readings[].line's `pos`, which counts characters across every
// part and is computed against the verbose shape.
//
// A row is 0 for a blank line, otherwise a list whose entries are a 1-based
// index into the table for a word and a plain string for punctuation or latin.
function compactLines(lines) {
  const table = [], index = new Map(), rows = [];
  for (const l of lines) {
    if (l.blank) { rows.push(0); continue; }
    const row = [];
    for (const part of l.parts) {
      if (part.type === 'text') { row.push(part.text); continue; }
      const jp = part.chars.map(c => c.jp).join(' ');
      const src = part.chars.map(c => ('src' in c ? c.src : c.char)).join('');
      const key = [part.word, jp, part.gloss, src].join('\u0000');
      let at = index.get(key);
      if (!at) {
        const entry = [part.word, jp, part.gloss];
        if (src !== part.word) entry.push(src);
        at = table.push(entry);          // push returns the new length: 1-based
        index.set(key, at);
      }
      row.push(at);
    }
    rows.push(row);
  }
  return {w: table, l: rows};
}

function expandLines(c) {
  return c.l.map(row => {
    if (row === 0) return {blank: true};
    return {parts: row.map(e => {
      if (typeof e === 'string') return {type: 'text', text: e};
      const [word, jp, gloss, src] = c.w[e - 1];
      const jps = jp.split(' ');
      // by code point, not by UTF-16 unit. `word` is iterated with [...word],
      // which yields code points, so `from` has to be split the same way — an
      // astral character (𠝹, 𡆧) is two units, and indexing `from` directly
      // handed back a lone surrogate that never equals the character. Every
      // character of a word containing one then got a spurious `src`, which is
      // what the reader's "as written" toggle and the learn card's 簡 line
      // draw. Latent since plan 6; no fixture carried an astral character
      // until edge_extb.txt (plan 9 Phase 2). expand_lines in pathbuilder.py
      // never had it — Python indexes by code point natively.
      const from = [...(src === undefined ? word : src)];
      return {type: 'word', word, gloss, chars: [...word].map((ch, k) => {
        const cd = {char: ch, jp: k < jps.length ? jps[k] : ''};
        if (k < from.length && from[k] !== ch) cd.src = from[k];
        return cd;
      })};
    })};
  });
}

// The stored card is not a copy of the payload's card (plan 6 Phase 1). Two
// fields are never drawn: a decomp node's `gloss`, the dictionary gloss that
// sits beside the curated `cgloss` that decompTree actually renders; and an
// example word's `gloss`, where every path that renders one — dictExamples,
// readingSection's 變調 branch, and exampleWord, whose word object
// renderQWord ignores it on — takes `word` and `jp`. Together 22% of the
// bucket. Both earn their place while build_page runs (the example gloss is
// what derives readings[].gloss, which lives in core), so they are dropped
// here, on the way into the store, and nowhere else: splitPage stays a pure
// partition and joinPage its exact inverse.
function slimCard(card) {
  const c = JSON.parse(JSON.stringify(card));
  for (const exs of Object.values(c.examples || {}))
    for (const e of exs) delete e.gloss;
  const walk = n => { delete n.gloss; (n.children || []).forEach(walk); };
  if (c.decomp) walk(c.decomp);
  return c;
}

// The packed card (plan 6 Phase 2), mirroring pack_card / unpack_card in
// pathbuilder.py slot for slot. Positional arrays instead of repeated JSON
// keys — the same trick compactLines plays on the reader body, and worth 46%
// of the card bucket against 73% for the slimming alone.
//
// The slot orders are the orders build_page emits, so unpacking restores the
// original key order and the round trip is byte-identical rather than merely
// equal. `cgloss` sits after `readings`/`best` because _decomp attaches the
// phonetic's readings first and the curated role-gloss after.
//
// A node's optional fields are never present-but-empty, so 0 means absent and
// trailing 0s are trimmed. A card's top-level fields *are* — `derived` is []
// on 377 of 815 cards, `phonetic` is "" on 286 — so those slots are always
// emitted and only decomp, cousins and examples take the placeholder. Compare
// with === : in JS '' == 0 is true, and an empty jp would vanish.
const NODE_SLOTS = ['char', 'jp', 'type', 'phonetic', 'children',
                    'readings', 'best', 'cgloss', 'series', 'series_root'];
const CARD_SLOTS = ['derived', 'components', 'phonetic', 'decomp', 'layout',
                    'cousins', 'examples'];
const TRIPLE = ['char', 'jp', 'gloss'], PAIR = ['char', 'jp'];
const packList = (rows, keys) => rows.map(r => keys.map(k => r[k]));
const unpackList = (rows, keys) =>
  rows.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])));

function packNode(n) {
  const out = [];
  for (const f of NODE_SLOTS) {
    if (f === 'children') out.push(n.children.map(c => packNode(c)));
    else if (f === 'series') out.push('series' in n ? packList(n.series, TRIPLE) : 0);
    else out.push(f in n ? n[f] : 0);
  }
  while (out.length && out[out.length - 1] === 0) out.pop();
  return out;
}

function unpackNode(a) {
  const n = {};
  NODE_SLOTS.forEach((f, i) => {
    const v = i < a.length ? a[i] : 0;
    if (f === 'children') n.children = v.map(c => unpackNode(c));
    else if (f === 'series') { if (v !== 0) n.series = unpackList(v, TRIPLE); }
    else if (v !== 0 || f === 'char' || f === 'jp' || f === 'type' || f === 'phonetic')
      n[f] = v;
  });
  return n;
}

function packCard(card) {
  return CARD_SLOTS.map(f => {
    if (!(f in card)) return 0;
    if (f === 'decomp') return packNode(card[f]);
    if (f === 'derived') return packList(card[f], TRIPLE);
    if (f === 'cousins') return packList(card[f], PAIR);
    if (f === 'examples') return Object.fromEntries(Object.entries(card[f])
      .map(([jp, exs]) => [jp, exs.map(e => [e.word, e.jp])]));
    return card[f];
  });
}

function unpackCard(a) {
  const card = {};
  CARD_SLOTS.forEach((f, i) => {
    const v = i < a.length ? a[i] : 0;
    if (v === 0 && (f === 'decomp' || f === 'cousins' || f === 'examples')) return;
    if (f === 'decomp') card[f] = unpackNode(v);
    else if (f === 'derived') card[f] = unpackList(v, TRIPLE);
    else if (f === 'cousins') card[f] = unpackList(v, PAIR);
    else if (f === 'examples') card[f] = Object.fromEntries(Object.entries(v)
      .map(([jp, exs]) => [jp, exs.map(e => ({word: e[0], jp: e[1]}))]));
    else card[f] = v;
  });
  return card;
}

// ---------- the shared card store ----------
// Unbounded since plan 8 Phase 2, and unbounded is safe because the domain is
// finite. CHARCARD_BUDGET and songpath.charcard-lru existed only to ration
// 5,120 KB of localStorage — the LRU's own bookkeeping ran to 40 KB for a
// single text — and against a 10 GB store the ceiling is the character set
// instead: 7,053 characters in the sheet, so perhaps 9,000 (character,
// reading) pairs ever, about 13 MB in UTF-16 and 5 MB written.
//
// What that buys is residency. A long text has 1,098 cards and the budget held
// 676 of them, so ensureCards — which is all-or-nothing — re-analysed the text
// every time studying began. Every card of every text is now resident, which is
// the thing plans 6 and 7 chased and did not reach.
//
// A card is still computed from the character and its in-context reading alone,
// so one store serves the whole library and 37% of the keys across the fixtures
// are already duplicates. The cards of a text are lazy, like its core: warmed
// by ensureCards before Learn or Review, and by openDue for the deck's own
// keys.
function readCharCards(keys) {
  const out = {};
  for (const k of keys) {
    const v = load('songpath.charcard.' + k, null);
    if (v) out[k] = unpackCard(v);   // the only place a packed card is undone
  }
  return out;
}

function writeCharCards(bucket) {
  // slimmed and packed here rather than by the caller, so nothing fat and
  // nothing unpacked can reach the store by another route
  for (const [k, card] of Object.entries(bucket))
    save('songpath.charcard.' + k, packCard(slimCard(card)));
}

// ---------- the per-text cache ----------
// The eviction cascade is gone (plan 8 Phase 2). It handled a full store by
// sweeping away *every other text's* core and lines — a sixth text cost all
// five before it — then returned true and told nobody, which was the right
// shape for a learner opening one more text and exactly the wrong shape for a
// batch import. Against a 10 GB store there is nothing to trade away.
//
// The writes go to the cache and flush together on the next microtask, so this
// returns whether the write was *accepted*, not whether it landed; a flush that
// fails leaves its keys dirty and sets `flushFailed`, and surfacing that is
// Phase 3's, which owns the failure modes.
function savePage(id, p) {
  const {core, lines, charcards} = splitPage(p);
  save('songpath.cov.' + id, packCov(covIndexOf(p)));
  writeCharCards(charcards);
  save('songpath.page.' + id, packCore(core));
  save('songpath.lines.' + id, compactLines(lines.lines));
  noteWarm(id);                 // a text just written is a text about to be read
  return true;
}

// the three keys a text owns. Never the card store, which is shared, and never
// songpath.cards, which is the learner's progress.
function dropTextCache(id) {
  for (const kind of ['page', 'lines', 'cov']) forget(`songpath.${kind}.${id}`);
  const i = warmTexts.indexOf(+id);
  if (i >= 0) warmTexts.splice(i, 1);
}

// core and lines for a text, joined. No cards: nothing on the text screen but
// the learn and quiz cards needs them, and fetching them is what ensureCards
// does, once, when studying starts.
function loadCoreLines(id) {
  const core = load('songpath.page.' + id, null);
  if (!core || core.v !== PAGE_V) return null;      // `v` survives packing
  const packed = load('songpath.lines.' + id, null);
  if (!packed) return null;
  return joinPage(unpackCore(core), {lines: expandLines(packed)}, {});
}
// The coverage index: what the library list and the Due deck need out of a
// payload, and nothing else — ~26 KB for a 5,000-character text against the
// payload's 1.2 MB. Before plan 5 Phase 1 both screens parsed whole payloads,
// the library list once per text on every render.
//
//   {v, script, chars: [{char, count, reading, rs: [{jp, v?, t?}]}]}
//
// `v` on a reading is its variant_of base (a 變調 reading has no card of its
// own); `t` marks a reading the text actually uses. Both are omitted when
// falsy — across 410 characters the shorthand is worth more than the spelling
// out. The index is derived, never authoritative: it is written beside the
// page so the two cannot drift, and rebuilt from the page when it is absent.
function covIndexOf(p) {
  return {
    v: p.v,
    script: p.script,
    chars: p.chars.map(c => ({
      char: c.char,
      count: c.count,
      reading: c.reading,
      rs: (c.readings || []).map(r => ({
        jp: r.jp,
        ...(r.variant_of ? {v: r.variant_of} : {}),
        ...(r.in_text && r.in_text.length ? {t: 1} : {}),
      })),
    })),
  };
}

// the index for a text, or null when nothing current is cached. A page cached
// before this phase has no index beside it, so one is built and stored on the
// spot — the fallback costs the parse this phase exists to avoid, but only
// once per text.
function loadCov(id) {
  const ix = load('songpath.cov.' + id, null);
  if (ix && ix.v === PAGE_V) return unpackCov(ix);
  // The rebuild path, for a cache written before the index existed, and the
  // one place the packed and unpacked shapes meet: covIndexOf derives from a
  // payload, so the stored core has to be unpacked before it can be handed
  // over. It runs only on a core that is *warm* — since plan 8 Phase 2 a cold
  // core is indistinguishable from an absent one through `load`, and rebuilding
  // is not worth a warm from a function the library list calls once per text.
  if (!mem.has('songpath.page.' + id)) return null;
  const p = load('songpath.page.' + id, null);
  if (!p || p.v !== PAGE_V) {
    // stale, so reclaim it — though the sweep that matters now runs in
    // reclaimStale() at hydrate, where every coverage index is already in hand
    dropTextCache(id);
    return null;
  }
  const built = covIndexOf(unpackCore(p));
  save('songpath.cov.' + id, packCov(built));
  return built;
}

const shuffle = a => a.sort(() => Math.random() - .5);

// filled by hydrate(), not here: the store is no longer readable
// synchronously at load time
let texts = [];   // [{id, title, source, text, asWritten?}]
const curText = () => texts.find(x => x.id === textId);
// 簡 badge for a text whose pasted body was simplified (or mixed);
// null-safe: a stale cached page may lack the script field — it shows no
// badge until the text is opened once and re-analyses itself
const scriptBadge = p => p && p.script && p.script.kind !== 'trad'
  ? `<span class="s-badge" title="source text was simplified — shown in traditional">簡</span>`
  : '';
let cards = {};   // "彷:pong4" -> SRS card, filled by hydrate()
let page = null, info = null, textId = null;     // current text's analysis
let covRows = [], covBy = {};                    // its coverage index, by row and by char
let cardsReady = false;                          // does `page` carry its card bucket yet?
let charlist = null;                              // global learning order (lazy)

// ---------- SRS store ----------
// The graduation unit is a (character, reading) pair, keyed "彷:pong4".
// Fixed review ladder; an SM-2 ease factor is the noted upgrade path
// (DESIGN.md). Right → next rung; wrong → rung 0, due now, lapses+1.
const LADDER = [1, 3, 7, 14, 30, 90, 180];       // days to the next review
const MATURE_RUNG = 4;                           // 30 d — calibrate/placement entry
const DAY = 86400e3;
const cardsOf = ch => Object.keys(cards).filter(k => k.startsWith(ch + ':'));
const newCard = rung => ({rung, due: Date.now() + LADDER[rung] * DAY,
                          last: Date.now(), lapses: 0, added: Date.now()});

// "known" is derived, never stored: a card that exists and is not
// lapsed-pending (a lapse keeps the card but brings the scaffolding back
// until it is answered right again)
let knownKeys = new Set(), knownChars = new Set();
function rebuildKnown() {
  knownKeys = new Set(); knownChars = new Set();
  const now = Date.now();
  for (const [k, c] of Object.entries(cards)) {
    if (c.rung === 0 && c.lapses > 0 && c.due <= now) continue;
    knownKeys.add(k);
    knownChars.add(k.slice(0, k.indexOf(':')));
  }
}
const isKnownKey = (ch, jp) => knownKeys.has(keyOf(ch, jp));
const isKnownChar = ch => knownChars.has(ch);
const saveCards = () => { save('songpath.cards', cards); rebuildKnown(); };

function mintCard(key, rung) {           // create (or re-enter) a card at a rung
  const old = cards[key];
  cards[key] = {...newCard(rung), lapses: old?.lapses || 0, added: old?.added || Date.now()};
  saveCards();
}
function gradeCard(key, right) {         // a real review of an existing card
  const c = cards[key];
  if (right) {
    c.rung = Math.min(c.rung + 1, LADDER.length - 1);
    c.due = Date.now() + LADDER[c.rung] * DAY;
  } else {
    c.rung = 0; c.due = Date.now(); c.lapses++;
  }
  c.last = Date.now();
  saveCards();
}
function lapseCard(key) {                // reader tap-to-unknow / placement miss
  const c = cards[key];
  if (!c) return;
  c.rung = 0; c.due = Date.now(); c.last = Date.now(); c.lapses++;
  saveCards();
}

// ---------- undo toast (shared: reader Mark mode, learn-card "already know") ----------
let undo = null;   // {snapshot, restore, timer}

function showUndo(msg, snapshot, restore) {
  hideToast();
  undo = {snapshot, restore, timer: setTimeout(hideToast, 5000)};
  $('toastMsg').textContent = msg;
  $('toast').style.display = '';
}
function doUndo() {
  if (!undo) return;
  const {snapshot, restore} = undo;
  hideToast();
  restore(snapshot);
}
function hideToast() {
  if (undo) clearTimeout(undo.timer);
  undo = null;
  $('toast').style.display = 'none';
}
$('toastUndo').onclick = () => doUndo();

// restore one card to its snapshot ({key, card} — card: null = didn't exist)
function restoreCard(s) {
  if (s.card) cards[s.key] = s.card; else delete cards[s.key];
  saveCards();
  if (textId) { styleReader(); updateMeter(); }
}
