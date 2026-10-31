# PKR Native — iPhone and Android application

This folder contains a **real Expo/React Native application**, not a WebView/PWA wrapper.

The existing production website at https://mypkr.app remains the primary host gameplay
console. **PKR Instant** at https://mypkr.app/instant is the no-install option for players
in a private poker group. The native application provides rooms, game dates, native
RSVP and seat choice, verified host approval, personal WhatsApp invitation sharing,
and native notification registration/test. Full game-play/financial administration
is still on the existing web console, pending native feature parity.

## What works and what does not

- Approved users sign in with a single-use, five-minute transfer code. Generate
  it inside the **original authenticated browser** at https://mypkr.app/install.
  The app stores its JWT in Expo SecureStore, never in a URL or analytics.
- Only authorised members can see private rooms and their RSVP boards. Host
  approval remains required before access is granted.
- Host approval actions and manual WhatsApp invitations call the existing PKR
  Cloudflare Worker. No WhatsApp API fee, automation or address-book import.
- Native notifications use Expo Push Service and the existing Cloudflare Worker.
  Device tokens are registered per user and room with a 90-day expiry. Server
  delivery validates room membership at send time, does not use names/phones
  for sensitive recipients, and drops invalid tokens when Expo reports
  DeviceNotRegistered. Push receipts are checked hourly. Receipt acceptance
  does **not** guarantee notification display.
- iOS notification volume, Silent Mode and Focus are controlled by Apple.
  Android high-importance notification channels are subject to device settings.
- Real push is **deliberately disabled by default** using
  PKR_NATIVE_PUSH_ENABLED. Do not turn it on until the native binary,
  APNs/FCM credentials and a controlled delivery test have succeeded.
- These source files cannot be installed by ordinary iPhone users without
  an Apple developer account, signed build and App Store approval.
  Apple's App Review must assess PKR's poker/settlement description and
  any host subscription purchase flow. Do not claim approval is automatic.

## Native project setup (developer action, not App Store release)

Requires Node 22.13+, Expo SDK 58, an Expo account and for iOS build signing
an Apple Developer Program account. A Mac with Xcode is optional if using EAS
cloud builds. Remote push needs an actual signed device build.

1. In \`native/\`, run \`npm install\` and \`npx expo install --check\`.
   Commit the generated \`package-lock.json\` after validating it. Never use
   \`npm --force\` to force incompatible dependencies.
2. Set \`EXPO_PUBLIC_API_URL\` to the **exact deployed production Worker URL**
   shown in Vercel's \`NEXT_PUBLIC_API_URL\`. This URL is public but must be
   verified; do not copy an unverified staging endpoint.
3. Run \`npx eas-cli init\` to create or connect an Expo EAS project, then
   use the assigned EAS project ID for \`EXPO_PUBLIC_EAS_PROJECT_ID\`.
4. Verify and reserve app identifiers before signing. The identifiers
   \`app.mypkr.mobile\` in \`app.json\` are **provisional**; don't assume
   the owner controls them or that they are available.
5. Configure iOS APNs entitlement and credentials and Android FCM V1 in
   Expo EAS, including notification icons, privacy disclosures and store
   requirements. Run a development or internal distribution build:
   \`npx eas-cli build --profile preview --platform ios\` or \`android\`.
6. After testing actual devices, enable \`PKR_NATIVE_PUSH_ENABLED=1\`
   in the production Worker and optionally configure \`EXPO_ACCESS_TOKEN\`
   for enhanced push security; release the Worker separately from iOS store
   publishing. Tokens remain private in Cloudflare KV.
7. Test personal invitation → host approval → PKR Instant, then native
   five-minute login transfer, RSVP, room opt-in, remote push receipt, lock
   screen display, notification tap, settings opt-out and app update.
8. Submit through App Store Connect / Google Play when review requirements are
   satisfied. **Store approval is not yet part of this repository release**.

## No-install player flow

Host sends a *personal* invitation (not a generic link). New player taps
the WhatsApp link, requests access, waits for host approval, then PKR
automatically opens **/instant?room=...** in the same browser. There is
no need to install the native app, a PWA or TestFlight for RSVP and results
access through approved membership. The host can share the room's generic
/instant link later; that generic link cannot grant membership by itself.

## Release isolation

- Do not change historical results, buy-ins, financial records, settlement
  states, membership roles or VAPID keys during this release.
- Worker native routes are additive and fail closed until explicitly activated.
- The native project is separate from the Vercel Next.js frontend. Pushing
  frontend changes deploys only the PWA website, not the App Store app.
- Test the native app on physical iOS and Android devices before enabling
  remote native push.
- Never put JWTs, invitation claims, transfer codes, native push tokens or
  Apple/Google signing secrets into query strings or public repository files.
