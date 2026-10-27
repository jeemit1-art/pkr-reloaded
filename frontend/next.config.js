// Vercel Preview is an untrusted testing environment until explicitly
// configured. Fail the build rather than silently calling the production API.
if (process.env.VERCEL_ENV === 'preview' && process.env.NEXT_PUBLIC_PKR_ENV !== 'staging') {
  throw new Error('Vercel Preview requires NEXT_PUBLIC_PKR_ENV=staging and a separate staging API');
}
// Production builds are unchanged when VERCEL_ENV=production and PKR_ENV is unset.
if (process.env.NEXT_PUBLIC_PKR_ENV === 'staging') {
  const rawApi = process.env.NEXT_PUBLIC_API_URL;
  if (!rawApi) throw new Error('Staging requires NEXT_PUBLIC_API_URL');
  let endpoint;
  try { endpoint = new URL(rawApi); }
  catch { throw new Error('Invalid staging API URL'); }
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.includes('staging') || endpoint.hostname.includes('mypkr.app')) {
    throw new Error('Staging frontend must use a separate HTTPS staging Worker API');
  }
}

/** @type {import('next').NextConfig} */
module.exports = {
  // Exclude the Next.js development badge from real PKR UI preview screenshots.
  devIndicators: false,
  async headers() {
    const privateRoutes=[
      '/dashboard/:path*','/events/:path*','/games/:path*',
      '/insights/:path*','/schedule/:path*',
      '/invite/:path*','/phone-invite/:path*','/mobile-login/:path*'
    ];
    return privateRoutes.map(source=>({
      source,
      headers:[{key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'}]
    }));
  },
  images: {
    remotePatterns: [{ protocol:'https', hostname:'lh3.googleusercontent.com' }],
  },
};
