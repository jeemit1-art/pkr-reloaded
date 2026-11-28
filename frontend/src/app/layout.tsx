import type { Metadata, Viewport } from 'next';
import AppExperience from '@/components/AppExperience';
import Script from 'next/script';
import './pkr-personal.css';
import localFont from 'next/font/local';
// Structural source styles are compiled into mutually exclusive personal and legacy paint.
import './pkr-lounge.css';
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
import './pkr-visual-qa.css';
import './pkr-premium-styles.css';
import './pkr-experience-consolidation.css';
// Four distinct, user-selectable casino designs; never overrides the protected live gameplay screen.
import './pkr-casino-themes.css';
// New responsive casino compositions; only the four opt-in experiences are affected.
import './pkr-casino-rebuild.css';
// Approved Private Casino Club: real screens, retained workflows and responsive navigation.
import './pkr-privateclub.css';
// Distinct Vegas floor design and sharp, readable iOS typography; scoped to Private Casino Club.
import './pkr-vegas-floor.css';
// Keep compact member cards usable in all saved appearance themes.
import './pkr-member-directory.css';
// Private Casino Club: explicit light and dark variants; keep live table unchanged.
import './pkr-privateclub-light.css';
// Shared real player avatars and readable fallbacks across every saved appearance.
import './pkr-universal-avatars.css';
// One legible rank chip palette for all appearance themes and colour modes.
import './pkr-rank-chips.css';
// One real PKR logo, scaled consistently across all themes and the product shell.
import './pkr-brand-crest.css';
// Shared public marketing and official PKR identity, without altering app themes/gameplay.
import './pkr-brand-system.css';
// Approved canonical PKR Night Is On identity, after all legacy paint.
import './pkr-night-is-on.css';
import './pkr-night-marketing.css';
import FinancialNotice from '@/components/FinancialNotice';
import PersistentNavigation from '@/components/PersistentNavigation';

// Bundle the app font locally so builds and installed sessions do not need a font service.
const bodyFont = localFont({src:'./fonts/InterVariable.woff2',weight:'100 900',variable:'--font-body',display:'swap'});

export const viewport: Viewport = {
  width:'device-width', initialScale:1, viewportFit:'cover', themeColor:'#0B0D14', colorScheme:'dark',
};
export const metadata: Metadata = {
  applicationName:'PKR — Your Private Game Club', manifest:'/manifest.json',
  appleWebApp:{capable:true,title:'PKR',statusBarStyle:'black'},
  icons:{icon:[{url:'/brand/pkr-night-icon.svg',type:'image/svg+xml'},{url:'/icon',type:'image/png',sizes:'512x512'}],apple:'/apple-icon'},
  title: 'PKR — The Night Is On | Your Private Game Club',
  description:
    'The night is on. Bring your private poker crew together with PKR: invitations, RSVPs, game tracking, results and settlement records in one connected club.',
  keywords:
    'home poker game tracker, poker buy-in tracker, home poker tournament manager, poker blind timer, poker settlement calculator, private poker group app, poker leaderboard, home poker game app',
  metadataBase: new URL('https://mypkr.app'),
  alternates: {canonical:'/'},
  robots: {index:true,follow:true,googleBot:{index:true,follow:true,'max-image-preview':'large','max-snippet':-1}},
  openGraph: {
    title: 'PKR — The Night Is On.',
    description:
      'Your table. Your people. Organise private poker nights, players, RSVPs, game records and results in one PKR club.',
    url: 'https://mypkr.app',
    siteName: 'PKR',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'PKR Open Chip K: The Night Is On.' }],
    type: 'website',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PKR — The Night Is On.',
    description: 'Your private game club: players, RSVPs, games, results and settlement records.',
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" suppressHydrationWarning className={`pkr-game-night pkr-chip-club pkr-lounge ${bodyFont.variable}`}>
      <body>
        <Script src="/pkr-appearance-init.js" strategy="beforeInteractive"/>
        <AppExperience>
        <PersistentNavigation/>
        {children}
        <FinancialNotice/>


      </AppExperience>
      </body>
    </html>
  );
}
