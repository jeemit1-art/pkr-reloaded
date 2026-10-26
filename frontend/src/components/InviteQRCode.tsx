'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Displays the private PKR invitation link as a camera-readable QR code.
 * Invitation permissions are enforced by the server; scanning never grants
 * membership on its own.
 */
export default function InviteQRCode({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url || !container.current) return;
    let active = true;
    const root = container.current;
    setFailed(false);

    const render = () => {
      if (!active || !(window as any).QRCode) return;
      root.replaceChildren();
      try {
        const QRCode = (window as any).QRCode;
        new QRCode(root, {
          text: url,
          width: 192,
          height: 192,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M,
        });
      } catch {
        setFailed(true);
      }
    };
    const onError = () => { if (active) setFailed(true); };
    if ((window as any).QRCode) {
      render();
      return () => { active = false; };
    }

    const source = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    let script = Array.from(document.querySelectorAll('script')).find(s => s.src === source);
    if (!script) {
      script = document.createElement('script');
      script.src = source;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', render);
    script.addEventListener('error', onError);
    // The existing script might have finished between the initial check and
    // attaching listeners.
    if ((window as any).QRCode) render();

    return () => {
      active = false;
      script?.removeEventListener('load', render);
      script?.removeEventListener('error', onError);
    };
  }, [url]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
      <div style={{ background: '#fff', padding: 13, borderRadius: 10, minWidth: 218, minHeight: 218,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        aria-label="QR code for private PKR invitation">
        <div ref={container} />
      </div>
      {failed && (
        <p role="status" style={{ fontSize: 12, color: 'var(--amber)', textAlign: 'center' }}>
          QR image unavailable. Copy the invitation link instead.
        </p>
      )}
    </div>
  );
}
