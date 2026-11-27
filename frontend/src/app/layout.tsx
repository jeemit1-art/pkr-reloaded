import type { Metadata, Viewport } from 'next';
import AppExperience from '@/components/AppExperience';
import localFont from 'next/font/local';
import './pkr-theme-a.css';
import './pkr-player-shell.css';
import './pkr-navigation-stability.css';
import './room-experience-themes.css';
import './real-dual-experiences.css';
import './pkr-screen-compositions.css';
import './game-night.css';
import './game-night-secondary.css';
import './game-night-host.css';
import './game-night-player.css';
import './game-night-live.css';
import './game-night-complete.css';
import './game-night-shell.css';
import './chip-club.css';
import './chip-club-coverage.css';
import './pkr-table-readable.css';
import FinancialNotice from '@/components/FinancialNotice';
import PersistentNavigation from '@/components/PersistentNavigation';

// Bundle the app font locally so builds and installed sessions do not need a font service.
const bodyFont = localFont({src:'./fonts/InterVariable.woff2',weight:'100 900',variable:'--font-body',display:'swap'});

export const viewport: Viewport = {
  width:'device-width', initialScale:1, viewportFit:'cover', themeColor:'#FFFFFF', colorScheme:'light',
};
export const metadata: Metadata = {
  applicationName:'PKR', manifest:'/manifest.json',
  appleWebApp:{capable:true,title:'PKR',statusBarStyle:'default'},
  icons:{icon:'/icon-192.png',apple:'/icon-192.png'},
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
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'PKR home poker tracker and tournament manager' }],
    type: 'website',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PKR — Home Poker Game Manager',
    description: 'Track buy-ins, cashouts and settlements in real time. Built for home game hosts.',
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={`pkr-game-night pkr-chip-club ${bodyFont.variable}`}>
      <body>
        <AppExperience>
        <PersistentNavigation/>
        {children}
        <FinancialNotice/>


      </AppExperience>
      </body>
    </html>
  );
}
