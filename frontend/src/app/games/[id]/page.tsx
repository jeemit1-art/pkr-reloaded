'use client';
import { useEffect } from 'react';

export default function GamePage() {
  useEffect(() => {
    window.location.replace('/table.html');
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#060e07', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#c9a84c', fontFamily: 'serif', fontSize: 48, opacity: 0.5 }}>♠</div>
    </div>
  );
}
