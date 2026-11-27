/* Keep the personal theme stable during refresh, before React hydrates. */
(()=>{try{
 const p=location.pathname;
 if(!/^\/(instant|dashboard|events|games|results|payments|account|insights|schedule|install|invite|phone-invite|mobile-login)(\/|$)/.test(p)||/^\/games\/[^/]+\/(play|tv)(\/|$)/.test(p)||/^\/games\/live(\/|$)/.test(p))return;
 const stored=localStorage.getItem('pkr_personal_appearance_v1');
 const mode=stored==='dark'||(stored==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
 document.documentElement.setAttribute('data-pkr-personal-theme',mode);
}catch{/* Browser storage can be blocked; the React provider retains defaults. */}})();
