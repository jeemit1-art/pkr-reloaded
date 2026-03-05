import type { Metadata } from 'next';
import { Playfair_Display, DM_Sans } from 'next/font/google';
import './globals.css';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400','500','600','700'],
  style: ['normal','italic'],
  variable: '--font-display',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300','400','500'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'PKR — Private Poker',
  description: 'Schedule games, track the ledger, settle up.',
  manifest: '/manifest.json',
  themeColor: '#0e0e0f',
  icons: {
    apple: '/apple-touch-icon.png',
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmSans.variable}`}>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{__html:`
          if('serviceWorker' in navigator)
            window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
        `}}/>
      </body>
    </html>
  );
}
