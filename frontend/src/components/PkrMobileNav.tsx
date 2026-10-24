'use client';

type IconName = 'home' | 'rooms' | 'scan' | 'plus' | 'games' | 'standings' | 'history' | 'members';

export type PkrNavItem = {
  id: string;
  label: string;
  icon: IconName;
  active?: boolean;
  onSelect: () => void;
};

function PkrNavIcon({ icon }: { icon: IconName }) {
  const common = {
    width: 20, height: 20, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (icon) {
    case 'home':
      return <svg {...common}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-8h6v8"/></svg>;
    case 'rooms':
      return <svg {...common}><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M8 5V3m8 2V3M3 10h18"/><path d="m9 15 2 2 4-4"/></svg>;
    case 'scan':
      return <svg {...common}><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/><path d="M7 12h10"/></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/></svg>;
    case 'games':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9h4m-2-2v4m6 4h.01M18 13h.01"/></svg>;
    case 'standings':
      return <svg {...common}><path d="M8 21V12H4v9m12 0V9h4v12M12 21V4h4v17M3 21h18"/></svg>;
    case 'history':
      return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>;
    case 'members':
      return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v1"/></svg>;
  }
}

export default function PkrMobileNav({ items }: { items: PkrNavItem[] }) {
  return (
    <nav className="pkr-mobile-nav" aria-label="PKR quick navigation">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          aria-current={item.active ? 'page' : undefined}
          onClick={item.onSelect}
        >
          <span className="pkr-nav-icon"><PkrNavIcon icon={item.icon}/></span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
