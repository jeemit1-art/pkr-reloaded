// ─────────────────────────────────────────────────────────────────
// STEP 3: Create this as a NEW file at:
// frontend/src/app/sitemap.ts
// (just create a new file there, paste this whole thing in, save)
// ─────────────────────────────────────────────────────────────────

export default function sitemap() {
  return [
    {
      url: 'https://mypkr.app',
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 1,
    },
    {
      url: 'https://mypkr.app/dashboard',
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    },
  ]
}