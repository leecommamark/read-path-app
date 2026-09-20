// provider.js — the browser half of the analyser's table access.
//
// Patch plan 9 Phase 5. tables.js knows how to be handed tables; this knows
// how to get them in a browser, which is a different problem from node's
// because of one measurement: parsed JSON costs 5-6x its file size in heap,
// and holding every table costs 118 MB (Phase 1). So the tables split by how
// they are read, and only the small half is ever resident.
//
//   resident  fetched once, parsed, kept: lexicon, chars, readings, families,
//             charlist, variants, offgloss. ~20 MB of heap, the budget.
//   keyed     words (8,192 hash shards) and cards, imported once into the
//             store and read by key. A text touches ~1,200 words of 210,387
//             and ~1,100 cards of 90,775.
//
// THE KEY PREFIX IS `dist.`, NOT `songpath.`, and that is load-bearing in a
// small way: Export walks the database and keeps what starts with `songpath.`
// (library.js), so shipped tables stay out of a learner's backup by
// construction. They are re-downloadable; their progress is not.
//
// RARE CARDS ARE NOT IMPORTED. 82,000 of the 90,775 cards are for characters
// outside chars.tsv and are wanted only when a text actually contains one,
// so the first run imports the 8,781 ordinary ones (~560 ms measured) and the
// rest are fetched from their bulk files when a warm pass finds a key
// missing. Phase 6 measures what that costs on a phone (p9-20).
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  const BASE = 'tables/';                 // relative: never assume a domain
  const RESIDENT = ['lexicon', 'chars', 'readings', 'families', 'charlist',
                    'variants', 'offgloss'];
  const P = 'dist.';                      // the shipped-table key prefix
  const MARK = P + 'imported';            // set once the import has finished

  const mem = new Map();                  // what this session has warmed
  let manifest = null;

  const getJSON = async name => {
    const r = await fetch(BASE + name);
    if (!r.ok) throw new Error('cannot load ' + BASE + name + ': ' + r.status);
    return r.json();
  };

  // Bulk files are listed in the manifest, so nothing here has to guess how
  // many there are — the build decides and says so.
  const bulkNames = prefix => manifest.files
    .map(f => f.path.replace(/^tables\//, ''))
    .filter(n => n.startsWith(prefix + '.') && n.endsWith('.json'))
    .sort();

  async function importKeyed(dbPut) {
    // words: one store row per shard, keyed by shard id
    for (const n of bulkNames('words')) {
      const part = await getJSON(n);
      await dbPut(Object.entries(part).map(([sh, rows]) => [P + 'w.' + sh, rows]));
    }
    // cards: one row per card, so a text reads only what it needs. The rare
    // ones are deliberately left in their files.
    for (const n of bulkNames('cards')) {
      const part = await getJSON(n);
      await dbPut(Object.entries(part).map(([k, v]) => [P + 'c.' + k, v]));
    }
    // examples: the same (char, reading) key space as the cards, and wanted
    // for the same characters, so they are warmed in the same pass. Keyed
    // rather than resident: 2.08 MB of JSON is ~11 MB of heap, and the
    // resident budget is ~20 MB for everything.
    for (const n of bulkNames('examples')) {
      const part = await getJSON(n);
      await dbPut(Object.entries(part).map(([k, v]) => [P + 'e.' + k, v]));
    }
  }

  // A rare card, fetched on demand. Cached in `mem` for the session; not
  // written to the store, because the payload it lands in is what gets
  // stored, by the same savePage every other card goes through.
  async function fetchRare(keys) {
    const want = new Set(keys);
    for (const n of bulkNames('cards_rare')) {
      if (!want.size) break;
      const part = await getJSON(n);
      for (const k of [...want])
        if (k in part) { mem.set(P + 'c.' + k, part[k]); want.delete(k); }
    }
  }

  // `io` is the store's plumbing, handed in by the boot line so this file
  // stays ignorant of how the app stores things: {get(keys) -> Map, put(pairs)}
  A.installBrowserTables = async function (io) {
    manifest = await getJSON('manifest.json');

    const resident = {};
    for (const n of RESIDENT) resident[n] = await getJSON(n + '.json');
    resident.manifest = manifest;

    const done = await io.get([MARK]);
    if (done.get(MARK) !== manifest.build) {
      await importKeyed(io.put);
      await io.put([[MARK, manifest.build]]);
    }

    const warm = async keys => {
      const missing = keys.filter(k => !mem.has(k));
      if (!missing.length) return;
      const got = await io.get(missing);
      for (const k of missing) mem.set(k, got.get(k));
    };

    A.setTables(resident, {
      word: w => {
        const row = mem.get(P + 'w.' + (A.fnv1a(w) % manifest.wordShards));
        return row ? row[w] : undefined;
      },
      card: k => mem.get(P + 'c.' + k),
      examples: k => mem.get(P + 'e.' + k),
      warmWords: async words => {
        const shards = [...new Set(words.map(
          w => P + 'w.' + (A.fnv1a(w) % manifest.wordShards)))];
        await warm(shards);
      },
      warmCards: async keys => {
        await warm([...keys.map(k => P + 'c.' + k),
                    ...keys.map(k => P + 'e.' + k)]);
        const rare = keys.filter(k => mem.get(P + 'c.' + k) === undefined);
        if (rare.length) await fetchRare(rare);
      },
    });
    return manifest.build;
  };
})(ANALYSIS);
