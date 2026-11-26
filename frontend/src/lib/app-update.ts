import release from './app-version.generated.json';

export const RUNNING_APP_VERSION=release.version;
export const APP_VERSION_URL='/app-version.json';
export const REFRESH_CONFIRMATION='Refresh PKR now? Unsaved form entries will be lost. Saved games and payment records are unchanged.';
export type AppVersionCheck={runningVersion:string;latestVersion:string;updateAvailable:boolean};

/** Public release metadata only: no account, room or game information is sent. */
export async function checkAppVersion(fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<AppVersionCheck>{
  const response=await fetcher(APP_VERSION_URL,{
    cache:'no-store',credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal,
  });
  if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))
    throw new Error('PKR could not verify the latest app version. Please try again.');
  const value:unknown=await response.json();
  if(!value||typeof value!=='object'||Array.isArray(value)||
    (value as {schema?:unknown}).schema!==1||
    typeof (value as {version?:unknown}).version!=='string'||
    !/^[a-f0-9]{64}$/.test((value as {version:string}).version))
    throw new Error('PKR could not verify the latest app version. Please try again.');
  const latestVersion=(value as {version:string}).version;
  return {runningVersion:RUNNING_APP_VERSION,latestVersion,updateAvailable:latestVersion!==RUNNING_APP_VERSION};
}

export type RefreshOutcome='refreshed'|'cancelled'|'live-game'|'offline'|'pending-actions'|'unverified';
type RefreshEnvironment={
  pathname:string;online:boolean;hasPendingActions?:()=>boolean;
  confirm:(message:string)=>boolean;reload:()=>void;
};

/** Called only by a user's refresh button; never by update detection. */
export function refreshAppSafely(environment:RefreshEnvironment):RefreshOutcome{
  if(/^\/games\/[^/]+\/(play|tv)\/?$/.test(environment.pathname))return 'live-game';
  if(!environment.online)return 'offline';
  try{if(environment.hasPendingActions?.())return 'pending-actions';}
  catch{return 'unverified';}
  if(!environment.confirm(REFRESH_CONFIRMATION))return 'cancelled';
  environment.reload();
  return 'refreshed';
}

export function refreshOutcomeMessage(outcome:RefreshOutcome):string{
  if(outcome==='live-game')return 'Finish or leave the live game before refreshing PKR.';
  if(outcome==='offline')return 'Connect to the internet before refreshing PKR.';
  if(outcome==='pending-actions')return 'Sync the pending game changes before refreshing PKR.';
  if(outcome==='unverified')return 'PKR could not verify pending game changes. Please try again before refreshing.';
  if(outcome==='cancelled')return 'Refresh cancelled. Your current session is still open.';
  return '';
}
