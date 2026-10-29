// @refresh
'use client';
import RecordMetric from '@/components/RecordMetric';
import AppDialog from '@/components/AppDialog';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, EventDetail, Game, LeaderboardEntry, fmtDate, fmt, fmtSign, type RoomPlayerProfile, type RoomPlayerProfileInput } from '@/lib/api';
import RoomPlayerProfileEditor from '@/components/RoomPlayerProfileEditor';
import { subscribePush, unsubscribePush, isPushSubscribedToEvent, canUsePush, isPWAInstalled, isIOS, isSafari } from '@/lib/push';
import PkrMobileNav from '@/components/PkrMobileNav';
import RoomDashboardDual from '@/components/RoomDashboardDual';
import PlayerRoomDashboard from '@/components/PlayerRoomDashboard';
import './room-dashboard-polish.css';
import InviteQRCode from '@/components/InviteQRCode';
import ForegroundSoundToggle from '@/components/ForegroundSoundToggle';
import {playPkrSound} from '@/lib/sounds';
import StandingsBoard from '@/components/StandingsBoard';
import {isCurrentGame,isLiveGame,isUnfinishedGame,gameStatusLabel} from '@/lib/game-status';

type Tab = 'games' | 'leaderboard' | 'history' | 'members';
type InviteRole = 'cohost' | 'member';

