import type {CSSProperties,ReactNode} from 'react';
export type PkrGlyphName='home'|'games'|'cards'|'players'|'users'|'insights'|'settle'|'schedule'|'members'|'install'
 |'account'|'settings'|'bell'|'bell-off'|'grid'|'trophy'|'search'|'spade'|'qr'|'user-add'|'shield-check'
 |'check'|'copy'|'share'|'link'|'phone'|'history'|'clock'|'warning'|'refresh'|'table'|'medal'
 |'volume'|'volume-off'|'chevron-right'|'dice'|'rabbit'|'map-pin'|'lock'|'broadcast'|'close'|'help'
 |'arrow-up-right'|'arrow-down-left'|'heart'|'club'|'diamond';
const cards=<><rect x="4" y="4" width="12" height="16" rx="2"/><path d="m8 10 2-2 2 2-2 2-2-2Z"/><path d="m15 8 5 2v11a2 2 0 0 1-2 2H9"/></>;
const members=<><circle cx="8" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2 20v-2a6 6 0 0 1 12 0v2H2Z"/><path d="M15 14c4 0 7 2 7 6h-6"/></>;
const shapes:Record<PkrGlyphName,ReactNode>={
 home:<><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9"/><path d="M9 21v-7h6v7"/></>,
 games:cards,cards,
 players:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><circle cx="18" cy="9" r="2"/><path d="M17 15c3 0 4 2 4 5"/></>,
 insights:<><path d="M4 20V11M10 20V6M16 20V3M22 20v-9"/></>,
 settle:<><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5C14.7 7.4 13.6 7 12 7c-2 0-3 1-3 2.4 0 1.8 2 2.2 3.3 2.6 1.8.5 3.2 1 3.2 2.9 0 1.4-1.2 2.7-3.5 2.7-1.5 0-2.7-.7-3.6-1.7M12 5v14"/></>,
 schedule:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 16 2 2 4-4"/></>,
 members,users:members,
 install:<><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 6v10M8 12l4 4 4-4"/></>,
 account:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M5.6 18.4a7 7 0 0 1 12.8 0"/></>,
 settings:<><path d="m9 3-.6 2.4-2 .9-2.2-.7-2 3.4 1.7 1.8v2.4L2.2 15l2 3.4 2.2-.7 2 .9L9 21h4l.6-2.4 2-.9 2.2.7 2-3.4-1.7-1.8v-2.4L19.8 9l-2-3.4-2.2.7-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></>,
 bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
 'bell-off':<><path d="m3 3 18 18M6.3 6.3A6 6 0 0 0 6 8c0 7-3 7-3 9h14M9 2.8A6 6 0 0 1 18 8c0 1.7.2 3.2.6 4.5M10 21h4"/></>,
 grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
 trophy:<><path d="M7 3h10v5a5 5 0 0 1-10 0V3ZM7 5H3v2a4 4 0 0 0 4 4M17 5h4v2a4 4 0 0 1-4 4M12 13v5M8 21h8M9 18h6v3"/></>,
 search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
 spade:<path d="M12 3C9 7 3 9.5 3 14a4.5 4.5 0 0 0 8 2.8L9 21h6l-2-4.2A4.5 4.5 0 0 0 21 14c0-4.5-6-7-9-11Z"/>,
 qr:<><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h3v3h3v3h-6v-3M21 13v2M12 3v3M3 12h3M9 12h3v3M12 21v-3"/></>,
 'user-add':<><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M20 7v6M17 10h6"/></>,
 'shield-check':<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
 check:<path d="m5 12 4 4L19 6"/>,
 copy:<><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
 share:<><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></>,
 link:<><path d="m10 13 4-4M8 15l-2 2a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0M16 9l2-2a3.5 3.5 0 0 1 5 5l-5 5a3.5 3.5 0 0 1-5 0" transform="translate(1 -1) scale(.92)"/></>,
 phone:<><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4M11 19h2"/></>,
 history:<><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
 warning:<><path d="M10.3 4a2 2 0 0 1 3.4 0l8 14a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3l8-14ZM12 9v5M12 17h.01"/></>,
 refresh:<><path d="M20 7a9 9 0 0 0-15-2L3 7M3 3v4h4M4 17a9 9 0 0 0 15 2l2-2M17 17h4v4"/></>,
 table:<><ellipse cx="12" cy="9" rx="10" ry="5"/><ellipse cx="12" cy="9" rx="6" ry="2.5"/><path d="M6 13v7M18 13v7M6 17h12"/></>,
 medal:<><path d="m7 3 5 7 5-7M4 3h5M15 3h5"/><circle cx="12" cy="16" r="6"/><path d="m12 12 1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4L12 12Z"/></>,
 volume:<><path d="M3 9h4l5-4v14l-5-4H3V9ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/></>,
 'volume-off':<><path d="M3 9h4l5-4v14l-5-4H3V9ZM17 9l5 6M22 9l-5 6"/></>,
 'chevron-right':<path d="m9 5 7 7-7 7"/>,
 dice:<><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="7.5" cy="7.5" r=".9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="7.5" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="7.5" cy="16.5" r=".9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="16.5" r=".9" fill="currentColor" stroke="none"/></>,
 rabbit:<><path d="M14 9c-2-2-3-7-1-7s3 4 3 6c0-3 1-7 3-6s0 6-1 7c3 1 4 5 1 7l-3 1M14 11a7 7 0 0 0-11 6c0 2 2 4 5 4h9v-2h-5M4 14a2 2 0 1 0-1 4M16 12h.01"/><path d="M8 21a4 4 0 0 1 0-8"/></>,
 'map-pin':<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
 lock:<><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v3"/></>,
 broadcast:<><circle cx="12" cy="12" r="2"/><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></>,
 close:<path d="m6 6 12 12M18 6 6 18"/>,
 help:<><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3M12 17h.01"/></>,
 'arrow-up-right':<path d="M5 19 19 5M5 5h14v14"/>,
 'arrow-down-left':<path d="M19 5 5 19M5 5v14h14"/>,
 heart:<path d="M20.8 5.2a5.5 5.5 0 0 0-7.8 0L12 6.3l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-9a5.5 5.5 0 0 0 0-7.8Z"/>,
 club:<path d="M8.8 10.4a4.5 4.5 0 1 1 6.4 0 4.5 4.5 0 1 1-1.7 7L15 22H9l1.5-4.6a4.5 4.5 0 1 1-1.7-7Z"/>,
 diamond:<path d="m12 2 9 10-9 10L3 12 12 2Z"/>
};
export default function PkrGlyph({name,size=20,className='',style}:{name:PkrGlyphName;size?:number;className?:string;style?:CSSProperties}){
 return <svg className={'pkr-glyph'+(className?' '+className:'')} data-pkr-icon={name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{display:'inline-block',verticalAlign:'middle',flexShrink:0,...style}}>{shapes[name]}</svg>;
}
