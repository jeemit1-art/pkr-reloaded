# Game night milestone: native scope

Date: 26 November 2026

## Decision and verification

The existing Expo/React Native source is retained unchanged in this milestone. The approved porcelain, white, ink and coral visual refresh has **not** been applied to native screens because the project's existing native typecheck cannot run in this worktree without installing dependencies.

Observed checks from `native/`:

- `npm run typecheck` invokes `tsc --noEmit` and exits with code 127: `tsc: not found`.
- There is no `native/node_modules` directory or native TypeScript executable.
- Resolution from `native/package.json` cannot find TypeScript, Expo, `expo/tsconfig.base`, React, React Native, SecureStore, Expo Notifications or React types.
- No native dependency lockfile is tracked.

No packages were installed, native source changed, native build produced or store submission made. The web frontend's installed TypeScript compiler would not establish native type safety without the native framework and module types. The source inventory below describes implemented code, not device-tested release readiness.

## Existing native product and preserved features

The application is a real React Native implementation. It is separate from the Next.js web app. Its UI is currently in [`native/App.tsx`](../native/App.tsx), with `Btn`, `Choice` and `Card` components and three local navigation states: Games, Approvals and Alerts. Its existing API adapter is [`native/src/api.ts`](../native/src/api.ts).

| Area | Existing source behaviour retained |
| --- | --- |
| Approved account access | Enter a 16-character transfer code generated in the authenticated browser. Redeem the code through the existing API and store the JWT in Expo SecureStore. |
| Session handling | Read the saved session, load account/rooms, attempt the existing token refresh on a 401 response, and offer sign-out with confirmation. |
| Rooms | Display approved non-ended rooms, switch rooms, refresh rooms, pull to refresh room data and reload the account on app activation. |
| Next game | Prefer an active game, otherwise show the first scheduled/lobby game. Display its date, location, status and total seats. |
| RSVP | Show arrival choices, Late and Not coming; optionally choose an available seat; save through the existing RSVP endpoint. |
| RSVP ownership | Keep the local edit token in SecureStore. An existing same-name response without that token requires the original browser or help from the host. Preserve this guard against a duplicate response. |
| Attendees | Display the RSVP guest names, arrival responses and selected seats when a scheduled/lobby RSVP board is available. |
| Host approvals | Hosts can review pending requests, approve or decline, and see the returned result. The UI is explicitly restricted to `role === 'host'`; co-hosts do not receive these controls. |
| Personal invitations | Hosts can create a personal invitation with the existing API and open the native share sheet. The app does not automatically send a WhatsApp message. |
| Approved-member link | Open the native share sheet with the existing room dashboard link for already approved members. |
| Settled game summary | List the latest three settled game dates and their Settled status. |
| Room notifications | Retain permission requests, Android channel setup, per-room registration and opt-out, stored preference restoration, test requests and notification-tap room selection. These need configured services and device validation. |
| Interaction safeguards | Preserve existing busy/disabled states, role checks, error/status messages, accessibility roles and selected/disabled accessibility state. |

The source performs room refreshes every 30 seconds while the app is active. It does not contain the web live-table offline transaction queue or conflict-resolution engine.

## Native/web parity gaps

The native app is currently a room and RSVP companion. It is not a replacement for the full web host console.

- No native game creation or editing, live table, seat administration, buy-in/cash-out entry, transaction history, settlement calculation, result finalisation or payment administration.
- No native tournament, hand-tracking, chip-stack, leaderboard, TV or live-sharing screen.
- No detailed results, rankings, personal balances or payment records. The Latest results card contains dates/status only; the `results_token` field is not used by a native result screen.
- No equivalent native member-management, club-settings, insights, account-management or subscription-management screens.
- No five-tab web navigation. Native has Games, host-only Approvals and Alerts; adding tab labels alone would not provide the missing destinations.
- An active game currently displays explanatory text about using the full browser table. There is no direct native Open table button in the source.
- Native RSVP boards are fetched only for scheduled/lobby games. The displayed attendee list is not a live-game roster.
- Existing cross-browser RSVP edit ownership and host-only approval/invitation permissions remain as implemented. A visual refresh must not silently change these paths.

These are existing scope limits, not capabilities removed by the Game night milestone. The complete web workflows remain the intended operational path for host gameplay and financial administration.

## Safe visual follow-up when verification is available

A small presentation-only update can map the existing `StyleSheet` to porcelain `#F4F6F8`, white cards, ink `#14242C` and coral `#F27457`. It should include hard-coded borders, placeholder text, selected controls and feedback colours so the old gold/green styles do not remain mixed through the new palette.

Keep the platform system font. No Inter asset or native font-loading implementation is present. Use readable body/control text, at least 44px touch targets and a more compact welcome/header hierarchy while retaining every current screen and action. Preserve meaningful success, error, pending and disabled states rather than applying one colour indiscriminately.

The visual follow-up should pass the native typecheck and be reviewed on iOS and Android, including large text, long names, keyboard entry, safe areas and narrow screens. Current layout uses a fixed 48px top inset on iOS rather than measured safe-area insets; a colour-only pass does not validate or resolve that behaviour.

## Outstanding native release gates

1. **Dependency compatibility and reproducibility:** validate the declared Expo/React/React Native package combination using the native setup workflow, generate a reviewed lockfile, then pass the existing native typecheck. Declared versions are not evidence of a successful installation or build.
2. **Project and API configuration:** verify the intended HTTPS API origin and EAS project ownership/configuration. Do not copy web preview authentication or fixture endpoints into native builds.
3. **App identity and signing:** confirm ownership/availability of the provisional `app.mypkr.mobile` identifiers and configure the appropriate Apple/Google signing and distribution accounts. Repository identifiers alone do not establish this.
4. **Native build and device checks:** produce signed test builds and exercise transfer-code login, session refresh, room switching, RSVP creation/edit restrictions, seats, invitations, host approvals, share sheets, sign-out and update behaviour on actual iOS and Android devices.
5. **Notifications:** configure the relevant APNs/FCM credentials and EAS project; verify registration, delivery, foreground/background handling, notification taps, sound and opt-out on devices. Confirm the existing backend push gate deliberately before activation. Push-service acceptance is not evidence that a notification appeared or sounded.
6. **Store assets and disclosures:** prepare the required icons, screenshots, descriptions, support/privacy information and permission disclosures. Assess the actual poker/settlement description and any purchase flows against current Apple and Google policies before submission. This milestone has not completed that assessment.
7. **Product scope for release:** decide whether the first store release is the existing companion or requires additional native parity. Keep descriptions and screenshots aligned with the features actually included and verified.

The existing [`native/README.md`](../native/README.md), [`app.json`](../native/app.json), [`eas.json`](../native/eas.json) and [`package.json`](../native/package.json) remain the source references for native setup and declared configuration. Deploying the Next.js frontend does not create or publish an App Store or Play Store binary.
