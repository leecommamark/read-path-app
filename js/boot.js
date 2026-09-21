// boot.js — what happens between the page loading and a screen appearing.
//
// Patch plan 9.1 Phase 2. This was four lines inline in index.html, and the
// order of those four lines was the bug: a device build installed the
// character tables BEFORE deciding which screen to draw, so the first-run
// screen — the one thing a new user has to read, and the one moment the app
// has nothing else to show — waited on the slowest operation the app ever
// performs. On a phone that is a few seconds of blank white.
//
// The order is now: hydrate, decide, PAINT, then install behind the paint.
//
// It is a file rather than an inline script for a reason that outlives the
// bug: tools/client_test.js loads static/js/*, so anything inline in
// index.html cannot be driven by a test, and "the intro appears before the
// tables finish" is exactly the kind of claim that needs one.
//
// WHAT NEEDS THE TABLES, AND WHAT DOES NOT. hydrate() fills the store cache;
// rebuildKnown() walks `cards`; seenIntro() reads one hydrated key; the intro
// itself is static markup. None of them touch a table. Device mode reaches
// the tables through exactly two doors — analyse() in library.js and
// openChars() in chars.js — and both of those await `tablesReady` rather than
// this file gating buttons, because gating buttons would miss text.js's two
// call sites and because each door already owns a progress line and a place
// to put an error.

// The install, as a promise anyone downstream can wait on. Resolved from the
// start in a server build, where the tables are the server's problem, so no
// caller has to know which build it is in.
let tablesReady = Promise.resolve();

// The rejection, kept rather than thrown away, so a door reached later can
// say what went wrong instead of hanging. A `.catch` is attached to
// `tablesReady` itself at the point of creation: that marks the rejection
// handled — no unhandled-rejection noise while nothing is awaiting — while
// leaving `tablesReady` rejected, so an `await` on it still throws.
let tablesFailed = null;

function installTables() {
  if (BUILD_MODE !== 'device') return tablesReady;
  // The store's own plumbing is handed in rather than reached for, so the
  // analyser stays ignorant of how the app stores things.
  tablesReady = ANALYSIS.installBrowserTables({get: dbGetMany, put: dbPutMany});
  tablesReady.catch(e => { tablesFailed = e; });
  return tablesReady;
}

async function boot() {
  await hydrate();
  rebuildKnown();

  // Decided as early as it can honestly be decided: the marker is one of
  // hydrate()'s KEEP keys, so it is in the cache by the line above.
  const first = !seenIntro();

  // THE PAINT. Nothing has been fetched at this point on a first run, and
  // nothing needs to have been.
  if (first) showIntro();

  installTables();

  // A returning learner sees no change: the library draws when it drew
  // before, which is after the install. Drawing it earlier would be a
  // separate decision about a screen that is not broken.
  if (first) return;
  try {
    await tablesReady;
  } catch (e) {
    // Before this phase the chain simply stopped here and the app showed a
    // blank page for ever. renderLibrary reads `tablesFailed` and says so.
  }
  renderLibrary();
}
