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

// ---------- picking up a new build ----------
// How a deploy reaches an open page: the browser re-fetches sw.js on
// registration, sees different bytes, installs the new worker, and that worker
// calls skipWaiting() and claims this client. `controllerchange` is the moment
// it takes over. Nothing listened for it before, so the page that triggered
// the update went on running the OLD code and the new build only appeared on
// the NEXT launch — which is exactly how the plan 9.1 hover fix reached the
// home-screen app a load before it reached Safari.
//
// TWO GUARDS AND A DEFERRAL, each for a specific way this goes wrong.
//
// `hadController` — on a first-ever visit there is no controller, so the
// worker claims the page the moment it activates and `controllerchange` fires
// for a reason that is not an update. Reloading there would pull the first-run
// screen out from under someone in the middle of reading it. Being claimed is
// only an update if something was already in control.
//
// `reloading` — one reload per page, so a worker that claims more than once
// cannot put the app in a reload loop. That loop is the classic way this
// feature bricks an installed app, and it is a bad one because the only way
// out is deleting the app.
//
// THE DEFERRAL. The install precaches 83 files one at a time, so the claim can
// land a minute into a session — in the middle of a placement test, a quiz, or
// a half-typed text. Graded cards are saved as they are graded, but a
// placement run, a quiz run and the paste box are not, and losing a seven-level
// placement test to a background update would be a worse bug than the one this
// fixes. So the reload waits for the library with nothing in flight. If that
// moment never comes, the next launch picks the build up exactly as it did
// before — the behaviour this improves on, not a failure of it.
//
// Each thing that can be in flight on the library screen has its own precise
// signal, rather than one "busy" flag for something to forget to clear: the
// paste box still holds the text through `analyse` (addTextData clears it only
// after), `#bulk` is visible for exactly as long as a batch runs, and
// `#trySample` is disabled for exactly as long as the sample is importing.
let hadController = false;
let updateWaiting = false;
let reloading = false;

// Called from renderLibrary as well as from the claim, because the safe moment
// is usually not the moment the update arrives.
function reloadForNewBuild() {
  if (!updateWaiting || reloading) return false;
  if ($('library').style.display !== '') return false;   // not on the library
  if (($('newText').value || '').trim()) return false;   // a text half-typed
  if ($('bulk').style.display === '') return false;      // a batch import running
  if ($('trySample').disabled) return false;             // the sample importing
  reloading = true;
  location.reload();
  return true;
}

function watchForNewBuild() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // Read before the worker is even registered, which is the only point at
  // which it still answers the question "was this page already controlled?"
  hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    updateWaiting = true;
    reloadForNewBuild();
  });
  // Registered relative, so the worker scopes to wherever the app is served
  // rather than to the origin root — a project page serves from a
  // subdirectory and plan 10 wraps this same folder. Server builds register it
  // too: the dev loop is the only place the shell can be exercised before it
  // ships, and /api/* is exempted inside sw.js.
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js')
    .catch(e => console.warn('service worker did not register', e)));
}

async function boot() {
  watchForNewBuild();
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
