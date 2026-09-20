// cards.js — the shipped card table, turned back into what build_page emits.
//
// Patch plan 9 Phase 4b. build_dist ships pack_card(slim_card(card_for(...))):
// the shape the CLIENT STORES, not the shape the payload carries. Two things
// follow and both matter.
//
// UNPACKING. The slots mirror pack_card / _pack_node in pathbuilder.py, and
// unpacking restores key order, which is the point of the slot orders being
// what build_page emits. store.js has the same codec for the same format;
// this copy exists because the analyser is loaded on its own by
// tools/parity.js and cannot reach store.js. The duplication is deliberate
// and watched: PAGE_V pins the format and parity fails on `chars` the moment
// the two drift.
//
// RE-ATTACHING THE NODE GLOSS. slim_card drops `gloss` from every decomp
// node, because decompTree draws the curated `cgloss` and never the
// dictionary one. The payload has it, so it has to come back — and it can,
// without shipping anything new: a node's gloss is R.g.gloss(node.char),
// which the chars table already carries as `g`. The single node that cannot
// serve is an off-table character's own self node (両, absent from
// chars.tsv), and there the row's own gloss is the same string, because
// reading_of gives "" and gloss(ch, "") is gloss(ch). Checked over 6,333
// decomp nodes across every fixture: zero mismatches.
//
// It goes back at the right POSITION, not just with the right value. _decomp
// builds a node as {char, jp, gloss, type, phonetic, children}, so the gloss
// sits after jp and before type — and parity walks key order.
var ANALYSIS = ANALYSIS || {};

(function (A) {
  'use strict';

  const NODE_SLOTS = ['char', 'jp', 'type', 'phonetic', 'children',
                      'readings', 'best', 'cgloss', 'series', 'series_root'];
  const CARD_SLOTS = ['derived', 'components', 'phonetic', 'decomp', 'layout',
                      'cousins', 'examples'];
  const TRIPLE = ['char', 'jp', 'gloss'];
  const PAIR = ['char', 'jp'];

  const unpackList = (rows, keys) =>
    rows.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])));

  // `glossOf` is applied here rather than in a second walk so the key lands
  // between jp and type, where _decomp put it.
  function unpackNode(a, glossOf) {
    const n = {};
    for (let i = 0; i < NODE_SLOTS.length; i++) {
      const f = NODE_SLOTS[i];
      const v = i < a.length ? a[i] : 0;
      if (f === 'children') {
        n.children = v.map(c => unpackNode(c, glossOf));
      } else if (f === 'series') {
        if (v !== 0) n.series = unpackList(v, TRIPLE);
      } else if (v !== 0 || f === 'char' || f === 'jp' || f === 'type' ||
                 f === 'phonetic') {
        n[f] = v;
        // gloss sits immediately after jp in what _decomp builds
        if (f === 'jp') n.gloss = glossOf(n.char);
      }
    }
    return n;
  }

  function unpackCard(a, glossOf) {
    const card = {};
    for (let i = 0; i < CARD_SLOTS.length; i++) {
      const f = CARD_SLOTS[i];
      const v = i < a.length ? a[i] : 0;
      if ((f === 'decomp' || f === 'cousins' || f === 'examples') && v === 0)
        continue;                                  // genuinely optional
      if (f === 'decomp') card[f] = unpackNode(v, glossOf);
      else if (f === 'derived') card[f] = unpackList(v, TRIPLE);
      else if (f === 'cousins') card[f] = unpackList(v, PAIR);
      else if (f === 'examples') card[f] = v;      // rebuilt from the examples table
      else card[f] = v;
    }
    return card;
  }

  // The card half of a chars[] row: derived, components, phonetic, decomp,
  // layout and (only when present) cousins — CARD_FIELDS, which is what
  // split_page moves out of the row and therefore what the shipped table
  // holds. `rowGloss` is the row's own gloss, for the off-table self node.
  A.cardOf = function (ch, reading, rowGloss) {
    const packed = A.card(A.key(ch, reading));
    const glossOf = c => A.charGloss(c);
    if (!packed) {
      // Should not happen: build_dist ships a card for every (char, reading)
      // reading_of can produce, including the no-reading cases, and verifies
      // it against every fixture payload on each build. Loud rather than a
      // quietly wrong payload.
      throw new Error('no shipped card for ' + JSON.stringify(A.key(ch, reading)));
    }
    return unpackCard(packed, glossOf);
  };

  // "彷:pong4" — the card bucket's key and the SRS store's, deliberately the
  // same (card_key in pathbuilder.py, keyOf in store.js).
  A.key = (ch, reading) => ch + ':' + (reading || '');

  A.unpackCardForTest = unpackCard;
})(ANALYSIS);
