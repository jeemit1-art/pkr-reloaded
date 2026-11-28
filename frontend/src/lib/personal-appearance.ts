export type AppearancePreference='light'|'dark'|'system';
export type VisualStyle='standard'|'noir'|'clubhouse'|'studio'|'luxe'|'neon'|'vip'|'tournament'|'private-club';
// New users get the approved premium look; a previously selected style always wins.
export const DEFAULT_VISUAL_STYLE:VisualStyle='private-club';
export const APPEARANCE_KEY='pkr_personal_appearance_v1';
export const VISUAL_STYLE_KEY='pkr_personal_visual_style_v1';
export function isAppearance(value:unknown):value is AppearancePreference{
 return value==='light'||value==='dark'||value==='system';
}
export function isVisualStyle(value:unknown):value is VisualStyle{
 return value==='standard'||value==='noir'||value==='clubhouse'||value==='studio'||value==='luxe'||value==='neon'||value==='vip'||value==='tournament'||value==='private-club';
}
export function isAppearanceRoute(pathname:string):boolean{
 return /^\/(instant|dashboard|events|games|results|payments|account|insights|schedule|install|invite|phone-invite|mobile-login)(\/|$)/.test(pathname)
  &&!/^\/games\/[^/]+\/(play|tv)(\/|$)/.test(pathname)&&!/^\/games\/live(\/|$)/.test(pathname);
}
export function resolvedAppearance(value:AppearancePreference,systemDark:boolean):'light'|'dark'{
 return value==='system'?(systemDark?'dark':'light'):value;
}
