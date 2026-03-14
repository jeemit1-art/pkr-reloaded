'use client';
import { useEffect } from 'react';

export default function TawkChat() {
  useEffect(() => {
    if (document.getElementById('tawk-script')) return;
    const s1 = document.createElement('script');
    s1.id = 'tawk-script';
    s1.async = true;
    s1.src = 'https://embed.tawk.to/69aeb524ddd7fc1c34853586/1jj9776hc';
    s1.charset = 'UTF-8';
    s1.setAttribute('crossorigin', '*');
    document.head.appendChild(s1);
    return () => {
      // Hide widget when component unmounts
      if ((window as any).Tawk_API?.hideWidget) {
        (window as any).Tawk_API.hideWidget();
      }
    };
  }, []);
  return null;
}
