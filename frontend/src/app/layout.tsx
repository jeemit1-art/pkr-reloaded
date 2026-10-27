import type { Metadata } from 'next';
import { Playfair_Display, DM_Sans, Outfit, Manrope } from 'next/font/google';
import './globals.css';
import './pkr-app.css';
import './pkr-casino.css';
import './pre-game.css';
import './pkr-reference-polish.css';
import './pkr-approved-banner.css';
import './pkr-secondary-ui.css';
import './pkr-interaction-refresh.css';
import './pkr-standings.css';
import './pkr-landing-premium.css';
import './pkr-marketing-pages.css';
import './pkr-product-gallery.css';
import './pkr-2026-graphite.css';
// Approved Classic Poker Studio layer must be imported after legacy themes.
import './pkr-classic-poker-studio.css';
// Locally bundled genuine poker-chip, card and dice photography (not live gameplay).
import './pkr-casino-photography.css';
import FinancialNotice from '@/components/FinancialNotice';
import PersistentNavigation from '@/components/PersistentNavigation';

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

const outfit = Outfit({subsets:['latin'],variable:'--font-landing-display',display:'swap'});
const manrope = Manrope({subsets:['latin'],variable:'--font-landing-body',display:'swap'});

export const metadata = {
  title: 'PKR — Home Poker Game Tracker, Tournament Manager & Settlement App',
  description:
    'PKR helps you manage private home poker games: track buy-ins and cash-outs, organize players, run tournament blinds, review leaderboards and see who owes whom. From AUD $9.99/month for hosts.',
  keywords:
    'home poker game tracker, poker buy-in tracker, home poker tournament manager, poker blind timer, poker settlement calculator, private poker group app, poker leaderboard, home poker game app',
  metadataBase: new URL('https://mypkr.app'),
  alternates: {canonical:'/'},
  robots: {index:true,follow:true,googleBot:{index:true,follow:true,'max-image-preview':'large','max-snippet':-1}},
  openGraph: {
    title: 'PKR — Home Poker Tracker & Tournament Manager',
    description:
      'Track buy-ins, cashouts and settlements in real time. Built for home game hosts. Free 5-day trial.',
    url: 'https://mypkr.app',
    siteName: 'PKR',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'PKR home poker tracker and tournament manager' }],
    type: 'website',
    locale: 'en_AU',
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
    <html lang="en" className={`${playfair.variable} ${dmSans.variable} ${outfit.variable} ${manrope.variable}`}>
      <body>
        <PersistentNavigation/>
        {children}
        <FinancialNotice/>
        <script dangerouslySetInnerHTML={{__html:`
          if('serviceWorker' in navigator)
            window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
        `}}/>

      </body>
    </html>
  );
}
