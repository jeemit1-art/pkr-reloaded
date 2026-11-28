# PKR shared feature and theme parity rule

Any change to a common PKR feature must work in **all nine selectable styles** (PKR Classic, Noir, Clubhouse, Studio, Luxe Casino, Neon Casino, VIP Lounge, Playful Tournament and Private Casino Club), in **Light, Dark and Follow device** settings. Themes may retain different artwork, colour and layout, but cannot omit access to the same underlying features.

## Release checklist
- Implement data and interactions in shared components/hooks; avoid separately re-implementing logic for each skin.
- Use stable room/player identities and room-scoped sources; do not infer game totals, balances or participant identity from visual labels.
- Confirm each theme supports photos and user-selected emoji, readable fallback avatars and accessible colour contrast.
- Reuse the original PKR crest (\`/brand/pkr-crest.svg\`) in the common navigation and select page features. Keep the mark proportionate, text readable, and artwork clear of buttons on 320px phones, iOS safe areas and both colour modes. Avoid creating separate inconsistent brand logos per theme.
- Use the shared position-based rank chip palette throughout Results and Standings: gold, silver and bronze for the top three, then unique shades for ranks 4-20; verify number contrast in all themes and light/dark modes. Do not use the same three alternating rank chip colours for every player.
- Inspect mobile narrow/large, tablet/desktop, WebKit (iOS) and Chromium, including safe-area/navigation constraints, text clipping and touch targets.
- Keep the protected live poker table scoped separately unless a task explicitly changes gameplay.
- Run appearance and functionality regression suites before merging to main. Include all nine styles in a cross-theme browser test when modifying shared presentation.
- Create a rollback milestone before each production-facing change; merge and deploy only the exact revision whose checks passed.
- Do not change payments, member access, RSVP or records merely to paint a theme; test those flows still function.

This requirement is an engineering release criterion, not an instruction to make all themes look visually identical.
