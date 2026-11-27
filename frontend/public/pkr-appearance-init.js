/* Apply personal palette and style before React hydration to avoid a theme flash. */
(()=>{try{
 const p=location.pathname;
 if(!/^\/(instant|dashboard|events|games|results|payments|account|insights|schedule|install|invite|phone-invite|mobile-login)(\/|$)/.test(p)||/^\/games\/[^/]+\/(play|tv)(\/|$)/.test(p)||/^\/games\/live(\/|$)/.test(p))return;
 const stored=localStorage.getItem('pkr_personal_appearance_v1');
 const mode=stored==='dark'||(stored==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
 const style=localStorage.getItem('pkr_personal_visual_style_v1');
 document.documentElement.setAttribute('data-pkr-personal-theme',mode);
 document.documentElement.setAttribute('data-pkr-personal-style',style==='noir'||style==='clubhouse'||style==='studio'?style:'standard');
}catch{/* Storage can be blocked; the React provider retains safe defaults. */}})();
