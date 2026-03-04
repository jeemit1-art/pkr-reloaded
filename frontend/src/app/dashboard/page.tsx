'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, User, Event, fmt, saveToken, clearToken } from '@/lib/api';

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser]   = useState<User|null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]   = useState({name:'',description:'',buy_in:'',master_password:''});
  const [saving, setSaving] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(()=>{
    const handler = (e:any) => { e.preventDefault(); setInstallPrompt(e); setShowInstallBanner(true); };
    window.addEventListener('beforeinstallprompt', handler);
    return ()=>window.removeEventListener('beforeinstallprompt', handler);
  },[]);

  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome==='accepted') setShowInstallBanner(false);
  }

  useEffect(()=>{
    const token = searchParams.get('token');
    if (token) { saveToken(token); window.history.replaceState({},'','/dashboard'); }
    Promise.all([api.auth.me(), api.events.list()])
      .then(([u,e])=>{ setUser(u); setEvents(e); })
      .catch(()=>router.push('/'))
      .finally(()=>setLoading(false));
  },[]);

  async function create() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const evt = await api.events.create({
        name: form.name.trim(),
        description: form.description||undefined,
        buy_in: form.buy_in ? Math.round(parseFloat(form.buy_in)*100) : 0,
        master_password: form.master_password||undefined,
      });
      setEvents(e=>[evt,...e]);
      setShowCreate(false);
      setForm({name:'',description:'',buy_in:'',master_password:''});
    } catch(e:any){ alert(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="display" style={{fontSize:48,color:'var(--gold)',opacity:0.6}}>PKR</div>
    </div>
  );

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,
        color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      {/* Install banner */}
      {showInstallBanner && (
        <div style={{background:'var(--bg3)',borderBottom:'1px solid var(--border)',
          padding:'10px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div>
            <span style={{fontSize:13,color:'var(--ivory)',fontWeight:500}}>Install PKR</span>
            <span style={{fontSize:12,color:'var(--muted)',marginLeft:8}}>Add to your home screen</span>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" style={{fontSize:11,padding:'5px 12px'}} onClick={installApp}>Install</button>
            <button className="btn btn-ghost" style={{fontSize:11,padding:'5px 10px'}} onClick={()=>setShowInstallBanner(false)}>✕</button>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="nav">
        <div style={{maxWidth:640,margin:'0 auto',padding:'0 20px',height:56,
          display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div className="display" style={{fontSize:22,color:'var(--white)',letterSpacing:'0.02em'}}>PKR</div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            {user?.avatar_url && (
              <img src={user.avatar_url} alt={user.name}
                style={{width:28,height:28,borderRadius:'50%',border:'1px solid var(--border)'}}/>
            )}
            <span style={{fontSize:12,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>
              {user?.name}
            </span>
            <button className="btn btn-ghost" style={{fontSize:11,padding:'5px 12px'}}
              onClick={()=>{ clearToken(); api.auth.logout().then(()=>router.push('/')) }}>
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <div style={{maxWidth:640,margin:'0 auto',padding:'40px 20px',position:'relative',zIndex:1}}>
        {/* Page header */}
        <div style={{marginBottom:36,display:'flex',alignItems:'flex-end',justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:10,letterSpacing:'0.22em',textTransform:'uppercase',
              color:'var(--muted)',marginBottom:8,fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>
              Your Tables
            </div>
            <h2 className="display" style={{fontSize:42,color:'var(--white)',fontWeight:600,lineHeight:1}}>
              Dashboard
            </h2>
          </div>
          <button className="btn btn-primary" onClick={()=>setShowCreate(true)}>
            + New Table
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="card-gold animate-up" style={{padding:'28px',marginBottom:24}}>
            <div style={{fontSize:16,color:'var(--white)',marginBottom:20,
              fontFamily:'var(--font-display),serif',fontWeight:500}}>
              New Table
            </div>
            <div style={{display:'grid',gap:14}}>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Table Name *</div>
                <input className="inp" placeholder="e.g. Friday Night Poker"
                  value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}
                  autoFocus/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <div className="lbl" style={{marginBottom:6}}>Default Buy-in ($)</div>
                  <input className="inp" type="number" placeholder="20"
                    value={form.buy_in} onChange={e=>setForm(p=>({...p,buy_in:e.target.value}))}/>
                </div>
                <div>
                  <div className="lbl" style={{marginBottom:6}}>Master Password</div>
                  <input className="inp" placeholder="Optional"
                    value={form.master_password} onChange={e=>setForm(p=>({...p,master_password:e.target.value}))}/>
                </div>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Description</div>
                <input className="inp" placeholder="Optional"
                  value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))}/>
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:20}}>
              <button className="btn btn-primary" disabled={!form.name.trim()||saving} onClick={create} style={{flex:1}}>
                {saving ? 'Creating…' : 'Create Table'}
              </button>
              <button className="btn btn-ghost" onClick={()=>setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Events list */}
        {events.length===0 && !showCreate && (
          <div className="empty-state">
            <div className="empty-state-icon">♠</div>
            <div className="empty-state-text">No tables yet.</div>
            <div style={{fontSize:12,color:'var(--faint)',marginTop:6}}>
              Create your first table to get started.
            </div>
          </div>
        )}

        <div style={{display:'grid',gap:8}}>
          {events.map((evt,i)=>(
            <div key={evt.id}
              className="card animate-up"
              style={{animationDelay:`${i*0.04}s`,cursor:'pointer',transition:'border-color 0.15s'}}
              onClick={()=>router.push(`/events/${evt.id}`)}
              onMouseEnter={e=>(e.currentTarget.style.borderColor='var(--border)')}
              onMouseLeave={e=>(e.currentTarget.style.borderColor='var(--border-sub)')}>
              <div style={{padding:'18px 20px',display:'flex',alignItems:'center',gap:16}}>
                <div style={{
                  width:40,height:40,borderRadius:2,
                  background:'var(--bg3)',border:'1px solid var(--border)',
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:18,color:'var(--gold)',flexShrink:0,
                }}>♠</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:16,color:'var(--white)',fontFamily:'var(--font-display),serif',
                    fontWeight:500,marginBottom:3}}>{evt.name}</div>
                  <div style={{fontSize:11,color:'var(--muted)',display:'flex',gap:12,
                    fontFamily:'var(--font-body),sans-serif'}}>
                    {evt.buy_in>0 && <span>{fmt(evt.buy_in)} buy-in</span>}
                    <span>{evt.game_count||0} games</span>
                    <span>{evt.member_count||1} member{evt.member_count!==1?'s':''}</span>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  {evt.role && (
                    <span className={`badge badge-${evt.role}`}>{evt.role}</span>
                  )}
                  <span style={{color:'var(--faint)',fontSize:16}}>›</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return <Suspense><DashboardInner/></Suspense>;
}
