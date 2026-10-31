import type { Metadata, Viewport } from 'next';
import AppExperience from '@/components/AppExperience';
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';
import './pkr-theme-a.css';
import './pkr-player-shell.css';
import './pkr-navigation-stability.css';
import './room-experience-themes.css';
import './real-dual-experiences.css';
import FinancialNotice from '@/components/FinancialNotice';
import PersistentNavigation from '@/components/PersistentNavigation';

// Theme A — Midnight Felt: exactly the three faces in the user-approved guide.
// Font files are bundled by Next so there are no client-side Google Fonts calls.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['400','600','700'],
  variable: '--font-display',
  display: 'swap',
});
const bodyFont = Inter({
  subsets: ['latin'],
  weight: ['400','500','600','700'],
  variable: '--font-body',
  display: 'swap',
});
const numberFont = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500','700'],
  variable: '--font-num',
  display: 'swap',
});

export const viewport: Viewport = {
  width:'device-width', initialScale:1, viewportFit:'cover', themeColor:'#0B0F12', colorScheme:'dark',
};
export const metadata: Metadata = {
  applicationName:'PKR', manifest:'/manifest.json',
  appleWebApp:{capable:true,title:'PKR',statusBarStyle:'black-translucent'},
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
    <html lang="en-AU" className={`${display.variable} ${bodyFont.variable} ${numberFont.variable}`}>
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
