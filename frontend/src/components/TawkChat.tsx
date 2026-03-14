'use client';
import { useEffect } from 'react';

export default function TawkChat() {
  useEffect(() => {
    // Load script only once
    if (!document.getElementById('tawk-script')) {
      const s1 = document.createElement('script');
      s1.id = 'tawk-script';
      s1.async = true;
      s1.src = 'https://embed.tawk.to/69aeb524ddd7fc1c34853586/1jj9776hc';
      s1.charset = 'UTF-8';
      s1.setAttribute('crossorigin', '*');
      document.head.appendChild(s1);
    } else {
      // Script already loaded, just show the widget
      const api = (window as any).Tawk_API;
      if (api?.showWidget) api.showWidget();
    }

    return () => {
      // Hide widget when navigating away from allowed pages
      const api = (window as any).Tawk_API;
      if (api?.hideWidget) api.hideWidget();
    };
  }, []);

  return null;
}
