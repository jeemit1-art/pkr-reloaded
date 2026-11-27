export type AppearancePreference='light'|'dark'|'system';
export const APPEARANCE_KEY='pkr_personal_appearance_v1';
export function isAppearance(value:unknown):value is AppearancePreference{
 return value==='light'||value==='dark'||value==='system';
}
export function isAppearanceRoute(pathname:string):boolean{
 return /^\/(instant|dashboard|events|games|results|payments|account|insights|schedule|install|invite|phone-invite|mobile-login)(\/|$)/.test(pathname)
  &&!/^\/games\/[^/]+\/(play|tv)(\/|$)/.test(pathname)&&!/^\/games\/live(\/|$)/.test(pathname);
}
export function resolvedAppearance(value:AppearancePreference,systemDark:boolean):'light'|'dark'{
 return value==='system'?(systemDark?'dark':'light'):value;
}
