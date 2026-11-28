import type {EventMember,LeaderboardEntry,RoomPlayerProfile} from './api';

/** Room-bound, display-only avatar lookup; never changes recorded player identity. */
export type RoomAvatarSources={
 members:ReadonlyArray<Pick<EventMember,'id'|'name'|'avatar_url'>>;
 profiles:ReadonlyArray<Pick<RoomPlayerProfile,'profile_key'|'screen_name'|'avatar_data'|'avatar_emoji'>>;
};
export type AvatarPlayer=Pick<LeaderboardEntry,'display_name'> &
 Partial<Pick<LeaderboardEntry,'user_id'|'identity_review_required'>>;
export type ResolvedPlayerAvatar={
 photo:string|null;emoji:string|null;initials:string;
 source:'profile-photo'|'profile-emoji'|'account-photo'|'initials';
};
export const EMPTY_ROOM_AVATARS:RoomAvatarSources={members:[],profiles:[]};
const nameKey=(name:string)=>String(name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-AU');
const initials=(name:string)=>{
 const parts=String(name||'').trim().split(/\s+/).filter(Boolean);
 return parts.slice(0,2).map(word=>Array.from(word)[0]?.toLocaleUpperCase('en-AU')||'').join('')||'♠';
};
function approvedPhoto(source:string|null|undefined):string|null{
 if(!source||typeof source!=='string'||source.length>200000)return null;
 // Profile uploads are small raster data URLs, never SVG/HTML or arbitrary schemes.
 if(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source))return source;
 if(source.startsWith('/')&&!source.startsWith('//')&&!source.includes('\\')&&!/[\x00-\x1F]/.test(source))return source;
 try{const url=new URL(source);return url.protocol==='https:'?source:null;}catch{return null}
}
export function resolveRoomPlayerAvatar(player:AvatarPlayer,sources:RoomAvatarSources):ResolvedPlayerAvatar{
 const fallback=initials(player.display_name);
 const requestedId=String(player.user_id||'');
 const directMember=requestedId?sources.members.find(m=>m.id===requestedId):undefined;
 const sameName=sources.members.filter(m=>nameKey(m.name)===nameKey(player.display_name));
 // Historical display names are not guaranteed identities. Only use a unique,
 // non-disputed name match when the game record has no matching member ID.
 const namedMember=!directMember&&!player.identity_review_required&&sameName.length===1?sameName[0]:undefined;
 const member=directMember||namedMember;
 const matchedByName=!directMember&&!player.identity_review_required&&sameName.length<=1;
 const historyKey='history:'+nameKey(player.display_name);
 const directProfile=member?sources.profiles.find(p=>p.profile_key==='member:'+member.id):undefined;
 const historicProfile=matchedByName?sources.profiles.find(p=>p.profile_key===historyKey):undefined;
 const profile=directProfile||historicProfile;
 const photo=approvedPhoto(profile?.avatar_data);
 if(photo)return{photo,emoji:null,initials:fallback,source:'profile-photo'};
 const emoji=profile?.avatar_emoji||null;
 if(emoji)return{photo:null,emoji,initials:fallback,source:'profile-emoji'};
 const account=approvedPhoto(member?.avatar_url);
 if(account)return{photo:account,emoji:null,initials:fallback,source:'account-photo'};
 return{photo:null,emoji:null,initials:fallback,source:'initials'};
}
