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
  title: 'PKR — Private Poker Club, Game Night & Settlement App',
  description:
    'PKR helps hosts organise private poker nights: share WhatsApp invites, manage RSVPs, track buy-ins, play tournaments, review results and keep settlement records. Hosting from AUD $9.99/month.',
  keywords:
    'home poker game tracker, poker club app, poker night organiser, poker RSVP tracker, WhatsApp poker invites, poker buy-in tracker, tournament blind timer, poker settlement records, player leaderboard',
  metadataBase: new URL('https://mypkr.app'),
  alternates: {canonical:'/'},
  robots: {index:true,follow:true,googleBot:{index:true,follow:true,'max-image-preview':'large','max-snippet':-1}},
  openGraph: {
    title: 'PKR — Your Private Poker Club, Organised',
    description:
      'Share invites, organise RSVPs, run the live table and review game results and settlements. Built for private poker night hosts.',
    url: 'https://mypkr.app',
    siteName: 'PKR',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'PKR home poker tracker and tournament manager' }],
    type: 'website',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PKR — Private Poker Night Manager',
    description: 'Bring your private poker club together: invitations, RSVPs, buy-ins, results and settlement records in one app.',
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
