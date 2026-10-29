'use client';

import {useState,type ChangeEvent,type FormEvent} from 'react';
import type {RoomPlayerProfile,RoomPlayerProfileInput} from '@/lib/api';

const PRESETS=['♠️','♥️','♣️','♦️','🃏','😎','👑','🎲','🐯','🦊','🐻','🦁','🐼','🔥','⭐','🎯'];

async function reducePhoto(file:File):Promise<string>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)
    throw new Error('Choose a JPEG, PNG or WebP image smaller than 5 MB.');
  const url=URL.createObjectURL(file);
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('The selected image could not be opened.'));
      img.src=url;
    });
    const canvas=document.createElement('canvas'),size=128;
    canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Your device cannot prepare this photo.');
    ctx.fillStyle='#11332e';ctx.fillRect(0,0,size,size);
    const square=Math.min(image.naturalWidth,image.naturalHeight);
    ctx.drawImage(image,(image.naturalWidth-square)/2,(image.naturalHeight-square)/2,square,square,0,0,size,size);
    let data=canvas.toDataURL('image/jpeg',0.68);
    if(data.length>48000){
      canvas.width=96;canvas.height=96;
      const smaller=canvas.getContext('2d');
      if(!smaller)throw new Error('Photo conversion is unavailable.');
      smaller.fillStyle='#11332e';smaller.fillRect(0,0,96,96);
      smaller.drawImage(image,(image.naturalWidth-square)/2,(image.naturalHeight-square)/2,square,square,0,0,96,96);
      data=canvas.toDataURL('image/jpeg',0.57);
    }
    if(data.length>48000)throw new Error('This photo is too detailed. Choose a simpler image.');
    return data;
  }finally{URL.revokeObjectURL(url);}
}

type Props={
  profileKey:string;canonicalName:string;avatarFallback?:string|null;
  initial:RoomPlayerProfile|null;canEdit:boolean;canManage:boolean;
  onClose:()=>void;onSave:(value:RoomPlayerProfileInput)=>Promise<void>;
};

export default function RoomPlayerProfileEditor({profileKey,canonicalName,avatarFallback,initial,canEdit,canManage,onClose,onSave}:Props){
  const [screenName,setScreenName]=useState(initial?.screen_name||'');
  const [photo,setPhoto]=useState(initial?.avatar_data||'');
  const [emoji,setEmoji]=useState(initial?.avatar_emoji||'');
  const [phone,setPhone]=useState(initial?.phone||'');
  const [contact,setContact]=useState<RoomPlayerProfileInput['preferred_contact']>(initial?.preferred_contact||'none');
  const [notes,setNotes]=useState(initial?.private_notes||'');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const avatar=photo||(emoji?'':avatarFallback||'');
  async function choosePhoto(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];if(!file)return;
    setError('');
    try{const resized=await reducePhoto(file);setPhoto(resized);setEmoji('');}
    catch(e){setError(e instanceof Error?e.message:'Unable to read the selected photo.');}
    finally{event.target.value='';}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');
    if(!canEdit)return;
    const display=screenName.trim();
    if(display&&(display.length<2||display.length>40)){setError('Screen name must be 2–40 characters.');return;}
    setBusy(true);
    try{await onSave({
      profile_key:profileKey,screen_name:display||null,avatar_data:photo||null,
      avatar_emoji:emoji||null,phone:phone.trim()||null,
      preferred_contact:contact,private_notes:canManage?notes.trim()||null:null,
    });onClose();}
    catch(e){setError(e instanceof Error?e.message:'Unable to save this profile.');}
    finally{setBusy(false);}
  }
  return <form className="pkr-player-profile-editor" onSubmit={submit} aria-label={'Player profile for '+canonicalName}>
    <header className="pkr-player-profile-header">
      <div><span className="pkr-eyebrow">♠ PRIVATE ROOM PROFILE</span><h2>{canonicalName}</h2>
        <p>Display details for this poker room. Saved games and settled results keep their original player identity.</p></div>
      <button type="button" onClick={onClose} aria-label="Close player profile">✕</button>
    </header>
    <div className="pkr-player-profile-body">
      <section className="pkr-player-profile-picture">
        <div className="pkr-player-profile-avatar">
          {avatar?<img src={avatar} alt="" onError={e=>{e.currentTarget.style.display='none'}}/>:
            <span aria-hidden="true">{emoji||canonicalName.trim().charAt(0).toUpperCase()||'♠'}</span>}
        </div>
        <div className="pkr-player-profile-avatar-copy">
          <strong>Player avatar</strong>
          <small>Shown in the member list. Custom photos are reduced to a small image before saving.</small>
          {canEdit&&<label className="pkr-player-profile-upload">Upload photo
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} aria-label="Choose player avatar photo"/>
          </label>}
          {canEdit&&<button type="button" onClick={()=>{setPhoto('');setEmoji('')}} className="pkr-player-profile-reset">Use default avatar</button>}
        </div>
      </section>
      <div className="pkr-player-profile-presets" aria-label="Preset avatars">
        {PRESETS.map(value=><button type="button" key={value} disabled={!canEdit} onClick={()=>{setEmoji(value);setPhoto('')}}
          aria-label={'Choose '+value+' avatar'} aria-pressed={!photo&&emoji===value}>{value}</button>)}
      </div>
      <label className="pkr-player-profile-field">Screen name
        <input type="text" autoComplete="nickname" maxLength={40} disabled={!canEdit} value={screenName}
          placeholder={canonicalName} onChange={e=>setScreenName(e.target.value)}/>
        <small>For example, “King of Spades”. Your original name remains linked to past game results.</small>
      </label>
      <label className="pkr-player-profile-field">Mobile number <span>(private)</span>
        <input type="tel" autoComplete="tel" maxLength={24} disabled={!canEdit} value={phone}
          placeholder="+61 4xx xxx xxx" onChange={e=>setPhone(e.target.value)}/>
        <small>Only room hosts/co-hosts and this member can view the stored number. This is not phone verification.</small>
      </label>
      <label className="pkr-player-profile-field">Preferred contact
        <select disabled={!canEdit} value={contact} onChange={e=>setContact(e.target.value as RoomPlayerProfileInput['preferred_contact'])}>
          <option value="none">Not specified</option><option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option><option value="email">Email</option>
        </select>
      </label>
      {canManage&&<label className="pkr-player-profile-field">Host notes <span>(not visible to members)</span>
        <textarea rows={3} maxLength={500} disabled={!canEdit} value={notes}
          placeholder="Optional player preferences or administrative notes" onChange={e=>setNotes(e.target.value)}/>
      </label>}
      {error&&<p role="alert" className="pkr-player-profile-error">{error}</p>}
    </div>
    <footer className="pkr-player-profile-footer">
      <button type="button" onClick={onClose}>Close</button>
      {canEdit&&<button type="submit" disabled={busy}>{busy?'Saving…':'Save profile'}</button>}
    </footer>
  </form>;
}
