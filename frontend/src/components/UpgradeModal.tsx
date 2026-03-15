'use client';
// frontend/src/components/UpgradeModal.tsx
// Drop this component into any page that uses gated actions.
// It listens for the global 'pkr:upgrade_required' event fired by api.ts on 402.
// Usage: <UpgradeModal /> anywhere in the component tree.

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface UpgradeDetail {
  error?: string;
  code?: string;
  feature?: string;
  plan?: string;
}

export default function UpgradeModal() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<UpgradeDetail>({});
  const [loading, setLoading] = useState<'starter'|'pro'|null>(null);
  const [hasSubscription, setHasSubscription] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<UpgradeDetail>).detail;
      setDetail(d || {});
      setOpen(true);
    };
    window.addEventListener('pkr:upgrade_required', handler);
    return () => window.removeEventListener('pkr:upgrade_required', handler);
  }, []);

  // Check if user already has a subscription (can go to portal instead)
  useEffect(() => {
    if (open) {
      api.billing.plan().then(p => {
        setHasSubscription(p.has_payment && (p.plan === 'starter' || p.plan === 'pro'));
      }).catch(() => {});
    }
  }, [open]);

  async function checkout(plan: 'starter' | 'pro') {
    setLoading(plan);
    try {
      const { url } = await api.billing.checkout(plan);
      window.location.href = url;
    } catch (e: any) {
      alert(e.message || 'Failed to start checkout. Try again.');
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading('starter'); // repurpose loading state
    try {
      const { url } = await api.billing.portal();
      window.location.href = url;
    } catch (e: any) {
      alert(e.message || 'Could not open billing portal.');
      setLoading(null);
    }
  }

  if (!open) return null;

  const featureLabel: Record<string, string> = {
    create_group: 'create another group',
    create_game: 'schedule new games',
    seat_limit: 'use more than 9 seats',
  };
  const blockedFeature = detail.feature ? featureLabel[detail.feature] || 'use this feature' : 'use this feature';

  const s: Record<string,any> = {
    overlay: {
      position:'fixed', inset:0, background:'rgba(0,0,0,0.88)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24,
      backdropFilter:'blur(4px)',
    },
    modal: {
      background:'#0e0e0f', border:'1px solid rgba(201,168,76,0.25)', borderRadius:8,
      width:'100%', maxWidth:460, position:'relative', overflow:'hidden',
    },
    topBar: {
      background:'linear-gradient(135deg,rgba(201,168,76,0.08),rgba(201,168,76,0.03))',
      borderBottom:'1px solid rgba(201,168,76,0.15)', padding:'24px 24px 20px',
      textAlign:'center' as const,
    },
    closeBtn: {
      position:'absolute', top:16, right:16, background:'none', border:'none',
      color:'rgba(255,255,255,0.35)', fontSize:20, cursor:'pointer', padding:4,
      lineHeight:1,
    },
    body: { padding:'20px 24px 24px' },
    planCard: (active: boolean) => ({
      border: active ? '1.5px solid rgba(201,168,76,0.6)' : '1px solid rgba(255,255,255,0.1)',
      borderRadius:6, padding:'16px 18px', marginBottom:12, cursor:'pointer',
      background: active ? 'rgba(201,168,76,0.04)' : 'rgba(255,255,255,0.02)',
      position:'relative' as const,
    }),
    planName: { fontSize:15, fontWeight:600, color:'#f5f0e8', fontFamily:"'Playfair Display',serif" },
    planPrice: { fontSize:22, fontWeight:700, color:'rgba(201,168,76,0.9)', fontFamily:"'Playfair Display',serif" },
    planPer: { fontSize:11, color:'rgba(255,255,255,0.4)', fontFamily:'DM Sans,sans-serif' },
    planFeature: { fontSize:11, color:'rgba(255,255,255,0.55)', fontFamily:'DM Sans,sans-serif', marginTop:2 },
    badge: {
      position:'absolute', top:12, right:14, fontSize:9, fontWeight:700,
      letterSpacing:'0.12em', textTransform:'uppercase' as const, color:'rgba(201,168,76,0.8)',
      fontFamily:'DM Sans,sans-serif',
    },
    btn: (variant: 'gold'|'ghost') => ({
      width:'100%', padding:'13px 0', borderRadius:4, fontSize:13, fontWeight:600,
      cursor:'pointer', border:'none', fontFamily:'DM Sans,sans-serif',
      background: variant==='gold'
        ? 'linear-gradient(135deg,rgba(201,168,76,0.95),rgba(160,120,40,0.9))'
        : 'transparent',
      color: variant==='gold' ? '#000' : 'rgba(255,255,255,0.45)',
      borderTop: variant==='ghost' ? '1px solid rgba(255,255,255,0.08)' : 'none',
      marginTop: variant==='ghost' ? 8 : 0,
    }),
  };

  return (
    <div style={s.overlay} onClick={() => setOpen(false)}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <button style={s.closeBtn} onClick={() => setOpen(false)}>✕</button>

        {/* Header */}
        <div style={s.topBar}>
          <div style={{fontSize:32, marginBottom:8}}>♠️</div>
          <div style={{
            fontSize:10, letterSpacing:'0.22em', textTransform:'uppercase',
            color:'rgba(201,168,76,0.7)', fontFamily:'DM Sans,sans-serif', marginBottom:8, fontWeight:600,
          }}>Upgrade Required</div>
          <div style={{
            fontSize:18, fontWeight:600, color:'#f5f0e8',
            fontFamily:"'Playfair Display',serif", marginBottom:8,
          }}>
            To {blockedFeature}, choose a plan
          </div>
          <div style={{fontSize:12, color:'rgba(255,255,255,0.4)', fontFamily:'DM Sans,sans-serif', lineHeight:1.6}}>
            {detail.error || 'Start a 5-day free trial — no credit card required.'}
          </div>
        </div>

        <div style={s.body}>
          {hasSubscription ? (
            <>
              <div style={{fontSize:13, color:'rgba(255,255,255,0.5)', textAlign:'center', marginBottom:16, fontFamily:'DM Sans,sans-serif'}}>
                You already have a subscription. Manage or upgrade it in the billing portal.
              </div>
              <button style={s.btn('gold')} onClick={openPortal} disabled={!!loading}>
                {loading ? 'Opening…' : 'Manage Subscription'}
              </button>
            </>
          ) : (
            <>
              {/* Starter Plan */}
              <div style={s.planCard(false)}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                  <div>
                    <div style={s.planName}>Starter</div>
                    <div style={s.planFeature}>1 group · Up to 9 seats · Buy-ins, live view, leaderboard</div>
                  </div>
                  <div style={{textAlign:'right' as const}}>
                    <div style={s.planPrice}>$9.99</div>
                    <div style={s.planPer}>/month AUD</div>
                  </div>
                </div>
                <button
                  style={{...s.btn('ghost'), marginTop:12, padding:'9px 0', fontSize:12,
                    border:'1px solid rgba(201,168,76,0.25)', borderRadius:4, color:'rgba(201,168,76,0.8)'}}
                  onClick={() => checkout('starter')}
                  disabled={!!loading}
                >
                  {loading==='starter' ? 'Redirecting…' : 'Start 5-Day Free Trial →'}
                </button>
              </div>

              {/* Pro Plan */}
              <div style={s.planCard(true)}>
                <div style={s.badge}>Most Popular</div>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                  <div>
                    <div style={s.planName}>Pro</div>
                    <div style={s.planFeature}>Unlimited groups · 15 seats · Tournament mode · Player stats · Rabbit hunt</div>
                  </div>
                  <div style={{textAlign:'right' as const}}>
                    <div style={s.planPrice}>$19.99</div>
                    <div style={s.planPer}>/month AUD</div>
                  </div>
                </div>
                <button
                  style={{...s.btn('gold'), marginTop:12, padding:'9px 0', fontSize:12, borderRadius:4}}
                  onClick={() => checkout('pro')}
                  disabled={!!loading}
                >
                  {loading==='pro' ? 'Redirecting…' : 'Start 5-Day Free Trial →'}
                </button>
              </div>

              <div style={{
                fontSize:11, color:'rgba(255,255,255,0.3)', textAlign:'center',
                fontFamily:'DM Sans,sans-serif', marginTop:8, lineHeight:1.6,
              }}>
                No credit card required for trial · Cancel anytime · AUD pricing
              </div>
            </>
          )}

          <button style={s.btn('ghost')} onClick={() => setOpen(false)}>
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
