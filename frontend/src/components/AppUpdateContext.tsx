'use client';

import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {checkAppVersion,refreshAppSafely,refreshOutcomeMessage,RUNNING_APP_VERSION} from '@/lib/app-update';

type CheckStatus='idle'|'checking'|'current'|'available'|'unavailable';
type CheckState={status:CheckStatus;latestVersion:string|null;error:string};
type AppUpdateValue=CheckState&{
  runningVersion:string;updateReady:boolean;notice:string;
  checkForUpdates:()=>Promise<void>;refresh:()=>void;dismiss:()=>void;
};
export const AppUpdateContext=createContext<AppUpdateValue|null>(null);
export function useAppUpdate(){
  const value=useContext(AppUpdateContext);
  if(!value)throw new Error('PKR app updates require AppExperience.');
  return value;
}

export function useAppUpdateState(workerUpdateReady:boolean):AppUpdateValue{
  const [state,setState]=useState<CheckState>({status:'idle',latestVersion:null,error:''});
  const [dismissed,setDismissed]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const active=useRef<AbortController|null>(null);
  const inFlight=useRef<Promise<void>|null>(null);
  const lastCheck=useRef(0);
  const checkForUpdates=useCallback(()=>{
    if(inFlight.current)return inFlight.current;
    lastCheck.current=Date.now();setNotice('');
    if(!navigator.onLine){
      setState(previous=>({...previous,status:'unavailable',error:'You are offline. Connect to check for an app update.'}));
      return Promise.resolve();
    }
    const controller=new AbortController();active.current=controller;
    const timeout=window.setTimeout(()=>controller.abort(),8000);
    setState(previous=>({...previous,status:'checking',error:''}));
    const task=(async()=>{
      try{
        const result=await checkAppVersion(window.fetch.bind(window),controller.signal);
        if(active.current===controller)setState({status:result.updateAvailable?'available':'current',latestVersion:result.latestVersion,error:''});
      }catch{
        if(active.current===controller)setState(previous=>({...previous,status:'unavailable',
          error:'PKR could not verify the latest app version. Please try again.'}));
      }finally{
        window.clearTimeout(timeout);
        if(active.current===controller){active.current=null;inFlight.current=null;}
      }
    })();
    inFlight.current=task;return task;
  },[]);

  useEffect(()=>{
    const resume=()=>{
      if(document.visibilityState==='visible'&&navigator.onLine&&Date.now()-lastCheck.current>=300000)
        void checkForUpdates();
    };
    const online=()=>{if(document.visibilityState==='visible')void checkForUpdates();};
    void checkForUpdates();
    const interval=window.setInterval(resume,300000);
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);window.addEventListener('online',online);
    return()=>{
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange',resume);
      window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);window.removeEventListener('online',online);
      const controller=active.current;active.current=null;inFlight.current=null;controller?.abort();
    };
  },[checkForUpdates]);

  const refresh=useCallback(()=>{
    const runtime=window as Window&{pkrHasPendingActions?:()=>boolean};
    const outcome=refreshAppSafely({pathname:window.location.pathname,online:navigator.onLine,
      hasPendingActions:runtime.pkrHasPendingActions,
      confirm:message=>window.confirm(message),reload:()=>window.location.reload()});
    setNotice(refreshOutcomeMessage(outcome));
  },[]);
  const updateId=state.latestVersion&&state.latestVersion!==RUNNING_APP_VERSION?state.latestVersion:
    workerUpdateReady&&!state.latestVersion?'service-worker':null;
  const dismiss=useCallback(()=>setDismissed(updateId),[updateId]);
  return {...state,runningVersion:RUNNING_APP_VERSION,notice,
    updateReady:Boolean(updateId&&dismissed!==updateId),checkForUpdates,refresh,dismiss};
}
