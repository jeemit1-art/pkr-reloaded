# PKR shared feature and theme parity rule

Any change to a common PKR feature must work in **all nine selectable styles** (PKR Classic, Noir, Clubhouse, Studio, Luxe Casino, Neon Casino, VIP Lounge, Playful Tournament and Private Casino Club), in **Light, Dark and Follow device** settings. Themes may retain different artwork, colour and layout, but cannot omit access to the same underlying features.

## Release checklist
- Implement data and interactions in shared components/hooks; avoid separately re-implementing logic for each skin.
- Use stable room/player identities and room-scoped sources; do not infer game totals, balances or participant identity from visual labels.
- Confirm each theme supports photos and user-selected emoji, readable fallback avatars and accessible colour contrast.
- Inspect mobile narrow/large, tablet/desktop, WebKit (iOS) and Chromium, including safe-area/navigation constraints, text clipping and touch targets.
- Keep the protected live poker table scoped separately unless a task explicitly changes gameplay.
- Run appearance and functionality regression suites before merging to main. Include all nine styles in a cross-theme browser test when modifying shared presentation.
- Create a rollback milestone before each production-facing change; merge and deploy only the exact revision whose checks passed.
- Do not change payments, member access, RSVP or records merely to paint a theme; test those flows still function.

This requirement is an engineering release criterion, not an instruction to make all themes look visually identical.
