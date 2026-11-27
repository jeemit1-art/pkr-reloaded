# Milestones
## milestone-payments-v1
- Git tag: milestone-payments-v1 (branch: backup/milestone-payments-v1)
- Worker version ID: <PASTE>
- D1 bookmark: <PASTE>
- DB export file: pkr-backup-2026-10-24.sql (kept outside repo)
- Vercel: promote the deployment for this commit


## Game night polish — 27 November 2026

Follow-up to the Game night release, addressing reported mobile screenshots.

- The mobile header is a fixed opaque surface, with safe-area padding and a separate content spacer. The installed iOS status bar requests the normal opaque style. The footer continues to cover the home-indicator area.
- Both full dashboard layouts, player hover/focus rows, RSVP empty states, profile editors and record dialogs use the Game night palette and Inter.
- Summary metrics open their saved records or their exact filtered on-page lists. This includes player/approval/game counts, results, RSVP groups, payment totals/statuses, live table bank records and player transactions. Chip stacks show their separate saved chip issuance, stack audit and hand activity. Zero counts have honest empty states; incomplete history stays marked incomplete.
- Interface symbols use a shared SVG set. Existing user avatars and photos are preserved.
- Results finishes its initial scroll reset after saved results load, without overriding deliberate scrolling. Notification invitations wait while the player drawer is open so that financial controls and chip records remain reachable.
- Existing navigation, room layout choices, game controls, financial write gates and account actions are retained. This milestone includes no Worker or database changes.

Recovery checkpoint: `release-checkpoints/pkr-before-polish-20261127` at `6f6f8f6c03dfb81ff8ba8aa078fe31108e81b5c0`.

Validation includes production build/type checking, record/payment/bank unit checks, Chromium and WebKit synthetic browser tests, positive mobile safe-area occlusion checks after scrolling, and screenshots of the retained full dashboards and record sheets. Browser fixtures contain fictional data only. Physical iPhone installed-app behaviour still requires device verification; browser safe-area checks simulate the inset.

## Installed app release delivery and status surface — 27 November 2026

The user reported that the header still failed on their iPhone after PR #85. The previous simulated safe-area checks did not establish the physical device's behaviour.

- Source review confirmed that CSS/JavaScript releases did not change the push worker, so an already-running installed session could miss the existing update notice. A retained old document also retains its old header CSS and status-bar metadata. This is a delivery gap; it is not proof that the user's phone was running the old release.
- Publish a deterministic app release identifier in the running bundle and a non-cached public manifest. Stamp the same identifier into the existing worker so older installed clients can receive their existing voluntary refresh notice. Preserve push handlers, session data and the saved operation journal.
- Provide the running version, an update check, voluntary refresh and anonymous display details in Account. No automatic page reload or telemetry is added, and update controls must respect live-game/pending-action guards.
- Match the mobile page canvas, manifest and native colour-scheme hint to the opaque white header. Keep the existing top-zero header, safe-area padding, page spacer and all page scroll behaviour.
- Extend browser coverage to installed-state and dark-system-preference cases, plus update detection and cancelled refresh. These remain simulations; a fresh installed-iPhone screenshot or display details is needed to confirm the reported physical symptom.

Baseline before this correction: main `a26cc7571e9d9037b667e62fe8843dabe0cd18eb`. WebKit documents that safe-area backgrounds can use the page canvas: [Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).

## Installed app scroll containment — 27 November 2026

A fresh physical iPhone screenshot confirms page content still paints behind the clock on release `db3e8945dc32`, despite the header being fixed at the top of the web viewport and all canvas colours being white. The phone reports a 430 × 873 web viewport within a 430 × 932 screen, with a zero top safe-area inset. The earlier geometry checks did not verify native-area painting.

- Keep the document stationary on installed mobile app pages and scroll their existing content inside a bounded body. Keep the opaque header/footer fixed to the actual viewport; do not invent a status-bar offset from the 59px screen difference.
- Preserve ordinary browser/desktop scrolling and the existing gameplay surfaces. Scope containment to installed mobile pages with the visible primary header.
- Adapt existing page-scroll commands, route/hash navigation and Back restoration to the active scroll container, including Back after refreshing another page. Retain payment search/filter positions and the existing section links' no-scroll behaviour. Keep native-dialog background locking and all current controls.
- Include anonymous scroll-container measurements in the existing display-details copy action. No user records, URLs, identifiers or telemetry are added.
- Acceptance checks cover a stationary root while the body scrolls, viewport clipping, header/footer hit testing, navigation/restoration, anchors, dialogs and reachable page actions. Native iPhone scrolling still needs confirmation after release.

Recovery checkpoint: `release-checkpoints/pkr-before-scroll-containment-20261127` at main `a81ff3a7e54e63ee6ca03000ec31030ba21157c3`. No Worker/backend or database changes are included.

## Swipeable records and launch screenshots — 27 November 2026

The owner confirmed that the installed-iPhone header correction works. Preserve that scroll containment while making read-only data windows dismissible with a downward swipe and refreshing the public homepage with current, genuine app screenshots.

- Add a visible mobile drag handle and deliberate downward-swipe dismissal to record breakdowns, live table records, settlement reviews and saved result previews. Retain Close/Done, Escape, focus restoration, background locks and all nested record actions.
- Keep normal list scrolling and controls usable. A gesture in scrollable records must not dismiss the sheet while the list is away from its top; cancelled, short or horizontal gestures must not dismiss it. Editable forms and payment confirmations must not lose unsaved work through this gesture.
- Capture all major app areas on representative phone, tablet and desktop sizes from the actual source, using fictional clubs, players, games and payments. Publish no private club records or user-provided screenshots.
- Refresh the public homepage and product tour to match the current app, preserving host/member access, subscription choices, factual pricing and existing routes. Keep store availability claims accurate to the current web-app release.
- Verify gesture behaviour, existing header/footer containment, record navigation and homepage layouts before publication. Package the original screenshots and a labelled gallery for the owner.

Recovery checkpoint: `release-checkpoints/pkr-before-swipe-launch-20261127` at main `604d67cd65da89694351a6d581f4834b196d267d`. No Worker/backend or database changes are included.
