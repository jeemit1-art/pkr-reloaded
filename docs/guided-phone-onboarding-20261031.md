# PKR Guided Phone Setup: release checks

## Goal
Keep all player features usable from a browser, then guide approved members
through optional Home Screen installation and push notifications. The setup
reminder is persistent, non-blocking and minimisable.

## Required behaviour
- Approved mobile users see a phone setup banner on Instant and the normal
  Home, Games, Results, Payments and Account pages when not installed.
- Later minimises it for the browser session but leaves a small visible
  Finish Setup action; setup never blocks use of the game.
- Never show the banner on public pages, full-screen poker tables or
  unsupported desktop sessions.
- Browser installation status comes from standalone display mode, not
  whether an installation prompt was accepted.
- iOS: WhatsApp browser to Safari to Home Screen instructions; installation
  must be completed by the person. From the installed app, permission
  and per-room registration are requested by a user gesture.
- Android: Chrome install prompt when available, manual menu instructions
  otherwise. In-app browsers can copy the proper setup link to Chrome.
- Original authenticated browser offers a private five-minute account
  transfer code for separate installed-app sessions, not another host approval.
- Actual per-room push registration, not OS permission alone, is the
  condition for considering notifications connected.
- Real server-sent test is shown after registration, and only a separate
  player confirmation records that it actually appeared.
- Explicit per-room opt-out remains respected. No permission nags after
  deliberate opt-out from an already-installed device.
- Full authenticated PKR navigation stays available from Instant, including
  avatar/profile, financial settlements, game history and performance.

## Real device acceptance
1. Host sends personal WhatsApp invitation and approves a player on iOS and Android.
2. Player opens the approved room, RSVPs and uses PKR navigation without installing.
3. Player minimises banner, changes tabs and sees the compact reminder.
4. iPhone WhatsApp -> Safari -> Add to Home Screen -> installed PKR;
   restore approved account with private code if required.
5. Enable iPhone push from a tap, send server-side test, verify phone receipt.
6. Android Chrome manual install and prompt install; push opt-in and actual
   receipt, including vibration settings when supported.
7. Change OS permission to denied and verify the guide explains settings
   without making repeated OS permission requests.
8. Disable one room's push subscription and confirm that opt-out survives
   app updates while another room remains separately configured.
9. Check large-screen, screen-reader, zoom and landscape layouts, especially
   that the reminder never covers the poker table or navigation.
10. Preserve all financial data, membership approval and settlement logic.

## Platform limitations
A browser cannot force an iPhone Home Screen installation, silently grant
notification permission, or override Silent Mode, Focus or device volume.
The WhatsApp embedded browser can have separate authentication storage from
Safari and Home Screen apps; retain the secure code transfer route.
