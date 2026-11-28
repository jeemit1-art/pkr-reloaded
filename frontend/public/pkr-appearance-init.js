/* Brand is canonical, not a per-device casino skin. Apply before hydration. */
(()=>{try{
 const p=location.pathname;
 if(!/^\/(instant|dashboard|events|games|results|payments|account|insights|schedule|install|invite|phone-invite|mobile-login)(\/|$)/.test(p)
   ||/^\/games\/[^/]+\/(play|tv)(\/|$)/.test(p)||/^\/games\/live(\/|$)/.test(p))return;
 document.documentElement.setAttribute('data-pkr-personal-theme','dark');
 document.documentElement.setAttribute('data-pkr-personal-style','private-club');
}catch{/* The React provider has the same safe defaults if storage is disabled. */}})();
