import type {ReactNode} from 'react';
export type PkrGlyphName='home'|'games'|'players'|'insights'|'settle'|'schedule'|'members'|'install';
const shapes:Record<PkrGlyphName,ReactNode>={
 home:<><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9"/><path d="M9 21v-7h6v7"/></>,
 games:<><rect x="4" y="4" width="12" height="16" rx="2"/><path d="m8 10 2-2 2 2-2 2-2-2Z"/><path d="m15 8 5 2v11a2 2 0 0 1-2 2H9"/></>,
 players:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><circle cx="18" cy="9" r="2"/><path d="M17 15c3 0 4 2 4 5"/></>,
 insights:<><path d="M4 20V11M10 20V6M16 20V3M22 20v-9"/></>,
 settle:<><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5C14.7 7.4 13.6 7 12 7c-2 0-3 1-3 2.4 0 1.8 2 2.2 3.3 2.6 1.8.5 3.2 1 3.2 2.9 0 1.4-1.2 2.7-3.5 2.7-1.5 0-2.7-.7-3.6-1.7M12 5v14"/></>,
 schedule:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 16 2 2 4-4"/></>,
 members:<><circle cx="8" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2 20v-2a6 6 0 0 1 12 0v2H2Z"/><path d="M15 14c4 0 7 2 7 6h-6"/></>,
 install:<><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 6v10M8 12l4 4 4-4"/></>
};
export default function PkrGlyph({name}:{name:PkrGlyphName}){
 return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
