// features.js — build flags, one place, loaded before everything else.
// Plain consts: there is no config system and no settings UI. A flag is
// flipped by editing this file, and every reader is `if (FEATURES.x)`.
//
// karaoke — patch plan 3 (LRC-synced playback: Play tab, clock adapter,
// bouncing ball, drill loop). Parked by plan 4 Phase 0: showing lyrics in
// time with music is a synchronization use, licensed separately from plain
// display, so the feature cannot ship. Plan 3 was planned but never coded,
// so as of 2026-09-13 this flag gates nothing yet — it is the gate for
// resumption. `PARKED_PLAN_3.md` is the spec, kept out of `archive/`
// because it resumes; do not delete it, and do not remove this flag.
//
// lyricsSearch — the lrclib.net lyrics search on the library screen (plan 1
// Phase 1, still working). Off from plan 4 Phase 3: import is local-only, and
// local-only means no server, no accounts, no rate limits and no takedown
// surface. LRCLIB is also user-uploaded and clears no rights, which is half
// the reason for the pivot. The route stays mounted and the code stays put —
// turn this on for a personal build and the search box comes back.
const FEATURES = {
  karaoke: false,
  lyricsSearch: false,
};
