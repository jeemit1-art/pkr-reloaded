# WhatsApp OTP without Twilio — RC2 feature branch

**Not yet deployed.** The existing live Cloudflare Worker, database and Vercel frontend remain unchanged.

PKR can send WhatsApp OTPs directly through Meta WhatsApp Cloud API once a registered business sender and an approved AUTHENTICATION template with a COPY_CODE button exist. This is not a free personal-WhatsApp automation. Meta may charge per authentication template message.

PKR generates a cryptographically random six-digit code, sends it to Meta (body and button parameters), stores only an HMAC key in the existing D1 phone_verification_limits table, limits a code to five wrong attempts, expires it in 10 minutes, and deletes it after a successful check. Invite and login scopes are isolated. No additional D1 table is needed.

The optional host-approved, non-phone-verified account claim remains in code behind PKR_HOST_APPROVAL_FALLBACK=1 and is **disabled by default**. Do not turn it on when requiring WhatsApp OTP.

## Production Worker settings

Keep values only in Cloudflare secrets, never in source code, chats or logs:

- PKR_CONTACT_KEY (at least 32 characters; preserve existing key if any encrypted contacts already exist)
- META_WHATSAPP_ACCESS_TOKEN (permanent/long-lived approved system-user token with messaging permission)
- META_WHATSAPP_PHONE_NUMBER_ID (registered WhatsApp Business sender ID, digits, not the sender telephone number)
- META_WHATSAPP_AUTH_TEMPLATE (approved authentication copy-code template name)
- META_WHATSAPP_TEMPLATE_LANGUAGE (optional; defaults to en_US; must match approved template)
- META_WHATSAPP_API_VERSION (optional; defaults to v24.0; verify currently supported API version)

Only after deployment to isolated staging, Worker test/typecheck and frontend build pass, and a real consented number successfully receives a code, set PKR_PHONE_MEMBERS_V1=1 in production. Do not configure any TWILIO_* secrets. Do not rotate PKR_CONTACT_KEY after encrypted contact records exist without a re-encryption plan.

The old RSVPs, live game history, financial data, and AI settings are not touched by this branch. Manual WhatsApp group link sharing remains user-initiated.

API basis: Meta WhatsApp Cloud API authentication template sends require the same OTP in the body parameter and copy-code button parameter; the button component is sub_type "url" at index 0.
