// tables.js — where the shipped tables come from.
//
// Patch plan 9 Phase 4a. tools/build_dist.py writes them; this decides how
// the analyser gets at them, and it has to serve two callers that could not
// be less alike:
//
//   node       tools/parity.js injects TABLES_DIR and `require`, so the
//              tables are read straight off disk. 26 MB in a test harness is
//              nothing, so everything is loaded eagerly and kept.
//   browser    Phase 5 calls setTables() with what it has: the resident
//              tables parsed from fetch, and lookup functions for the keyed
//              ones, which live in IndexedDB and are read by key. That is the
//              whole point of the resident/keyed split — 118 MB of heap if
//              every table were parsed and held (measured, Phase 1).
//
// So the analyser never touches a file or a database itself. It asks this
// module, and this module asks whatever it was given.
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  // resident tables, by name; each is the parsed JSON build_dist wrote
  let T = null;
  // keyed lookups. Given plain objects in node; in the browser Phase 5
  // replaces them with store-backed getters, which is the whole point of the
  // resident/keyed split.
  let wordsGet = null;
  let cardGet = null;
  let examplesGet = null;
  let warmWordsFn = null;
  let warmCardsFn = null;

  // Phase 5 calls this. `resident` is {lexicon, chars, words?, variants, ...};
  // `lookups` may carry {word} to serve the keyed table without holding it.
  A.setTables = (resident, lookups) => {
    T = resident;
    T.lexiconSet = new Set(resident.lexicon);
    wordsGet = (lookups && lookups.word) || (w => (T.words || {})[w]);
    cardGet = (lookups && lookups.card) || (k2 => (T.cards || {})[k2]);
    examplesGet = (lookups && lookups.examples) || (k2 => (T.examples || {})[k2]);
    warmWordsFn = (lookups && lookups.warmWords) || null;
    warmCardsFn = (lookups && lookups.warmCards) || null;
  };

  // node only: read everything off disk. Kept out of the browser path
  // entirely — there is no `require` there and no reason to want one.
  function loadFromDisk(dir) {
    const fs = require('fs');
    const path = require('path');
    const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bulk = prefix => {
      const out = {};
      for (const f of fs.readdirSync(dir).sort())
        if (f.startsWith(prefix + '.') && f.endsWith('.json'))
          Object.assign(out, read(f));
      return out;
    };
    const resident = {
      lexicon: read('lexicon.json'),
      chars: read('chars.json'),
      variants: read('variants.json'),
      readings: read('readings.json'),
      families: read('families.json'),
      offgloss: read('offgloss.json'),
      examples: bulk('examples'),
      cards: Object.assign(bulk('cards'), bulk('cards_rare')),
    };
    // the word table ships hashed into shards; undo that for the harness
    const shards = bulk('words');
    const words = {};
    for (const k of Object.keys(shards)) Object.assign(words, shards[k]);
    resident.words = words;
    resident.manifest = read('manifest.json');
    A.setTables(resident);
  }

  // Lazy, so load order cannot matter and a browser build never reaches the
  // node branch. Everything below calls this rather than touching T.
  A.tables = () => {
    if (T) return T;
    if (typeof TABLES_DIR === 'string' && typeof require === 'function') {
      loadFromDisk(TABLES_DIR);
      return T;
    }
    throw new Error('ANALYSIS.tables: no tables. In node set TABLES_DIR; ' +
                    'in the browser call ANALYSIS.setTables() first.');
  };

  // The two await points buildPage needs. In node everything is resident, so
  // these do nothing; the browser provider replaces them with store reads.
  A.warmWords = ks => warmWordsFn ? warmWordsFn(ks) : Promise.resolve();
  A.warmCards = ks => warmCardsFn ? warmCardsFn(ks) : Promise.resolve();

  A.lexicon = () => A.tables().lexiconSet;
  A.readingGloss = k2 => A.tables().readings[k2] || ['', ''];
  A.family = k2 => A.tables().families[k2] || null;
  A.examples = k2 => { A.tables(); return examplesGet(k2) || null; };
  A.card = k2 => cardGet(k2);
  A.charRow = ch => A.tables().chars[ch] || null;
  A.variants = () => A.tables().variants;
  A.word = w => { A.tables(); return wordsGet(w) || null; };

  // The build pins a hash sample in the manifest precisely so a divergence
  // between build_dist.fnv1a and util.js's cannot ship silently. Cheap, and
  // it has one job: fail loudly rather than mis-shard astral words.
  A.checkHash = () => {
    const m = A.tables().manifest;
    if (!m || !m.hashCheck) return null;
    const bad = Object.entries(m.hashCheck)
      .filter(([w, h]) => A.fnv1a(w) !== h)
      .map(([w]) => w);
    if (bad.length)
      throw new Error('fnv1a disagrees with the build for: ' + bad.join(' ') +
                      ' — the hash must be over code points, not UTF-16 units');
    return Object.keys(m.hashCheck).length;
  };
})(ANALYSIS);
