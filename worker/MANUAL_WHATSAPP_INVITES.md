# PKR — Individual WhatsApp invitations (no API, no Twilio)

**This draft code is not deployed.** Production Cloudflare Worker, D1 (31 tables), Vercel and current RSVP remain unchanged.

## How it works

1. A group host opens **Members → Invite by WhatsApp number**, enters a player's name and number, and chooses Member or Co-host.
2. PKR generates an opaque, random, 256-bit **one-time invitation link** valid for 48 hours. The invite token is stored only as a keyed hash; the contact's phone number is encrypted. No WhatsApp message is sent by PKR.
3. PKR opens the chosen number's individual WhatsApp conversation through a \`https://wa.me/<number>?text=<encoded message>\` link. **The host taps Send manually.** There is no WhatsApp API, business API, Twilio, text-message gateway or automated message.
4. The recipient opens the link, enters the name the host recognises and requests access.
5. PKR shows the request to the group host, who verifies it independently and chooses Approve/Reject. The applicant selects **Check approval and join** on the same device. The request is single-use, with short-lived approval and signed login token.
6. To sign in again after losing their session, the player asks their host to select **Recover access** in Members and send a fresh individual WhatsApp link. Host approval is again required.
7. Game-night RSVP links and updates can also be sent individually through WhatsApp using the existing share buttons.

**Security/terminology:** This is an invite-link and explicit host-approval flow. It is **NOT WhatsApp OTP or verified phone ownership**. A forwarded link alone cannot grant membership without host approval, but a host must also independently recognise the person. Never imply that WhatsApp sends codes automatically.

## Required Cloudflare configuration

The installed production database already has the 10 optional tables (31 total). No further D1 migration is needed.

- \`PKR_CONTACT_KEY\`: a strong, random secret of at least 32 characters, kept only in Cloudflare Worker secrets. **Never print it, paste it into chat, or rotate it after contacts are encrypted** without a key-rotation/migration process.
- \`PKR_PHONE_MEMBERS_V1=1\`: opt-in activation, **only after deployed code, backup and real-device invitation/recovery UAT**.
- Existing \`JWT_SECRET\`, Google login secret and database binding stay unchanged.
- **No** \`TWILIO_*\`, \`META_WHATSAPP_*\`, SMS, or WhatsApp Business credentials are required.

## Release checks

- Worker TypeScript, Vitest, query/schema rehearsal and frontend production build on the exact draft commit
- Test host-only contacts; personal WhatsApp link; a fake member cannot approve themselves; one-time link use; rate limits; rejection; recovery of existing identity; mobile screen and signed-in game access
- Test two real devices and a browser refresh; verify settled games and financial records unchanged
- Enable only one feature flag at a time; AI remains disabled
- Do not overwrite the live D1 with staging data or roll back to an old database snapshot that could erase new games
