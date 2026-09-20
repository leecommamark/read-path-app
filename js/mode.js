// mode.js — which build this is. One line of data, stamped by the build.
//
// Patch plan 9 Phase 5. The source tree says `server`; tools/build_dist.py
// overwrites this one file in dist/ to say `device`. That is the whole
// mechanism, and it is deliberately not a feature test:
//
//   * no probe request — a build that asks the network whether it has a
//     server has already made the call a shipped build must never make;
//   * no `typeof` sniffing — a missing global means a load error, not a
//     different product, and the two should not be confused;
//   * no fallback — a device build that quietly fell back to the server on
//     an error would be broken offline in a way nothing would report.
//
// A build knows what it is. Everything that differs between the two reads
// this one const, and there are exactly three places: `analyse` in
// library.js, the character list in chars.js, and the lyrics search, which
// device mode does not have because a shipped build makes no network call
// but for its own static files.
// tools/client_test.js drives both sides in one run by substituting this
// exact line, which is what tools/build_dist.py does too — so the harness
// exercises the build's own mechanism rather than a test-only hook.
const BUILD_MODE = 'device';
