// Staging build fails closed when configured to contact a production API.
// Production builds remain unchanged unless NEXT_PUBLIC_PKR_ENV=staging.
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
  images: {
    remotePatterns: [{ protocol:'https', hostname:'lh3.googleusercontent.com' }],
  },
};