export default function EventPage() {
  const _p = useParams(); const id = (Array.isArray(_p.id) ? _p.id[0] : _p.id) as string;
  const router  = useRouter();
  const [event, setEvent]     = useState(null as any);
  const [games, setGames]     = useState([] as any[]);
  const [history, setHistory] = useState([] as any[]);
  const [leaders, setLeaders] = useState([] as any[]);
  const [tab, setTab]         = useState<Tab>('games');
  // Global navigation can switch tabs without a full page reload.
  useEffect(()=>{
    const open=(e:globalThis.Event)=>{
      const next=(e as CustomEvent<string>).detail;
      if(next==='games'||next==='leaderboard'||next==='history'||next==='members'){
        setTab(next);
        window.scrollTo({top:0,behavior:'smooth'});
      }
    };
    window.addEventListener('pkr:select-room-tab',open);
    return()=>window.removeEventListener('pkr:select-room-tab',open);
  },[]);
  const [isHost, setIsHost]   = useState(false);
  const [user, setUser]       = useState(null as any);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null as any);
  const [selectedPlayer, setSelectedPlayer] = useState<string|null>(null); // Open Standings player profile
  const [showInvite, setShowInvite] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [showQuickSeat, setShowQuickSeat] = useState(false);
  const [quickSeatGameId, setQuickSeatGameId] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeTo, setMergeTo] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeMsg, setMergeMsg] = useState('');
  const [inviteUrl, setInviteUrl]   = useState('');
  const [inviteRole, setInviteRole] = useState('cohost');
  const [isGroupOwner,setIsGroupOwner]=useState(false);
  const [joinRequests,setJoinRequests]=useState([] as Array<{id:string;name:string;expected_member:string;phone:string;requested_at:number}>);
  const previousRequestCount=useRef<number|null>(null);
  const [joinDecisionNotice,setJoinDecisionNotice]=useState('');
  const memberDeepLinkScroll=useRef(false);
  const [memberSection,setMemberSection]=useState<'invite'|'requests'|'roster'|'notifications'>('invite');
  const [phoneContacts,setPhoneContacts]=useState([] as Array<{id:string;display_name:string;phone:string;status:string}>);
  const [phoneName,setPhoneName]=useState('');
  const [memberQuery,setMemberQuery]=useState('');
  const [roomProfiles,setRoomProfiles]=useState<Record<string,RoomPlayerProfile>>({});
  const [knownRoomPlayers,setKnownRoomPlayers]=useState<Array<{display_name:string;games_played:number}>>([]);
  const [roomProfileError,setRoomProfileError]=useState('');
  const [editingRoomProfile,setEditingRoomProfile]=useState<{key:string;name:string;avatarUrl:string|null}|null>(null);
  const [memberFilter,setMemberFilter]=useState<'all'|'admins'|'players'>('all');
  const [phoneNumber,setPhoneNumber]=useState('');
  const [phoneRole,setPhoneRole]=useState<'member'|'cohost'>('member');
  const [phoneBusy,setPhoneBusy]=useState(false);
  const [phoneError,setPhoneError]=useState('');
  const [phoneShare,setPhoneShare]=useState<{whatsapp_url:string;url:string;name:string}|null>(null);
  const [selectedInviteGameId,setSelectedInviteGameId]=useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [form, setForm] = useState({scheduled_at:'',location:'',notes:'',seats:'9',game_password:'',repeat:'none',format:'cash',small_blind:'',big_blind:'',starting_chips:''});
  const [arrivalTimes,setArrivalTimes]=useState<string[]>(['19:00','20:00','21:00']);
  const [saving, setSaving] = useState(false);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState(null as any);
  const [removingMember, setRemovingMember] = useState(false);
  const [confirmEndEvent, setConfirmEndEvent] = useState(false);
  const [endingEvent, setEndingEvent] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError,setPushError] = useState('');
  const [pushRegistrationStatus,setPushRegistrationStatus] = useState<Record<string,number>|null>(null);
  const [pushRegistrationLoading,setPushRegistrationLoading] = useState(false);
  const [pushRegistrationError,setPushRegistrationError] = useState('');
  const [pushRegistrationRefresh,setPushRegistrationRefresh] = useState(0);
  const [expandedHistory,setExpandedHistory] = useState<string[]>([]);
  useEffect(()=>{
    if(tab!=='leaderboard')setSelectedPlayer(null);
  },[tab]);
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(()=>{
    const query=new URLSearchParams(window.location.search);
    const requestedTab=query.get('tab');
    if(requestedTab==='games'||requestedTab==='leaderboard'||requestedTab==='history'||requestedTab==='members')
      setTab(requestedTab);
    const section=query.get('view');
    if(section==='requests'||section==='invite'||section==='roster'||section==='notifications')
      setMemberSection(section);
    if(query.get('inviteGame'))setSelectedInviteGameId(query.get('inviteGame')||'');
    Promise.all([api.events.get(id), api.auth.me()]).then(([e,u])=>{
      setEvent(e as any); setUser(u as any);
      const me = e.members.find((m:any)=>m.id===u.id);
      setIsHost(me?.role==='host'||me?.role==='cohost');
      setIsGroupOwner(me?.role==='host');
      if(query.get('newGame')==='1'&&(me?.role==='host'||me?.role==='cohost'))setShowCreate(true);
      if(query.get('mine')==='profile'&&me)
        setEditingRoomProfile({key:'member:'+u.id,name:me.name,avatarUrl:me.avatar_url||null});
    }).catch(()=>router.push('/dashboard'));
    api.games.list(id).then(setGames);
    api.events.leaderboard(id).then(setLeaders);
    api.events.history(id).then(setHistory);
  },[id]);

  useEffect(()=>{
    if(tab!=='members')return;
    let active=true;
    api.events.profiles(id).then(result=>{
      if(!active)return;
      setRoomProfiles(Object.fromEntries(result.profiles.map(p=>[p.profile_key,p])));
      setRoomProfileError('');
    }).catch(error=>{
      if(active)setRoomProfileError(error instanceof Error?error.message:'Room profiles are unavailable.');
    });
    // Include people who have been seated but are not yet on the settled-game leaderboard.
    api.events.players(id).then(rows=>{if(active)setKnownRoomPlayers(rows);}).catch(()=>{});
    return()=>{active=false};
  },[id,tab]);
  useEffect(()=>{
    isPushSubscribedToEvent(id).then(setPushEnabled);
  },[id]);

  // Only the host sees registered devices; endpoints and keys stay private.
  useEffect(()=>{
    if(tab!=='members'||!isGroupOwner)return;
    let alive=true;
    setPushRegistrationLoading(true);
    setPushRegistrationError('');
    api.events.pushRegistrations(id).then(result=>{
      if(!alive)return;
      const statuses:Record<string,number>={};
      for(const member of result.members)statuses[member.user_id]=member.device_count;
      setPushRegistrationStatus(statuses);
    }).catch(error=>{
      if(!alive)return;
      setPushRegistrationStatus(null);
      setPushRegistrationError(error?.message||'Notification registration status is unavailable.');
    }).finally(()=>{if(alive)setPushRegistrationLoading(false)});
    return()=>{alive=false};
  },[id,tab,isGroupOwner,pushRegistrationRefresh]);

  useEffect(()=>{
    if(!isGroupOwner)return;
    const refresh=()=>api.events.joinRequests(id).then(r=>{
      const newCount=r.requests.length;
      if(previousRequestCount.current!==null && newCount>previousRequestCount.current)
        playPkrSound('new-request');
      previousRequestCount.current=newCount;
      setJoinRequests(r.requests);
    }).catch(()=>{});
    refresh();const timer=setInterval(refresh,15000);
    return()=>clearInterval(timer);
  },[isGroupOwner,id]);
  function focusMemberSection(section:'invite'|'requests'|'roster'|'notifications'){
    setTab('members');setMemberSection(section);
    window.setTimeout(()=>{
      document.getElementById('pkr-members-'+section)?.scrollIntoView({behavior:'smooth',block:'start'});
    },40);
  }
  useEffect(()=>{
    if(tab!=='members'||!event||memberDeepLinkScroll.current)return;
    const section=new URLSearchParams(window.location.search).get('view');
    if(section==='requests'||section==='roster'||section==='notifications'||section==='invite'){
      memberDeepLinkScroll.current=true;
      window.setTimeout(()=>document.getElementById('pkr-members-'+section)?.scrollIntoView({behavior:'smooth',block:'start'}),300);
    }
  },[tab,event]);
  async function decideJoin(requestId:string,approve:boolean){
    setJoinDecisionNotice('');
    const name=joinRequests.find(r=>r.id===requestId)?.name||'Player';
    try{
      const result=await api.events.decideJoin(id,requestId,approve);
      setJoinRequests(v=>v.filter(r=>r.id!==requestId));
      if(approve&&result.contact_id){
        setPhoneContacts(v=>v.map(contact=>contact.id===result.contact_id
          ?{...contact,status:'approved_awaiting_member'}:contact));
      }
      setJoinDecisionNotice(approve
        ?name+' approved. They must return to their original PKR invitation on the same device, then tap “Check approval now” to finish joining. The member list will update after that.'
        :name+' request rejected.');
      // Cloudflare KV may be eventually consistent across regions. Keep the
      // confirmed host-side state visible until the normal refresh completes.
      window.setTimeout(()=>api.events.phoneContacts(id)
        .then(r=>setPhoneContacts(r.contacts)).catch(()=>{}),2000);
    }catch(e:any){setJoinDecisionNotice(e.message||'Unable to review request');}
  }
  useEffect(()=>{
    if(tab!=='members'||!isGroupOwner)return;
    let active=true;
    const refresh=()=>{
      api.events.phoneContacts(id).then(r=>{
        if(active){setPhoneContacts(r.contacts);setPhoneError('');}
      }).catch(e=>{if(active)setPhoneError(e.message||'The private contact list is unavailable.');});
      // Host room members are a separate resource from private invite contacts.
      api.events.get(id).then(e=>{if(active)setEvent(e as any)}).catch(()=>{});
    };
    refresh();
    const interval=window.setInterval(refresh,15000);
    window.addEventListener('focus',refresh);
    return()=>{active=false;window.clearInterval(interval);window.removeEventListener('focus',refresh)};
  },[tab,id,isGroupOwner]);

  useEffect(()=>{
    if(!(window as any).QRCode) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      document.head.appendChild(s);
    }
  },[]);

  async function endEvent() {
    setEndingEvent(true);
    try {
      await api.events.end(id);
      setEvent((e:any) => ({...e, status:'ended'}));
      setConfirmEndEvent(false);
    } catch(e) { alert('Failed to end event'); }
    finally { setEndingEvent(false); }
  }

  async function reopenEvent() {
    try {
      await api.events.reopen(id);
      setEvent((e:any) => ({...e, status:'active'}));
    } catch(e) { alert('Failed to reopen event'); }
  }

  async function createGame() {
    if (!form.scheduled_at) return;
    if(arrivalTimes.length<1||arrivalTimes.length>8||
      arrivalTimes.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||
      new Set(arrivalTimes).size!==arrivalTimes.length){
      alert('Choose 1–8 different RSVP arrival times before scheduling.');return;
    }
    setSaving(true);
    try {
      const ts = Math.floor(new Date(form.scheduled_at).getTime()/1000);
      const g = await api.games.create(id,{
        scheduled_at:ts, location:form.location||undefined,
        notes:form.notes||undefined, seats:parseInt(form.seats)||9,
        game_password:form.game_password||undefined,
        repeat: form.repeat !== 'none' ? form.repeat : undefined,
        format: form.format,
        rsvp_arrival_times: arrivalTimes,
        small_blind: form.small_blind ? Math.round(parseFloat(form.small_blind)*100) : undefined,
        big_blind: form.big_blind ? Math.round(parseFloat(form.big_blind)*100) : undefined,
        starting_chips: form.starting_chips ? parseInt(form.starting_chips) : undefined,
      });
      // Include every generated session when Weekly/Fortnightly recurrence is selected.
      await api.games.list(id).then(setGames).catch(()=>setGames(gs=>[g,...gs]));
      setShowCreate(false);
      setArrivalTimes(['19:00','20:00','21:00']);
      setForm({scheduled_at:'',location:'',notes:'',seats:'9',game_password:'',repeat:'none',format:'cash',small_blind:'',big_blind:'',starting_chips:''});
      router.push('/games/'+g.id);
    } catch(e:any){ alert(e.message); }
    finally { setSaving(false); }
  }

  async function generateInvite(role='cohost') {
    const email=window.prompt('Enter the member’s email address (they must sign in with this address to accept):','')?.trim();
    if(!email)return;
    try {
      const r = await api.events.invite(id, role,email);
      setInviteUrl(r.url); setInviteRole(role);setInviteEmail(r.recipient_email); setShowInvite(true);
    } catch(e:any){ alert(e.message); }
  }

  async function inviteMobile(name=phoneName, phone=phoneNumber, role=phoneRole){
    if(!name.trim()||!phone.trim()){setPhoneError('Enter a member name and mobile number.');return;}
    setPhoneBusy(true);setPhoneError('');
    try{
      const result=await api.events.inviteByPhone(id,{display_name:name.trim(),phone:phone.trim(),role});
      setPhoneContacts(list=>[...list.filter(x=>x.id!==result.contact.id),result.contact]);
      setPhoneShare({whatsapp_url:result.whatsapp_url,url:result.invite.url,name:name.trim()});
      setPhoneName('');setPhoneNumber('');setPhoneRole('member');
    }catch(e:any){setPhoneError(e.message||'Unable to prepare the private invitation.');}
    finally{setPhoneBusy(false);}
  }
  async function removeMobileContact(contactId:string,name:string){
    if(!window.confirm('Remove '+name+' from this group? Their group membership and pending invitations will be revoked.'))return;
    setPhoneBusy(true);
    try{
      await api.events.removePhoneContact(id,contactId);
      setPhoneContacts(list=>list.filter(x=>x.id!==contactId));
    }catch(e:any){setPhoneError(e.message||'Could not remove the contact.');}
    finally{setPhoneBusy(false);}
  }
  function gameWhatsAppLink(phone:string,gameId:string){
    const url=appUrl+'/games/'+gameId+'/rsvp';
    const message='♠ '+event.name+' poker night\nPrivate group RSVP: '+url+
      '\nOnly authorised members of this group can access this game.';
    return 'https://wa.me/'+phone.replace(/\D/g,'')+'?text='+encodeURIComponent(message);
  }

  async function togglePush() {
    setPushError('');
    if(!canUsePush()||(iosDevice&&!isPWA)){
      router.push('/install?group='+encodeURIComponent(id));return;
    }
    if(typeof Notification!=='undefined'&&Notification.permission==='denied'){
      setPushError('Notifications are blocked in your device settings. Allow PKR notifications, then try again.');
      return;
    }
    setPushLoading(true);
    try{
      if(pushEnabled){
        const succeeded=await unsubscribePush(id);
        if(succeeded)setPushEnabled(false);
        else setPushError('Unable to disable alerts for this room. Please try again.');
      }else{
        const permission=await Notification.requestPermission();
        if(permission==='granted'){
          const succeeded=await subscribePush(id,user?.id,user?.name);
          if(succeeded)setPushEnabled(true);
          else setPushError('Unable to subscribe. Confirm you are a member of this room and try again.');
        }else setPushError('Notification permission was not granted.');
      }
    }catch{setPushError('Could not update notification settings. Please try again.');}
    finally{
      setPushLoading(false);
      if(isGroupOwner)setPushRegistrationRefresh(n=>n+1);
    }
  }

  async function removeMember(userId: string, name: string) {
    setRemovingMember(true);
    try {
      await api.events.removeMember(id, userId);
      setEvent((ev:any) => ({...ev, members: ev.members.filter((m:any) => m.id !== userId)}));
      setConfirmRemoveMember(null);
    } catch(e:any) { alert(e.message); }
    finally { setRemovingMember(false); }
  }

  const isPWA      = useMemo(()=>isPWAInstalled(),[]);
  const iosDevice  = useMemo(()=>isIOS(),[]);
  const safariOnly = useMemo(()=>isSafari(),[]);

  if (!event) return null;

  const upcoming = games.filter(g=>isCurrentGame(g)).sort((a,b)=>a.scheduled_at-b.scheduled_at);
  const unfinished = games.filter(g=>isUnfinishedGame(g)).sort((a,b)=>b.scheduled_at-a.scheduled_at);
  const selectedGameId=upcoming.some(g=>g.id===selectedInviteGameId)?selectedInviteGameId:upcoming[0]?.id;
  const settled  = games.filter(g=>g.status==='settled');
  const visibleMembers=(event.members||[]).filter((m:any)=>{
    const role=String(m.role||'member');
    const matchRole=memberFilter==='all'||(memberFilter==='admins'?role==='host'||role==='cohost':role==='member');
    const q=memberQuery.trim().toLowerCase();
    const screen=roomProfiles['member:'+m.id]?.screen_name||'';
    return matchRole&&(!q||[m.name,m.email,screen].some(v=>String(v||'').toLowerCase().includes(q)));
  });
  const historicalPeople=new Map<string,{display_name:string;games_played:number;user_id?:string}>();
  for(const person of [...knownRoomPlayers,...leaders]){
    const name=String(person.display_name||'').trim(),key=name.toLowerCase();
    if(!key)continue;
    const prior=historicalPeople.get(key);
    if(!prior||person.games_played>=prior.games_played)
      historicalPeople.set(key,{display_name:name,games_played:person.games_played,user_id:(person as any).user_id||prior?.user_id});
  }
  const historicalPlayers=[...historicalPeople.values()].filter(p=>{
    const name=p.display_name,key=name.toLowerCase();
    const alreadyMember=(event.members||[]).some((m:any)=>String(m.name||'').trim().toLowerCase()===key);
    const q=memberQuery.trim().toLowerCase();
    return !alreadyMember&&(memberFilter!=='admins')&&(!q||key.includes(q)||
      String(roomProfiles['history:'+key]?.screen_name||'').toLowerCase().includes(q));
  }).sort((a,b)=>b.games_played-a.games_played||a.display_name.localeCompare(b.display_name)).slice(0,150);
  async function saveRoomProfile(input:RoomPlayerProfileInput){
    const saved=await api.events.saveProfile(id,input);
    setRoomProfiles(current=>({...current,[saved.profile.profile_key]:saved.profile}));
  }
  const installLink = appUrl;

  const statusColor:any = {
    scheduled:'var(--amber)', lobby:'var(--gold)', active:'var(--green)',
    settled:'var(--muted)', cancelled:'var(--red)',
  };

  const TABS: Tab[] = ['games', 'leaderboard', 'history', 'members'];

  const TABS_NAV = ['games','leaderboard','history','members'];
  const selectTab = (next: Tab) => {
    setTab(next);
    const url=new URL(window.location.href);
    url.searchParams.set('tab',next);
    window.history.replaceState(window.history.state,'',url.pathname+url.search);
    window.dispatchEvent(new CustomEvent('pkr:select-room-tab',{detail:next}));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <div className="pkr-app pkr-event pkr-casino" style={{minHeight:'100vh',paddingBottom:80}}>
      <div style={{position:'fixed',bottom:-60,right:-40,fontSize:420,opacity:0.018,color:'var(--gold)',lineHeight:1,userSelect:'none',pointerEvents:'none',fontFamily:'serif',zIndex:0}}>♠</div>

      {/* Header */}
      <div className="pkr-topbar" style={{background:'var(--bg2)',borderBottom:'1px solid var(--border-sub)',position:'sticky',top:0,zIndex:50,backdropFilter:'blur(16px)'}}>
        <div style={{maxWidth:960,margin:'0 auto',padding:'0 16px',height:60,display:'flex',alignItems:'center',gap:12}}>
          <button aria-label="Back to poker rooms" onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:20,padding:'4px 8px',lineHeight:1,display:'flex',alignItems:'center'}}>‹</button>
          <div style={{flex:1,minWidth:0}}>
            <div className="display" style={{fontSize:16,color:'var(--white)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{event.name}</div>
          </div>
          {/* Push bell */}
          {canUsePush() && (
            <button onClick={togglePush} disabled={pushLoading} title={pushEnabled?'Notifications ON — tap to disable':'Enable push notifications'}
              style={{background:pushEnabled?'rgba(0,255,136,0.12)':'rgba(255,255,255,0.05)',
                color:pushEnabled?'var(--green)':'var(--muted)',
                border:`1px solid ${pushEnabled?'rgba(0,255,136,0.3)':'var(--border-sub)'}`,
                borderRadius:2,padding:'5px 8px',cursor:'pointer',fontSize:16,minHeight:36,
                display:'flex',alignItems:'center',WebkitTapHighlightColor:'transparent',opacity:pushLoading?0.5:1}}>
              {pushEnabled ? '🔔' : '🔕'}
            </button>
          )}
          {isHost && (
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-primary" style={{fontSize:11,padding:'7px 14px'}} onClick={()=>setShowCreate(true)}>+ Game</button>
              <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 12px'}} onClick={()=>setShowInstall(true)}>Share</button>
            </div>
          )}
        </div>
      </div>

      {/* Host-selected premium room dashboard. The old tabs and management tools
          remain below it, unchanged; layout switching only affects presentation. */}
      {isGroupOwner&&joinRequests.length>0&&
        <div className="pkr-dual-join-alert" role="status">
          <strong>🔔 {joinRequests.length} player{joinRequests.length===1?'':'s'} awaiting room approval</strong>
          <button type="button" onClick={()=>selectTab('members')}>Review requests →</button>
        </div>}
      <div className="pkr-event-dual-region">
        {!isHost ? <PlayerRoomDashboard room={event} games={games} history={history} leaders={leaders}
          memberId={user?.id} memberName={user?.name}
          onMyProfile={()=>{const me=event.members?.find((m:any)=>m.id===user?.id);
            selectTab('members');
            if(me)setEditingRoomProfile({key:'member:'+me.id,name:me.name,avatarUrl:me.avatar_url||null});
          }}/> : <RoomDashboardDual room={event} games={games} history={history} leaders={leaders}
          members={event.members||[]} viewerIsHost={isGroupOwner} viewerCanManageGames={isHost}
          onCreateGame={()=>setShowCreate(true)}
          onInvite={()=>{setMemberSection('invite');selectTab('members');}}
          onMembers={()=>selectTab('members')}
          onHistory={()=>selectTab('history')}/>}
      </div>

      {/* Desktop tabs; phone navigation is fixed at the bottom. */}
      <nav className="pkr-event-tabs" aria-label="Poker room sections">
        <div className="pkr-event-tabs-inner">
          {TABS.map(t => (
            <button type="button" key={t} onClick={() => selectTab(t)}
              aria-pressed={tab === t} className={'tab ' + (tab === t ? 'active' : '')}>
              {t === 'leaderboard' ? 'Standings' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </nav>

      <div className="pkr-content" style={{maxWidth:960,margin:'0 auto',padding:'24px 16px',position:'relative',zIndex:1}}>
        {pushError&&<div role="alert" className="pkr-unfinished-note" style={{marginBottom:12}}>{pushError}</div>}

        {/* ── Games tab ── */}
        {tab==='games' && (
          <div>
            {upcoming.length===0 && unfinished.length===0 && settled.length===0 && (
              <div className="empty-state">
                <div className="empty-state-icon">♠</div>
                <div className="empty-state-text">No games scheduled yet.</div>
                {isHost && <div style={{fontSize:12,color:'var(--faint)',marginTop:6}}>Click + Game to schedule one.</div>}
              </div>
            )}
            {upcoming.length>0 && (
              <div className="pkr-games-heading">
                <div><span className="pkr-eyebrow">Your schedule</span><h2>Upcoming &amp; live games</h2></div>
                <span>{upcoming.filter(g=>isLiveGame(g)).length} live</span>
              </div>
            )}
            {upcoming.map(g=>(
              <GameCard key={g.id} game={g} appUrl={appUrl} eventName={event.name} isHost={isHost} canDelete={isGroupOwner}
                onClick={()=>router.push(`/games/${g.id}`)}
                onOpenTable={()=>router.push(`/games/${g.id}/play`)}
                onWatchLive={()=>g.live_token && router.push(`/games/live/${g.live_token}`)}
                onQuickSeat={()=>{setQuickSeatGameId(g.id);setShowQuickSeat(true);}}
                onCancel={()=>setConfirmDelete(g.id)} onDelete={()=>setConfirmDelete(g.id+':delete')}
                onInviteMembers={()=>{setSelectedInviteGameId(g.id);setTab('members');}}/>
            ))}
            {unfinished.length>0&&<section aria-label="Unfinished game sessions" style={{margin:'20px 0'}}>
              <div className="pkr-unfinished-note" style={{marginBottom:10}}><strong>{unfinished.length} unfinished or past-due game{unfinished.length===1?'':'s'}</strong>
                <p>These historical sessions have been preserved. They are not counted as live or upcoming; open a game to review its records.</p>
              </div>
              {unfinished.map(g=><GameCard key={g.id} game={g} appUrl={appUrl} eventName={event.name} isHost={isHost} canDelete={isGroupOwner}
                onClick={()=>router.push('/games/'+g.id)}
                onOpenTable={()=>router.push('/games/'+g.id+'/play')}
                onWatchLive={()=>g.live_token&&router.push('/games/live/'+g.live_token)}
                onQuickSeat={()=>{setQuickSeatGameId(g.id);setShowQuickSeat(true)}}
                onCancel={()=>setConfirmDelete(g.id)} onDelete={()=>setConfirmDelete(g.id+':delete')}
                onInviteMembers={()=>{setSelectedInviteGameId(g.id);setTab('members')}}/>)}
            </section>}
            {settled.length>0 && (
              <>
                <div style={{fontSize:9,letterSpacing:'0.2em',textTransform:'uppercase',color:'var(--faint)',margin:'20px 0 10px',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>
                  Recent Results
                </div>
                {settled.slice(0,3).map(g=>(
                  <div key={g.id} className="card pkr-game-card" style={{marginBottom:8,cursor:'pointer'}} onClick={()=>router.push(`/games/${g.id}`)}>
                    <div style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,color:'var(--ivory)'}}>{fmtDate(g.scheduled_at)}</div>
                        {g.location && <div style={{fontSize:11,color:'var(--muted)'}}>{g.location}</div>}
                        {(g as any).format && (g as any).format !== 'cash' && (
                          <span style={{fontSize:10,color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',
                            letterSpacing:'0.08em',textTransform:'uppercase'}}>
                            {String(({tournament:'🏆 Tournament',rebuy:'♻️ Rebuy',freezeout:'❄️ Freezeout'} as {[k:string]:string})[(g as any).format] || (g as any).format)}
                          </span>
                        )}
                      </div>
                      <span className="badge badge-settled">Settled</span>
                      <span style={{color:'var(--faint)',fontSize:16}}>›</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* All-time player standings — derived from settled game records. */}
        {tab==='leaderboard'&&<StandingsBoard leaders={leaders} settledGames={settled.length} onSelectPlayer={setSelectedPlayer} roomId={id}/>}

        {/* ── Members tab ── */}
        {tab==='members' && (
          <div className="pkr-members-panel">
            <header className="pkr-member-summary">
              <div className="pkr-member-summary-copy"><span className="pkr-eyebrow">♟ PRIVATE POKER CLUB</span><h2>Members</h2><p>Manage your poker room and the people who play together.</p></div>
              <div className="pkr-member-summary-metric"><strong>{event.members?.length||0}</strong><small>Room members</small></div>
              <div className="pkr-member-summary-metric"><strong>{joinRequests.length}</strong><small>Join requests</small></div>
            </header>
            <nav className="pkr-members-shortcuts" aria-label="Members quick actions">
              {([
                {id:'invite',text:'＋ Invite & QR',visible:isGroupOwner},
                {id:'requests',text:'🔔 Approvals'+(joinRequests.length?' ('+joinRequests.length+')':''),visible:isGroupOwner},
                {id:'roster',text:'♟ Players ('+(event.members?.length||0)+')',visible:true},
                {id:'notifications',text:'🔊 Alerts & sound',visible:true},
              ] as const).filter(action=>action.visible).map(action=>
                <button type="button" key={action.id} className={memberSection===action.id?'active':''}
                  onClick={()=>focusMemberSection(action.id)}>{action.text}</button>)}
            </nav>
            <section className="pkr-members-alert-panel" id="pkr-members-notifications" aria-label="Member notification settings">
              <div className="pkr-members-alert-head">
                <div><span className="pkr-eyebrow">STAY IN THE LOOP</span>
                  <h3>{isGroupOwner?'Host notifications':'Your poker notifications'}</h3>
                  <p>{isGroupOwner
                    ?'Get a push alert when someone requests membership, plus game and RSVP updates.'
                    :'Get alerts for games, results and important updates on this device.'}</p>
                </div>
                <button type="button" className="btn btn-primary" disabled={pushLoading}
                  onClick={()=>void togglePush()}>
                  {pushLoading?'Updating…':pushEnabled?'🔔 Alerts on — disable':'🔔 Enable push alerts'}
                </button>
              </div>
              <ForegroundSoundToggle/>
              <a href={'/install?group='+encodeURIComponent(id)} className="pkr-members-setup-link">Phone setup & notification test →</a>
              {isGroupOwner&&(
                <div className="pkr-host-push-overview" aria-label="Member notification registrations">
                  <div className="pkr-host-push-overview-head">
                    <div>
                      <strong>Notification setup (not member availability)</strong>
                      <p>
                        {pushRegistrationLoading?'Checking registrations…'
                          :pushRegistrationError?'Unable to check notification registrations'
                          :pushRegistrationStatus
                            ?(event.members||[]).filter((member:any)=>(pushRegistrationStatus[member.id]||0)>0).length+
                              ' of '+(event.members||[]).length+' members have a registered notification device'
                            :'Not checked yet'}
                      </p>
                    </div>
                    <button type="button" className="btn btn-outline" disabled={pushRegistrationLoading}
                      onClick={()=>setPushRegistrationRefresh(n=>n+1)}>
                      {pushRegistrationLoading?'Checking…':'↻ Refresh'}
                    </button>
                  </div>
                  {pushRegistrationError&&<p role="alert" className="pkr-host-push-error">{pushRegistrationError}</p>}
                  <p className="pkr-host-push-disclaimer">A missing registration does not mean the player is unavailable or has declined the game. It only means this room has no recorded notification device for them. RSVP attendance is tracked separately. Registration does not guarantee delivery.</p>
                </div>
              )}
            </section>
           <div id="pkr-members-requests" className="pkr-members-anchor" />
           {isGroupOwner&&joinRequests.length===0&&<section className="pkr-member-empty-approvals">
             <strong>✓ No approvals waiting</strong>
             <p>When a player scans their private invitation, their request will appear here.
               If host push alerts are enabled, you will also receive a notification.</p>
           </section>}
           {isGroupOwner&&joinDecisionNotice&&
            <div role="status" style={{padding:'13px 15px',marginBottom:15,border:'1px solid var(--border-hi)',borderRadius:10,background:'var(--bg2)',fontSize:13,lineHeight:1.55}}>
              {joinDecisionNotice}
            </div>}
           {isGroupOwner&&joinRequests.length>0&&<section className="pkr-member-request-card" style={{border:'2px solid var(--gold)',padding:18,borderRadius:12,marginBottom:18,background:'var(--bg2)'}}><h2>🔔 Pending join requests ({joinRequests.length})</h2><p>Confirm the requester personally before approving. A WhatsApp link does not prove phone ownership.</p>{joinRequests.map(r=><div key={r.id} style={{padding:'12px 0',borderBottom:'1px solid var(--border-hi)'}}><strong>{r.name}</strong><p>Invited as {r.expected_member} · phone ending {r.phone.slice(-4)}</p><div style={{display:'flex',gap:10}}><button className="btn btn-primary" onClick={()=>decideJoin(r.id,true)}>Approve</button><button className="btn btn-ghost" onClick={()=>decideJoin(r.id,false)}>Reject</button></div></div>)}</section>}
            <div id="pkr-members-invite" className="pkr-members-anchor" />
            {isGroupOwner&&<section className="pkr-member-invite" style={{padding:'20px',background:'var(--bg2)',border:'1px solid var(--border-hi)',
              borderRadius:10,marginBottom:16}}>
              <div style={{fontSize:11,color:'var(--gold)',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:7}}>
                Private members · Mobile first
              </div>
              <h2 style={{fontFamily:'var(--font-display),serif',fontSize:21,marginBottom:6}}>Invite a player by QR or WhatsApp</h2>
              <p style={{fontSize:12,color:'var(--muted)',lineHeight:1.6,marginBottom:15}}>
                Enter the player's name and mobile number to generate a personal QR code and WhatsApp link. The player scans the QR with their phone camera, requests to join, and waits for your approval. A personal QR cannot be reused to admit other players. Free invitations do not verify phone ownership.
                Other groups cannot see your contacts.
              </p>
              <div style={{display:'grid',gap:9,marginBottom:12}}>
                <input id="pkr-mobile-name" aria-label="Player name" value={phoneName} maxLength={60}
                  onChange={e=>setPhoneName(e.target.value)} placeholder="Player name"
                  style={{width:'100%',background:'var(--bg3)',color:'var(--white)',border:'1px solid var(--border-hi)',padding:'12px',borderRadius:5}}/>
                <input type="tel" aria-label="WhatsApp mobile number" value={phoneNumber}
                  onChange={e=>setPhoneNumber(e.target.value)} placeholder="WhatsApp mobile · 04xx xxx xxx or +61…"
                  style={{width:'100%',background:'var(--bg3)',color:'var(--white)',border:'1px solid var(--border-hi)',padding:'12px',borderRadius:5}}/>
                <select aria-label="Member role" value={phoneRole} onChange={e=>setPhoneRole(e.target.value as 'member'|'cohost')}
                  style={{width:'100%',background:'var(--bg3)',color:'var(--white)',border:'1px solid var(--border-hi)',padding:'12px',borderRadius:5}}>
                  <option value="member">Player / member</option><option value="cohost">Co-host</option>
                </select>
              </div>
              <button className="btn btn-primary" disabled={phoneBusy||!phoneName.trim()||!phoneNumber.trim()}
                style={{width:'100%',padding:'12px'}} onClick={()=>void inviteMobile()}>
                {phoneBusy?'Creating invite…':'Generate QR & WhatsApp invitation'}
              </button>
              {phoneError&&<p role="alert" style={{fontSize:12,marginTop:12,color:'var(--amber)'}}>{phoneError}</p>}
              {phoneContacts.length>0&&<div style={{marginTop:20}}>
                {upcoming.length>0&&<label style={{display:'block',fontSize:11,color:'var(--muted)',marginBottom:10}}>Choose game for WhatsApp invitations:
                  <select aria-label="Game to invite members to" value={selectedGameId||''}
                    onChange={e=>setSelectedInviteGameId(e.target.value)}
                    style={{width:'100%',marginTop:6,padding:'10px',background:'var(--bg3)',color:'var(--white)',border:'1px solid var(--border-hi)'}}>
                    {upcoming.map(game=><option value={game.id} key={game.id}>{fmtDate(game.scheduled_at)}</option>)}
                  </select>
                </label>}
                <div style={{fontSize:11,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>
                  Your private contacts · {phoneContacts.length}
                </div>
                {phoneContacts.map(contact=><div key={contact.id} style={{padding:'12px 0',borderTop:'1px solid var(--border-sub)',
                  display:'flex',alignItems:'center',flexWrap:'wrap',gap:8}}>
                  <div style={{flex:1,minWidth:140}}>
                    <div style={{fontSize:14}}>{contact.display_name}</div>
                    <div style={{fontSize:11,color:'var(--muted)'}}>{contact.phone} · {contact.status==='joined'?'Joined'
                      :contact.status==='approved_awaiting_member'?'Approved — waiting for player to finish joining'
                      :contact.status==='awaiting_host_approval'?'Waiting for host approval'
                      :'Invitation sent — not yet joined'}</div>
                  </div>
                  {contact.status==='approved_awaiting_member'&&
                    <a className="btn btn-outline" target="_blank" rel="noopener noreferrer"
                      style={{fontSize:10,padding:'7px 9px',textDecoration:'none'}}
                      href={'https://wa.me/'+contact.phone.replace(/[^0-9]/g,'')+'?text='+encodeURIComponent(
                        'Your PKR join request for '+event.name+' is approved. Please reopen the original invitation in the same browser and tap Check approval now to finish joining. If you no longer have the link, let me know.'
                      )}>Remind to complete</a>}
                  {contact.status==='joined'&&<button className="btn btn-outline" style={{fontSize:10,padding:'7px 9px'}} disabled={phoneBusy} onClick={async()=>{try{const result=await api.events.recoverContact(id,contact.id);setPhoneShare({whatsapp_url:result.whatsapp_url,url:result.url,name:contact.display_name});}catch(e:any){alert(e.message);}}}>Recover access</button>}
                  {contact.status==='joined'&&selectedGameId&&
                    <a href={gameWhatsAppLink(contact.phone,selectedGameId)} target="_blank" rel="noreferrer"
                      className="btn btn-outline" style={{textDecoration:'none',fontSize:10,padding:'7px 9px'}}>WhatsApp game</a>}
                  {contact.status!=='joined'&&<button className="btn btn-outline" style={{fontSize:10,padding:'7px 9px'}} disabled={phoneBusy}
                    onClick={()=>void inviteMobile(contact.display_name,contact.phone,'member')}>Invite again</button>}
                  <button className="btn btn-ghost" style={{fontSize:10,padding:'7px 9px',color:'var(--red)'}} disabled={phoneBusy}
                    onClick={()=>void removeMobileContact(contact.id,contact.display_name)}>Remove</button>
                </div>)}
              </div>}
              <p style={{fontSize:11,color:'var(--muted)',lineHeight:1.6,marginTop:12}}>
                WhatsApp opens on your device; PKR does not automatically send messages to contacts.
              </p>
            </section>}
            {phoneShare&&<AppDialog className="modal-overlay" onClick={e=>{if(e.currentTarget===e.target)setPhoneShare(null);}}>
              <div className="modal-sheet">
                <h2 style={{fontSize:21,marginBottom:9}}>Private WhatsApp invite ready</h2>
                <p style={{fontSize:12,color:'var(--muted)',marginBottom:16}}>Send only to {phoneShare.name}.
                  The host must approve the person's join request. This free flow does not verify phone ownership.</p>
                <div style={{marginBottom:14,padding:12,background:'var(--bg3)',borderRadius:10}}>
                <InviteQRCode url={phoneShare.url} />
                <p style={{fontSize:12,color:'var(--muted)',marginTop:10,textAlign:'center',lineHeight:1.6}}>
                  Have {phoneShare.name} scan this code with their phone camera. The request will appear in
                  this room under Members → Pending join requests. Approve or Reject it there.
                  The player must then tap “Check approval and join PKR”.
                </p>
              </div>
              <div className="pkr-invite-preview" aria-label="Private invitation preview">
                  <span>♠ PKR · PRIVATE INVITATION</span>
                  <strong>{event.name}</strong>
                  <p>Hi {phoneShare.name}, you have been invited to join our poker room on PKR. Your host will review the request before access is granted.</p>
                  <small>{phoneShare.url}</small>
                </div>
                <a href={phoneShare.whatsapp_url} rel="noreferrer" target="_blank" className="btn btn-primary"
                  style={{display:'block',textAlign:'center',padding:'13px',textDecoration:'none'}}>Open WhatsApp for this member</a>
                <button className="btn btn-outline" style={{width:'100%',marginTop:9}}
                  onClick={()=>navigator.clipboard.writeText(phoneShare.url)}>Copy personal invitation link</button>
                <button className="btn btn-ghost" style={{width:'100%',marginTop:9}} onClick={()=>setPhoneShare(null)}>Done</button>
              </div>
            </AppDialog>}
            {/* Confirm remove modal */}
            {confirmRemoveMember && (
              <AppDialog className="modal-overlay" onClick={()=>setConfirmRemoveMember(null)}>
                <div className="modal animate-up" onClick={(e)=>e.stopPropagation()} style={{maxWidth:340}}>
                  <div style={{fontSize:16,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500,marginBottom:8}}>Remove Member?</div>
                  <div style={{fontSize:13,color:'var(--muted)',marginBottom:20,fontFamily:'var(--font-body),sans-serif'}}>
                    Remove <strong style={{color:'var(--ivory)'}}>{confirmRemoveMember.name}</strong> from this event? They will lose access.
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setConfirmRemoveMember(null)}>Cancel</button>
                    <button className="btn btn-danger" style={{flex:1}} disabled={removingMember}
                      onClick={()=>removeMember(confirmRemoveMember.id, confirmRemoveMember.name)}>
                      {removingMember ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              </AppDialog>
            )}
            <div id="pkr-members-roster" className="pkr-members-anchor" />
            {roomProfileError&&<p role="status" className="pkr-member-profile-notice">Player profile editing is currently unavailable: {roomProfileError}. Existing members and game records remain available.</p>}
            <div className="pkr-member-search-tools">
              <label htmlFor="pkr-member-search" className="pkr-member-search-label"><span>⌕</span>
                <input id="pkr-member-search" type="search" aria-label="Search members" placeholder="Search members…" value={memberQuery} onChange={e=>setMemberQuery(e.target.value)}/>
              </label>
              <div className="pkr-member-role-filters" role="group" aria-label="Filter members by role">
                {([['all','All'],['admins','Admins'],['players','Players']] as const).map(([key,label])=>
                  <button key={key} type="button" aria-pressed={memberFilter===key} onClick={()=>setMemberFilter(key)}>{label}</button>)}
              </div>
            </div>
            {(!event.members || event.members.length === 0) ? (
              <div className="empty-state">
                <div className="empty-state-icon">👥</div>
                <div className="empty-state-text">No members yet. Use the invite button to add co-hosts or members.</div>
              </div>
            ) : (
              <div className="card pkr-member-roster" style={{marginBottom:14}}>
                {visibleMembers.length===0&&<p className="pkr-member-no-results">No members match this search or filter.</p>}
                {visibleMembers.map((m:any, i:number) => (
                  <div key={m.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',
                    borderBottom:i<visibleMembers.length-1?'1px solid var(--border-sub)':'none'}}>
                    <div style={{width:38,height:38,borderRadius:'50%',background:'var(--bg3)',
                      border:'1px solid var(--border-sub)',display:'flex',alignItems:'center',
                      justifyContent:'center',fontSize:16,flexShrink:0,overflow:'hidden'}}>
                      {roomProfiles['member:'+m.id]?.avatar_data
                        ? <img src={roomProfiles['member:'+m.id].avatar_data!} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                        : roomProfiles['member:'+m.id]?.avatar_emoji
                          ? <span aria-hidden="true">{roomProfiles['member:'+m.id].avatar_emoji}</span>
                          : m.avatar_url
                            ? <img src={m.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                            : <span style={{color:'var(--gold)',fontFamily:'serif'}}>{(m.name||'?')[0].toUpperCase()}</span>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <RecordMetric request={{kind:'player',title:m.name+' — game history',roomId:id,playerId:m.id,playerName:m.name}}
                        className="pkr-member-history-link" style={{minHeight:44,alignItems:'flex-start',justifyContent:'center',gap:3}}>
                        <strong style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),sans-serif',fontWeight:600,
                          overflowWrap:'anywhere',textAlign:'left'}}>{roomProfiles['member:'+m.id]?.screen_name||m.name}</strong>
                        {roomProfiles['member:'+m.id]?.screen_name&&<small className="pkr-member-profile-identity">{m.name}</small>}
                        <small style={{fontSize:11,color:'var(--pkr-a-primary)'}}>View game history ›</small>
                      </RecordMetric>
                      <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginTop:2}}>
                        <span style={{
                          padding:'1px 6px',borderRadius:2,fontSize:9,fontWeight:600,letterSpacing:'0.1em',
                          textTransform:'uppercase',fontFamily:'var(--font-body),sans-serif',
                          background: m.role==='host'?'rgba(201,168,76,0.15)':m.role==='cohost'?'rgba(76,175,125,0.12)':'rgba(255,255,255,0.06)',
                          color: m.role==='host'?'var(--gold)':m.role==='cohost'?'var(--green)':'var(--muted)',
                        }}>{m.role}</span>
                        {m.email && <span style={{marginLeft:8}}>{m.email}</span>}
                      </div>
                      {isGroupOwner&&(
                        <div className="pkr-member-push-state" aria-label={'Notification registration for '+m.name}>
                          <span className="pkr-member-push-on">✓ Approved member</span>
                          <span style={{marginLeft:8}}>
                            {pushRegistrationLoading
                              ?'Checking notification setup…'
                              :pushRegistrationStatus
                                ?(pushRegistrationStatus[m.id]||0)>0
                                  ?'🔔 Registered on '+pushRegistrationStatus[m.id]+' device'+(pushRegistrationStatus[m.id]===1?'':'s')
                                  :'Notifications not enabled on this member’s device'
                                :'Notification setup not available'}
                          </span>
                        </div>
                      )}
                    </div>
                    {(isHost||user?.id===m.id)&&<button type="button" className="pkr-member-profile-edit" disabled={!!roomProfileError}
                      aria-label={'Edit player profile for '+m.name} title={roomProfileError||'Edit this room profile'}
                      onClick={()=>setEditingRoomProfile({key:'member:'+m.id,name:m.name,avatarUrl:m.avatar_url||null})}>Edit profile</button>}
                    {isGroupOwner && m.role !== 'host' && (
                      <button className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px',color:'var(--red)',borderColor:'rgba(231,76,60,0.3)',flexShrink:0}}
                        onClick={()=>setConfirmRemoveMember({id:m.id,name:m.name})}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {historicalPlayers.length>0&&<section className="pkr-historical-player-roster">
              <header><h3>Players from saved games</h3><p>Players recorded in game results who have not joined this room with a PKR account. Their display profile does not modify settled games.</p></header>
              {historicalPlayers.map((p:any)=>{
                const playerName=String(p.display_name||'').trim();
                const key='history:'+playerName.toLowerCase();
                const profile=roomProfiles[key];
                return <div key={key} className="pkr-historical-player-row">
                  <span className="pkr-historical-player-avatar">
                    {profile?.avatar_data?<img src={profile.avatar_data} alt=""/>:
                      <span aria-hidden="true">{profile?.avatar_emoji||playerName.charAt(0).toUpperCase()}</span>}
                  </span>
                  <span className="pkr-historical-player-name"><strong>{profile?.screen_name||playerName}</strong>
                    <small>{profile?.screen_name?playerName+' · ':''}{p.games_played||0} recorded games</small></span>
                  <RecordMetric request={{kind:'player',title:playerName+' — game history',roomId:id,playerId:p.user_id,playerName}}
                    className="pkr-member-history-mini">History</RecordMetric>
                  {isHost&&<button type="button" disabled={!!roomProfileError} className="pkr-member-profile-edit"
                    aria-label={'Edit player profile for '+playerName}
                    onClick={()=>setEditingRoomProfile({key,name:playerName,avatarUrl:null})}>Profile</button>}
                </div>;
              })}
            </section>}
            {isGroupOwner && (
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button className="btn btn-outline" style={{flex:1,fontSize:12}} onClick={()=>{setPhoneRole('member');document.getElementById('pkr-mobile-name')?.focus();}}>+ Invite Member by Mobile</button>
                <button className="btn btn-ghost" style={{flex:1,fontSize:12}} onClick={()=>{setPhoneRole('cohost');document.getElementById('pkr-mobile-name')?.focus();}}>+ Co-host by Mobile</button>
                {leaders.length>1&&<button className="btn btn-ghost" style={{width:'100%',fontSize:12,marginTop:4,color:'var(--amber)',borderColor:'rgba(212,137,26,0.3)'}} onClick={()=>{setMergeFrom('');setMergeTo('');setMergeMsg('');setShowMerge(true);}}>⟳ Merge Duplicate Players</button>}
              </div>
            )}

            {/* Merge Players Modal */}
            {showMerge && (
              <AppDialog className="modal-overlay" onClick={()=>setShowMerge(false)}>
                <div className="modal animate-up" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
                  <div style={{fontSize:16,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500,marginBottom:6}}>⟳ Merge Duplicate Players</div>
                  <div style={{fontSize:12,color:'var(--muted)',marginBottom:16,fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
                    Select the duplicate name to remove and the correct name to keep. All stats will be combined into the kept name.
                  </div>
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:11,color:'var(--muted)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6,fontFamily:'var(--font-body),sans-serif'}}>Remove this duplicate</div>
                    <select value={mergeFrom} onChange={e=>setMergeFrom(e.target.value)}
                      style={{width:'100%',background:'var(--bg3)',color:'var(--white)',border:'1px solid var(--border-sub)',borderRadius:4,padding:'10px 12px',fontSize:13,fontFamily:'var(--font-body),sans-serif'}}>
                      <option value="">Select player...</option>
                      {leaders.filter((l:any)=>l.display_name!==mergeTo).map((l:any)=>(
                        <option key={l.user_id} value={l.display_name}>{l.display_name} ({l.games_played} games, {l.total_net>0?'+':''}${(l.total_net/100).toFixed(0)})</option>
                      ))}
                    </select>
                  </div>
                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:11,color:'var(--muted)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6,fontFamily:'var(--font-body),sans-serif'}}>Keep this name</div>
                    <select value={mergeTo} onChange={e=>setMergeTo(e.target.value)}
                      style={{width:'100%',background:'var(--bg3)',color:'var(--white)',border:'1px solid var(--border-sub)',borderRadius:4,padding:'10px 12px',fontSize:13,fontFamily:'var(--font-body),sans-serif'}}>
                      <option value="">Select player...</option>
                      {leaders.filter((l:any)=>l.display_name!==mergeFrom).map((l:any)=>(
                        <option key={l.user_id} value={l.display_name}>{l.display_name} ({l.games_played} games, {l.total_net>0?'+':''}${(l.total_net/100).toFixed(0)})</option>
                      ))}
                    </select>
                  </div>
                  {mergeMsg&&<div style={{fontSize:12,color:mergeMsg.startsWith('✅')?'var(--green)':'var(--red)',marginBottom:12,fontFamily:'var(--font-body),sans-serif'}}>{mergeMsg}</div>}
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setShowMerge(false)}>Cancel</button>
                    <button className="btn btn-primary" style={{flex:1}} disabled={!mergeFrom||!mergeTo||mergeFrom===mergeTo||merging}
                      onClick={async()=>{
                        if(!confirm(`Merge "${mergeFrom}" into "${mergeTo}"? This cannot be undone.`)) return;
                        setMerging(true); setMergeMsg('');
                        try {
                          await api.events.mergePlayers(id, mergeFrom, mergeTo);
                          setMergeMsg('✅ Merged successfully!');
                          setLeaders((prev:any[])=>{
                            const from = prev.find(l=>l.display_name===mergeFrom);
                            const to = prev.find(l=>l.display_name===mergeTo);
                            if(!from||!to) return prev;
                            const merged = {...to,
                              total_net: to.total_net+from.total_net,
                              games_played: to.games_played+from.games_played,
                              games_won: to.games_won+from.games_won,
                              biggest_win: Math.max(to.biggest_win,from.biggest_win),
                              biggest_loss: Math.max(to.biggest_loss,from.biggest_loss),
                            };
                            return prev.filter(l=>l.display_name!==mergeFrom).map(l=>l.display_name===mergeTo?merged:l);
                          });
                          setMergeFrom(''); setMergeTo('');
                        } catch(e:any){ setMergeMsg('❌ '+e.message); }
                        finally{ setMerging(false); }
                      }}>
                      {merging?'Merging…':'Merge'}
                    </button>
                  </div>
                </div>
              </AppDialog>
            )}
          </div>
        )}

        {/* ── History tab ── */}
        {tab==='history' && (
          <div>
            {history.length===0 && <div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-text">No settled games yet.</div></div>}
            <div style={{display:'grid',gap:8}}>
              {history.map(g=>(
                <div key={g.id} className="card">
                  <div style={{padding:'14px 16px',cursor:'pointer'}} onClick={()=>router.push(`/games/${g.id}`)}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:4}}>
                      <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:400}}>{fmtDate(g.scheduled_at)}</div>
                      <span className="badge badge-settled">{(g as any).player_count||0} players</span>
                    </div>
                    {g.location && <div style={{fontSize:11,color:'var(--muted)',marginBottom:8}}>📍 {g.location}</div>}
                    {((g as any).top_players||[]).length>0 && (
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {((g as any).top_players||[]).slice(0,expandedHistory.includes(g.id)?undefined:3).map((p:any,i:number)=>(
                          <div key={i} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 8px',
                            background:i===0?'rgba(201,168,76,0.08)':'rgba(255,255,255,0.03)',
                            border:`1px solid ${i===0?'rgba(201,168,76,0.25)':'var(--border-sub)'}`,borderRadius:2}}>
                            <span style={{fontSize:10,color:i===0?'var(--gold)':'var(--faint)'}}>{i===0?'♛':i===1?'♝':'♞'}</span>
                            <span style={{fontSize:11,color:'var(--ivory)',fontFamily:'var(--font-display),serif'}}>{p.display_name}</span>
                            <span style={{fontSize:11,fontWeight:600,color:p.net>0?'var(--green)':p.net<0?'var(--red)':'var(--muted)'}}>{fmtSign(p.net)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {((g as any).top_players||[]).length>3&&
                      <button type="button" onClick={e=>{e.stopPropagation();setExpandedHistory(old=>old.includes(g.id)?old.filter(x=>x!==g.id):[...old,g.id]);}}
                        style={{marginTop:9,padding:'8px 11px',borderRadius:8,border:'1px solid var(--border-hi)',background:'var(--bg3)',color:'var(--gold)',fontSize:12}}>
                        {expandedHistory.includes(g.id)?'Show top 3':'Show all '+((g as any).top_players||[]).length+' results'}
                      </button>}
                  </div>
                  {isHost && (
                    <div style={{borderTop:'1px solid var(--border-sub)',padding:'8px 14px',display:'flex',justifyContent:'flex-end'}}>
                      <button className="btn btn-ghost" style={{fontSize:11,padding:'5px 10px',color:'var(--amber)',borderColor:'rgba(212,137,26,0.3)'}}
                        onClick={()=>setConfirmDelete(g.id)}>Cancel Game</button>
                      <button className="btn btn-danger" style={{fontSize:11,padding:'5px 10px'}}
                        onClick={()=>setConfirmDelete(g.id+':delete')}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* End event confirm modal */}
      {confirmEndEvent && (
        <AppDialog className="modal-overlay" onClick={()=>setConfirmEndEvent(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
            <div style={{padding:'24px 24px 16px',borderBottom:'1px solid var(--border-sub)'}}>
              <div style={{fontSize:16,color:'var(--white)',fontFamily:"'Playfair Display',serif",fontWeight:600,marginBottom:8}}>End Event?</div>
              <div style={{fontSize:13,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',lineHeight:1.5}}>
                This will archive the event. All game history and leaderboard data will be preserved. Members will lose access and no new games can be created.
              </div>
            </div>
            <div style={{padding:'16px 24px',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setConfirmEndEvent(false)}>Cancel</button>
              <button className="btn btn-danger" style={{fontSize:12}} disabled={endingEvent} onClick={endEvent}>
                {endingEvent ? 'Ending...' : 'End Event'}
              </button>
            </div>
          </div>
        </AppDialog>
      )}

      {/* Fix 6+10: Confirm delete/cancel modal */}
      {confirmDelete && (
        <AppDialog className="modal-overlay" onClick={()=>setConfirmDelete(null)}>
          <div className="modal animate-up" onClick={e=>e.stopPropagation()} style={{maxWidth:360}}>
            <div style={{padding:'24px 24px 0'}}>
              <div style={{fontSize:16,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500,marginBottom:8}}>
                {confirmDelete.endsWith(':delete') ? 'Delete Game?' : 'Cancel Game?'}
              </div>
              <div style={{fontSize:13,color:'var(--muted)',lineHeight:1.7,fontFamily:'var(--font-body),sans-serif'}}>
                {confirmDelete.endsWith(':delete')
                  ? 'This permanently removes the game record and all player data. The leaderboard will be recalculated. This cannot be undone.'
                  : "This marks the game as cancelled. It will stay in history but won't affect the leaderboard."}
              </div>
            </div>
            <div style={{padding:'20px 24px',display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setConfirmDelete(null)}>Keep it</button>
              <button className="btn btn-danger" style={{fontSize:12}} onClick={async()=>{
                const gameId = confirmDelete.replace(':delete','');
                const isDelete = confirmDelete.endsWith(':delete');
                try {
                  if (isDelete) {
                    await api.games.delete(gameId);
                    setHistory(h=>h.filter(x=>x.id!==gameId));
                    setGames(gs=>gs.filter(g=>g.id!==gameId));
                    api.events.leaderboard(id).then(setLeaders);
                  } else {
                    await api.games.cancel(gameId);
                    setGames(gs=>gs.map(g=>g.id===gameId?{...g,status:'cancelled'}:g));
                  }
                } catch(e:any){ alert(e.message); }
                setConfirmDelete(null);
              }}>
                {confirmDelete.endsWith(':delete') ? 'Delete permanently' : 'Cancel game'}
              </button>
            </div>
          </div>
        </AppDialog>
      )}

      {/* Create game modal */}
      {showCreate && (
        <AppDialog className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowCreate(false);}} aria-labelledby="pkr-create-game-title">
          <div className="modal-sheet pkr-classic-create-game-dialog"   >
            <div className="pkr-create-game-heading">
              <span className="pkr-create-game-kicker">YOUR NEXT POKER NIGHT</span>
              <div className="pkr-create-game-title-row">
                <h2 id="pkr-create-game-title">Schedule a game</h2>
                <button type="button" className="pkr-create-game-close" aria-label="Close game scheduler" onClick={()=>setShowCreate(false)}>×</button>
              </div>
              <p>Set the game format, date and table size. Fine-tune the optional details whenever you need them.</p>
            </div>
            <div className="pkr-create-game-form" style={{display:'grid',gap:14}}>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Date & Time *</div>
                <input className="inp" type="datetime-local" value={form.scheduled_at} onChange={e=>setForm(f=>({...f,scheduled_at:e.target.value}))}/>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Location</div>
                <input className="inp" placeholder="e.g. Mike's place" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}/>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:8}}>Game format *</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8}} role="group" aria-label="Game format">
                  {([{key:'cash',label:'Cash game'},{key:'tournament',label:'Tournament'},{key:'rebuy',label:'Rebuy tournament'},{key:'freezeout',label:'Freezeout'}] as const).map(option=>(
                    <button type="button" key={option.key} aria-pressed={form.format===option.key}
                      onClick={()=>setForm(previous=>({...previous,format:option.key}))}
                      style={{minHeight:44,padding:'9px 12px',borderRadius:7,cursor:'pointer',fontSize:12,
                        border:form.format===option.key?'1px solid var(--gold)':'1px solid var(--border-sub)',
                        color:form.format===option.key?'var(--gold)':'var(--muted)',background:'var(--bg3)'}}>
                      {option.label}
                    </button>
                  ))}
                </div>
                {form.format!=='cash'&&<p style={{fontSize:12,color:'var(--muted)',marginTop:8}}>
                  PKR will prepare editable blind levels and a tournament timer. Players must record their buy-ins before tournament start.
                </p>}
              </div>
              {form.format!=='cash'&&<div>
                <label className="lbl" htmlFor="pkr-create-starting-chips" style={{display:'block',marginBottom:6}}>Starting chips per player</label>
                <input id="pkr-create-starting-chips" className="inp" type="number" min="100" max="1000000000" step="100"
                  value={form.starting_chips||'10000'}
                  onChange={e=>setForm(previous=>({...previous,starting_chips:e.target.value}))}/>
              </div>}
              <div>
                <div className="lbl" style={{marginBottom:8}}>Seats</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {['6','7','8','9','10','11','12','13','14','15'].map(n=>(
                    <button type="button" key={n} aria-pressed={form.seats===n} onClick={()=>setForm(f=>({...f,seats:n}))}
                      style={{padding:'7px 14px',borderRadius:2,cursor:'pointer',fontSize:13,fontWeight:500,
                        background:form.seats===n?'var(--gold)':'var(--bg3)',color:form.seats===n?'#0e0e0f':'var(--muted)',
                        border:form.seats===n?'1px solid var(--gold)':'1px solid var(--border-sub)',fontFamily:'var(--font-body),sans-serif'}}>{n}</button>
                  ))}
                </div>
              </div>
              <details className="pkr-create-game-details">
                <summary>
                  <strong>Arrival time options</strong>
                  <span>{arrivalTimes.length} time choices · tap to customise</span>
                </summary>
                <div className="pkr-create-game-details-body">
              <div>
                <div className="lbl" style={{marginBottom:8}}>RSVP arrival times *</div>
                <p style={{color:'var(--muted)',fontSize:12,marginBottom:10,lineHeight:1.5}}>
                  Players choose one of these arrival times, Running late or Not coming. Their seat reservations appear on the live RSVP board.
                </p>
                <div style={{display:'grid',gap:8}}>
                  {arrivalTimes.map((time,index)=>(
                    <div key={index} style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                      <input className="inp" type="time" aria-label={'RSVP arrival time '+(index+1)}
                        value={time} style={{minWidth:0,flex:1}}
                        onChange={e=>setArrivalTimes(previous=>previous.map((t,i)=>i===index?e.target.value:t))}/>
                      <button className="btn btn-ghost" type="button" disabled={arrivalTimes.length<=1}
                        aria-label={'Remove RSVP time '+(index+1)} style={{minWidth:44,minHeight:44}}
                        onClick={()=>setArrivalTimes(previous=>previous.filter((_,i)=>i!==index))}>×</button>
                    </div>
                  ))}
                </div>
                <button className="btn btn-outline" type="button" style={{marginTop:10,minHeight:44}}
                  disabled={arrivalTimes.length>=8} onClick={()=>{
                    const used=new Set(arrivalTimes);
                    for(let hour=17;hour<24;hour++){
                      for(const minute of ['00','30']){
                        const next=String(hour).padStart(2,'0')+':'+minute;
                        if(!used.has(next)){setArrivalTimes(previous=>[...previous,next]);return;}
                      }
                    }
                  }}>+ Add arrival time</button>
              </div>
                </div>
              </details>
              <details className="pkr-create-game-details">
                <summary><strong>More game settings</strong><span>Password, notes and repeating games</span></summary>
                <div className="pkr-create-game-details-body">
              <div>
                <div className="lbl" style={{marginBottom:6}}>Game Password</div>
                <input className="inp" placeholder="Optional" value={form.game_password} onChange={e=>setForm(f=>({...f,game_password:e.target.value}))}/>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:6}}>Notes</div>
                <input className="inp" placeholder="Optional" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/>
              </div>
              <div>
                <div className="lbl" style={{marginBottom:8}}>Repeat</div>
                <div style={{display:'flex',gap:6}}>
                  {(['none','weekly','fortnightly']).map(r=>(
                    <button type="button" key={r} aria-pressed={form.repeat===r} onClick={()=>setForm(f=>({...f,repeat:r}))}
                      style={{padding:'7px 14px',borderRadius:2,cursor:'pointer',fontSize:12,fontWeight:500,
                        background:form.repeat===r?'var(--gold)':'var(--bg3)',color:form.repeat===r?'#0e0e0f':'var(--muted)',
                        border:form.repeat===r?'1px solid var(--gold)':'1px solid var(--border-sub)',fontFamily:'var(--font-body),sans-serif'}}>
                      {r==='none'?'Once':r==='weekly'?'Weekly':'Fortnightly'}
                    </button>
                  ))}
                </div>
              </div>
                </div>
              </details>
            </div>
            <p className="pkr-unfinished-note" style={{marginTop:12}}>
              Repeating schedules create four weekly or fortnightly games. Tournament formats include editable blinds and chip stacks;
              open the game after scheduling to confirm RSVP arrival times and send invitations.
            </p>
            <div style={{display:'flex',gap:8,marginTop:20}}>
              <button className="btn btn-primary" style={{flex:1}} disabled={!form.scheduled_at||saving} onClick={createGame}>
                {saving?'Scheduling…':form.repeat==='none'?'Schedule & Notify':'Schedule 4 Games & Notify'}
              </button>
              <button className="btn btn-ghost" onClick={()=>setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        </AppDialog>
      )}

      {/* Invite modal */}
      {showInvite && (
        <AppDialog className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowInvite(false);}}>
          <div className="modal-sheet">
            <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:6,fontWeight:500}}>{inviteRole==='member'?'Member Invite':'Co-host Invite'}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginBottom:16,fontFamily:'var(--font-body),sans-serif'}}>For {inviteEmail} only · single-use · expires in 48 hours. Send through WhatsApp or email; only the invited account can accept.</div>
            {/* QR Code */}
            <div style={{display:'flex',justifyContent:'center',marginBottom:16}}>
              <div style={{background:'#fff',padding:12,borderRadius:4,display:'inline-block'}}
                ref={(el)=>{
                  if(!el||!inviteUrl) return;
                  el.innerHTML='';
                  if((window as any).QRCode) {
                    new (window as any).QRCode(el,{text:inviteUrl,width:160,height:160,colorDark:'#000',colorLight:'#fff',correctLevel:(window as any).QRCode.CorrectLevel.M});
                  }
                }}>
              </div>
            </div>
            <div style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:2,padding:'10px 14px',fontSize:11,color:'var(--ivory)',wordBreak:'break-all',marginBottom:16,fontFamily:'monospace',textAlign:'center'}}>
              {inviteUrl}
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={()=>navigator.clipboard.writeText(inviteUrl).then(()=>alert('Copied!'))}>📋 Copy Link</button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`Join me on PKR: ${inviteUrl}`)}`}
                target="_blank" rel="noopener noreferrer" className="btn btn-outline"
                style={{flex:1,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center'}}>📱 WhatsApp</a>
            </div>
            <button className="btn btn-ghost" style={{width:'100%',marginTop:8}} onClick={()=>setShowInvite(false)}>Close</button>
          </div>
        </AppDialog>
      )}

      {/* Install / Share modal */}
      {showInstall && (
        <AppDialog className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowInstall(false);}}>
          <div className="modal-sheet">
            <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:4,fontWeight:500}}>Share PKR</div>
            <div style={{fontSize:12,color:'var(--muted)',marginBottom:20,fontFamily:'var(--font-body),sans-serif'}}>{event.name}</div>

            {/* Install link */}
            <div style={{marginBottom:16,padding:'14px',background:'rgba(0,255,136,0.04)',border:'1px solid rgba(0,255,136,0.15)',borderRadius:4}}>
              <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--green)',marginBottom:6,fontFamily:'var(--font-body),sans-serif',fontWeight:600,textTransform:'uppercase'}}>📲 Player Install Link</div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:10,fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
                Send to new players so they can install PKR and get push notifications for every game.
              </div>
              <div style={{background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:2,padding:'10px 12px',fontSize:10,color:'var(--ivory)',wordBreak:'break-all',marginBottom:8,fontFamily:'monospace'}}>{installLink}</div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn btn-outline" style={{flex:1,fontSize:11,borderColor:'rgba(0,255,136,0.3)',color:'var(--green)'}}
                  onClick={()=>navigator.clipboard.writeText(installLink).then(()=>alert('Install link copied!'))}>Copy</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Install PKR and join ${event.name}: ${installLink}`)}`}
                  target="_blank" rel="noopener noreferrer" className="btn btn-ghost"
                  style={{flex:1,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>📱 WhatsApp</a>
              </div>
            </div>

            {/* Push toggle */}
            {canUsePush() && (
              <div style={{padding:'12px 14px',background:'var(--bg3)',border:'1px solid var(--border-sub)',borderRadius:4,marginBottom:14}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                  <div>
                    <div style={{fontSize:12,color:'var(--ivory)',fontFamily:'var(--font-body),sans-serif',fontWeight:500}}>🔔 Your Notifications</div>
                    <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',marginTop:2}}>
                      {pushEnabled ? 'ON — get alerts for games, results & buy-ins.' : 'OFF — enable to stay in the loop.'}
                    </div>
                  </div>
                  <button onClick={togglePush} disabled={pushLoading}
                    style={{padding:'7px 14px',borderRadius:2,cursor:'pointer',fontSize:12,fontWeight:600,
                      background:pushEnabled?'rgba(255,60,60,0.1)':'var(--gold)',color:pushEnabled?'var(--red)':'#000',
                      border:`1px solid ${pushEnabled?'rgba(255,60,60,0.3)':'var(--gold)'}`,
                      fontFamily:'var(--font-body),sans-serif',opacity:pushLoading?0.6:1,whiteSpace:'nowrap'}}>
                    {pushLoading ? '…' : pushEnabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            )}

            {!isPWA && iosDevice && safariOnly && (
              <div style={{padding:'10px 14px',background:'rgba(201,168,76,0.06)',border:'1px solid rgba(201,168,76,0.2)',borderRadius:4,marginBottom:14}}>
                <div style={{fontSize:11,color:'var(--gold)',fontFamily:'var(--font-body),sans-serif',fontWeight:500,marginBottom:4}}>📱 iPhone: Add to Home Screen</div>
                <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif',lineHeight:1.6}}>
                  Tap <strong style={{color:'var(--ivory)'}}>Share ↑</strong> → <strong style={{color:'var(--ivory)'}}>Add to Home Screen</strong> to install PKR as a native app.
                </div>
              </div>
            )}

            <button className="btn btn-ghost" style={{width:'100%'}} onClick={()=>setShowInstall(false)}>Close</button>
          </div>
        </AppDialog>
      )}

      <PkrMobileNav items={[
        {id:'games',label:'Games',icon:'games',active:tab==='games',onSelect:()=>selectTab('games')},
        {id:'standings',label:'Standings',icon:'standings',active:tab==='leaderboard',onSelect:()=>selectTab('leaderboard')},
        {id:'history',label:'History',icon:'history',active:tab==='history',onSelect:()=>selectTab('history')},
        {id:'members',label:'Members',icon:'members',active:tab==='members',onSelect:()=>selectTab('members')}
      ]} />

      {tab==='members'&&editingRoomProfile&&<AppDialog className="modal-overlay pkr-player-profile-overlay"
        onClick={event=>{if(event.currentTarget===event.target)setEditingRoomProfile(null);}}>
        <div className="pkr-player-profile-sheet" onClick={event=>event.stopPropagation()}>
          <RoomPlayerProfileEditor key={editingRoomProfile.key}
            profileKey={editingRoomProfile.key} canonicalName={editingRoomProfile.name}
            avatarFallback={editingRoomProfile.avatarUrl} initial={roomProfiles[editingRoomProfile.key]||null}
            canEdit={!roomProfileError&&(isHost||editingRoomProfile.key==='member:'+user?.id)}
            canManage={isHost} onClose={()=>setEditingRoomProfile(null)} onSave={saveRoomProfile}/>
        </div>
      </AppDialog>}
      {/* Standings player profile. Both podium and list buttons select this same dialog. */}
      {tab==='leaderboard' && selectedPlayer && (
        <PlayerHistoryDialog
          player={selectedPlayer}
          history={history}
          leader={leaders.find((p:any)=>p.display_name===selectedPlayer)}
          onClose={()=>setSelectedPlayer(null)}
        />
      )}

      {/* ── Quick Seat Modal (#13) ── */}
      {showQuickSeat && quickSeatGameId && (
        <QuickSeatModal
          gameId={quickSeatGameId}
          onClose={()=>setShowQuickSeat(false)}
          onSeated={()=>{ setShowQuickSeat(false); api.games.list(id).then(setGames); }}
        />
      )}
    </div>
  );
}

// ─── Quick Seat Modal ────────────────────────────────────────────────────────
function QuickSeatModal({ gameId, onClose, onSeated }: { gameId:string; onClose:()=>void; onSeated:()=>void }) {
  const [name, setName] = useState('');
  const [wa, setWa]     = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState(null as any);
  const [removingMember, setRemovingMember] = useState(false);
  const [seated, setSeated] = useState([] as any[]);

  async function seat() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.games.seat(gameId, { display_name: name.trim(), whatsapp: wa || undefined });
      setSeated(s => [...s, name.trim()]);
      setName(''); setWa('');
    } catch(e:any) { alert(e.message); }
    finally { setSaving(false); }
  }

  return (
    <AppDialog className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal-sheet">
        <div className="display" style={{fontSize:18,color:'var(--white)',marginBottom:4,fontWeight:500}}>⚡ Quick Seat Players</div>
        <div style={{fontSize:12,color:'var(--muted)',marginBottom:18,fontFamily:'var(--font-body),sans-serif'}}>Add players before launching the table</div>

        {seated.length > 0 && (
          <div style={{marginBottom:14,display:'flex',flexWrap:'wrap',gap:6}}>
            {seated.map((n,i) => (
              <span key={i} style={{padding:'4px 10px',background:'rgba(76,175,125,0.1)',border:'1px solid rgba(76,175,125,0.25)',borderRadius:2,fontSize:11,color:'var(--green)',fontFamily:'var(--font-body),sans-serif'}}>
                ✓ {n}
              </span>
            ))}
          </div>
        )}

        <div style={{display:'grid',gap:10,marginBottom:14}}>
          <div>
            <div className="lbl" style={{marginBottom:5}}>Name *</div>
            <input className="inp" placeholder="Player name" value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&seat()} autoFocus/>
          </div>
          <div>
            <div className="lbl" style={{marginBottom:5}}>WhatsApp (optional)</div>
            <input className="inp" placeholder="+61 400 000 000" type="tel" value={wa} onChange={e=>setWa(e.target.value)}/>
          </div>
        </div>

        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-primary" style={{flex:1}} disabled={!name.trim()||saving} onClick={seat}>
            {saving ? 'Seating…' : '+ Seat Player'}
          </button>
          <button className="btn btn-ghost" onClick={()=>{ onSeated(); }}>
            {seated.length > 0 ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </AppDialog>
  );
}

// ─── Game Card with RSVP count + push + links ───
function GameCard({game,appUrl,eventName,isHost,canDelete,onClick,onOpenTable,onWatchLive,onQuickSeat,onCancel,onDelete,onInviteMembers}:any) {
  const lobbyUrl = `${appUrl}/games/${game.id}/rsvp`;
  const rsvpUrl = `${appUrl}/games/${game.id}/rsvp`;
  const liveUrl  = game.live_token ? `${appUrl}/games/live/${game.live_token}` : '';
  const isLive = isLiveGame(game);
  const isUnfinished = isUnfinishedGame(game);
  const statusBg:Record<string,string> = {
    scheduled:'rgba(201,168,76,0.08)', active:'rgba(0,255,136,0.08)',
    lobby:'rgba(201,168,76,0.12)', settled:'transparent',
  };
  const statusDot:Record<string,string> = {
    scheduled:'var(--amber)', active:'var(--green)', lobby:'var(--gold)', settled:'var(--muted)',
  };
  return (
    <div className={"card pkr-game-card " + (isLive ? "is-live" : "")} style={{marginBottom:8,background:statusBg[game.status]||'transparent'}}>
      <div role="button" tabIndex={0} aria-label={'Open game ' + fmtDate(game.scheduled_at)}
          style={{padding:'18px 20px',display:'flex',alignItems:'flex-start',gap:14,cursor:'pointer'}}
          onClick={onClick} onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick();}}}>
        <div style={{flex:1,minWidth:0}}>
          {isLive && <div className="pkr-live-chip" aria-label="Game currently live"><span className="pkr-live-dot" />LIVE NOW</div>}
          {isUnfinished && <div className="pkr-unfinished-label">{gameStatusLabel(game)} · review</div>}
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            {!isLive && <div style={{width:7,height:7,borderRadius:'50%',background:statusDot[game.status]||'var(--faint)',flexShrink:0}}/>}
            <div style={{fontSize:15,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500}}>{fmtDate(game.scheduled_at)}</div>
          </div>
          {game.location && <div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>📍 {game.location}</div>}
          {game.notes && <div style={{fontSize:11,color:'var(--faint)',fontStyle:'italic'}}>{game.notes}</div>}
          {(game as any).format && (game as any).format !== 'cash' && (
            <span style={{display:'inline-block',marginTop:4,padding:'2px 8px',borderRadius:2,fontSize:10,fontWeight:500,
              letterSpacing:'0.1em',textTransform:'uppercase',fontFamily:'var(--font-body),sans-serif',
              background:'rgba(201,168,76,0.08)',border:'1px solid rgba(201,168,76,0.2)',color:'var(--gold)'}}>
              {String(({tournament:'🏆 Tournament',rebuy:'♻️ Rebuy',freezeout:'❄️ Freezeout'} as {[k:string]:string})[(game as any).format] || (game as any).format)}
            </span>
          )}
          <div style={{display:'flex',gap:8,marginTop:6,alignItems:'center'}}>
            <span className={`badge badge-${isUnfinished?'settled':game.status}`}>{gameStatusLabel(game)}</span>
            <span style={{fontSize:10,color:'var(--faint)',fontFamily:'var(--font-body),sans-serif'}}>
              {typeof game.player_count === 'number' ? `${game.player_count} players · ` : ''}{game.seats||9} seats
            </span>
          </div>
        </div>
        <span style={{color:'var(--faint)',fontSize:16,marginTop:2}}>›</span>
      </div>
      {/* Quick share row */}
      {(game.status==='scheduled'||game.status==='lobby'||game.status==='active') && (
        <div className="pkr-game-actions" style={{borderTop:'1px solid var(--border-sub)',padding:'8px 14px',display:'flex',gap:6,flexWrap:'wrap'}}>
          {isLive && isHost ? (
            <button type="button" className="btn btn-primary pkr-open-table" onClick={(e)=>{e.stopPropagation();onOpenTable();}}>
              ▶ Open Table
            </button>
          ) : isLive && liveUrl ? (
            <button type="button" className="btn btn-primary pkr-open-table" onClick={(e)=>{e.stopPropagation();onWatchLive();}}>
              ● Watch Live
            </button>
          ) : (
            <button type="button" className="btn btn-outline" onClick={(e)=>{e.stopPropagation();onClick();}}>
              Game details →
            </button>
          )}
          {isLive && (
            <button type="button" className="btn btn-ghost" onClick={(e)=>{e.stopPropagation();onClick();}}>
              Details
            </button>
          )}
          {isHost && (game.status==='scheduled'||game.status==='lobby') && (
            <button onClick={(e)=>{e.stopPropagation();onQuickSeat();}}
              className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px',color:'var(--gold)',borderColor:'rgba(201,168,76,0.3)'}}>
              ⚡ Quick Seat
            </button>
          )}
          {isHost && game.status==='scheduled' && (<>
            <button onClick={(e)=>{e.stopPropagation();onCancel();}}
              className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px',color:'var(--amber)',borderColor:'rgba(212,137,26,0.3)'}}>
              Cancel
            </button>
            {canDelete&&<button onClick={(e)=>{e.stopPropagation();onDelete();}}
              className="btn btn-danger" style={{fontSize:10,padding:'5px 10px'}}>
              Delete
            </button>}
          </>)}
          {isHost && <button type="button" onClick={e=>{e.stopPropagation();onInviteMembers();}}
            className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px'}}>
            📱 Invite approved group members
          </button>}
          {liveUrl && isLive && (
            <button onClick={(e)=>{e.stopPropagation();navigator.clipboard.writeText(liveUrl).then(()=>alert('Live link copied!'));}}
              className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px',color:'var(--green)'}}>
              📡 Live Link
            </button>
          )}
        </div>
      )}
    </div>
  );
}


/**
 * Standings detail is a dialog: a state update alone is not visible to the user.
 * Focus the close control, restore focus on dismissal and keep keyboard users inside.
 */
function PlayerHistoryDialog({ player, history, leader, onClose }: {
  player: string;
  history: any[];
  leader: any;
  onClose: () => void;
}) {
  const dialogRef=useRef<HTMLDivElement>(null);
  const onCloseRef=useRef(onClose);
  onCloseRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-pkr-player-close]')?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        onCloseRef.current();
      }else if(event.key==='Tab'){
        const target=dialogRef.current;
        const focusable=Array.from(target?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])'
        )||[]).filter(el=>el.getClientRects().length>0);
        if(!focusable.length)return;
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&(document.activeElement===first||!target?.contains(document.activeElement))){
          event.preventDefault();last.focus();
        }else if(!event.shiftKey&&(document.activeElement===last||!target?.contains(document.activeElement))){
          event.preventDefault();first.focus();
        }
      }
    };
    document.addEventListener('keydown',onKey);
    return ()=>{
      document.removeEventListener('keydown',onKey);
      document.body.style.overflow=previousOverflow;
      if(previous?.isConnected)previous.focus();
    };
  },[]);
  return (
    <AppDialog className="modal-overlay pkr-player-history-overlay"
      onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}} aria-label={'Player history for '+player}>
      <section ref={dialogRef} className="pkr-player-history-dialog"
          >
        <PlayerHistoryCard player={player} history={history} leader={leader} onClose={onClose}/>
      </section>
    </AppDialog>
  );
}

function PlayerHistoryCard({ player, history, leader, onClose }: {
  player: string;
  history: any[];
  leader: any;
  onClose: () => void;
}) {
  const router=useRouter();
  const playerGames = history.filter((g:any)=>
    (g.top_players||[]).some((p:any)=>p.display_name===player)
  ).sort((a:any,b:any)=>b.scheduled_at-a.scheduled_at);
  const nets=playerGames.map((g:any)=>(g.top_players||[]).find((p:any)=>p.display_name===player)?.net).filter((n:any)=>typeof n==='number') as number[];
  const positive=nets.filter(n=>n>0).length;
  const average=nets.length?Math.round(nets.reduce((a,b)=>a+b,0)/nets.length):0;
  return (
    <div style={{marginTop:12,background:'var(--bg2)',border:'1px solid var(--border-hi)',borderRadius:3,overflow:'hidden'}}>
      <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border-sub)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:14,color:'var(--white)',fontFamily:'var(--font-display),serif',fontWeight:500}}>{player}</div>
          {leader && (
            <div style={{fontSize:11,color:'var(--muted)',marginTop:2,fontFamily:'var(--font-body),sans-serif'}}>
              {leader.games_played} games · {leader.games_won} profitable games · total net <strong className={leader.total_net>0?'pkr-money-positive':leader.total_net<0?'pkr-money-negative':'pkr-money-neutral'}>{fmtSign(leader.total_net)}</strong>
            </div>
          )}
        </div>
        <button type="button" data-pkr-player-close aria-label="Close player history" onClick={onClose}
          style={{background:'none',border:'none',color:'var(--ivory)',fontSize:20,cursor:'pointer',padding:'8px 12px',borderRadius:8}}>✕</button>
      </div>
      {nets.length>0&&<div className="pkr-profile-stats">
        <div><small>Settled games</small><strong>{nets.length}</strong></div>
        <div><small>Profitable</small><strong>{positive} / {nets.length}</strong></div>
        <div><small>Average net</small><strong className={average>0?'pkr-money-positive':average<0?'pkr-money-negative':'pkr-money-neutral'}>{fmtSign(average)}</strong></div>
      </div>}
      {playerGames.length===0 && (
        <div style={{padding:'16px',fontSize:12,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>No settled game history for this player yet.</div>
      )}
      {playerGames.map((g:any)=>{
        const pp = (g.top_players||[]).find((p:any)=>p.display_name===player);
        const net = pp?.net ?? null;
        return (
          <button type="button" key={g.id}
            aria-label={'View saved game results for '+player+' on '+new Date(g.scheduled_at*1000).toLocaleDateString('en-AU')}
            onClick={()=>{onClose();router.push(g.results_token?'/games/results/'+encodeURIComponent(g.results_token):'/games/'+encodeURIComponent(g.id));}}
            style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',width:'100%',textAlign:'left',
              background:'transparent',border:0,color:'inherit',cursor:'pointer',minHeight:52,
              borderBottom:'1px solid var(--border-sub)'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:'var(--ivory)',fontFamily:'var(--font-body),sans-serif'}}>{new Date(g.scheduled_at*1000).toLocaleDateString('en-AU',{weekday:'short',month:'short',day:'numeric'})}</div>
              {g.location && <div style={{fontSize:10,color:'var(--faint)',marginTop:1}}>{g.location}</div>}
            </div>
            {net!==null && (
              <div style={{fontSize:15,fontWeight:600,fontFamily:'var(--font-num),monospace',
                color:net>0?'var(--green)':net<0?'var(--red)':'var(--muted)'}}>
                {fmtSign(net)}
              </div>
            )}
            <span aria-hidden="true" style={{fontSize:16,color:'var(--gold)'}}>›</span>
          </button>
        );
      })}
    </div>
  );
}

function Loader() {
  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="display" style={{fontSize:48,color:'var(--gold)',opacity:0.5}}>PKR</div>
    </div>
  );
}

