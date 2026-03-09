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

export const metadata = {
  title: 'PKR — Home Poker Game Manager | Track Buy-ins, Leaderboards & Settlements',
  description:
    'PKR is the home poker game management app your group actually needs. Track buy-ins, cashouts and settlements in real time. Live table view, push notifications, leaderboards and WhatsApp share. Free 5-day trial.',
  keywords:
    'home poker app, poker night tracker, poker buy-in tracker, poker settlement app, poker group manager, home game poker software, poker leaderboard app',
  metadataBase: new URL('https://mypkr.app'),
  openGraph: {
    title: 'PKR — Home Poker Game Manager',
    description:
      'Track buy-ins, cashouts and settlements in real time. Built for home game hosts. Free 5-day trial.',
    url: 'https://mypkr.app',
    siteName: 'PKR',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'PKR Home Poker Game Manager' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PKR — Home Poker Game Manager',
    description: 'Track buy-ins, cashouts and settlements in real time. Built for home game hosts.',
    images: ['/og-image.png'],
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
