'use client';

import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type ButtonHTMLAttributes} from 'react';
import {createPortal} from 'react-dom';
import {usePathname,useRouter} from 'next/navigation';
import {loadRecordDetail,type RecordDetail,type RecordRequest} from '@/lib/record-details';
import {lockPageScroll} from '@/lib/overlay-scroll';

const RecordContext=createContext<((request:RecordRequest)=>void)|null>(null);

export default function RecordMetric({request,children,className='',bare=false,...props}:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>,'onClick'>&{request:RecordRequest;children:ReactNode;bare?:boolean}){
  const open=useContext(RecordContext);
  return <button {...props} type="button" className={(bare?'pkr-record-action ':'pkr-metric-trigger ')+className}
    aria-label={'View underlying records: '+request.title}
    aria-haspopup="dialog" data-record-kind={request.kind}
    onClick={()=>open?.(request)}>{children}</button>;
}

export function RecordProvider({children}:{children:ReactNode}){
  const [requests,setRequests]=useState<RecordRequest[]>([]);
  const pathname=usePathname();
  const open=useCallback((request:RecordRequest)=>setRequests([request]),[]);
  const close=useCallback(()=>setRequests([]),[]);
  useEffect(()=>{close();},[pathname,close]);
  const current=requests[requests.length-1];
  return <RecordContext.Provider value={open}>
    {children}
    {current&&<RecordSheet request={current} canGoBack={requests.length>1} onClose={close}
      onBack={()=>setRequests(old=>old.slice(0,-1))} onNext={request=>setRequests(old=>[...old,request])}/>}
  </RecordContext.Provider>;
}

function RecordSheet({request,canGoBack,onClose,onBack,onNext}:{request:RecordRequest;canGoBack:boolean;
  onClose:()=>void;onBack:()=>void;onNext:(request:RecordRequest)=>void}){
  const router=useRouter();
  const dialog=useRef<HTMLDialogElement>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const [detail,setDetail]=useState<RecordDetail|null>(null);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(0);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const element=dialog.current;
    if(!element)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const unlock=lockPageScroll();
    element.showModal();heading.current?.focus();
    return()=>{element.close();unlock();if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    setDetail(null);setError('');setQuery('');setPage(0);
    void loadRecordDetail(request,controller.signal).then(result=>{
      if(!controller.signal.aborted)setDetail(result);
    }).catch(cause=>{
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Unable to load these records.');
    });
    return()=>controller.abort();
  },[request,retry]);
  const rows=useMemo(()=>{
    const text=query.trim().toLocaleLowerCase();
    return (detail?.rows||[]).filter(row=>!text||[row.label,row.detail,row.value].join(' ').toLocaleLowerCase().includes(text));
  },[detail,query]);
  const pageSize=40;
  const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
  const currentPage=Math.min(page,pageCount-1);
  if(typeof document==='undefined')return null;
  return createPortal(<dialog ref={dialog} className="pkr-record-dialog" aria-labelledby="pkr-record-title"
    onCancel={event=>{event.preventDefault();onClose();}}
    onClick={event=>{
      if(event.target!==event.currentTarget)return;
      const bounds=event.currentTarget.getBoundingClientRect();
      if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)onClose();
    }}>
    <header className="pkr-record-heading">
      <div><span>UNDERLYING RECORDS</span><h2 id="pkr-record-title" ref={heading} tabIndex={-1}>{request.title}</h2>
        {detail?.summary&&<p>{detail.summary}</p>}</div>
      <button type="button" onClick={onClose} aria-label="Close record details">Close</button>
    </header>
    <div className="pkr-record-body" aria-busy={!detail&&!error}>
      {!detail&&!error&&<p role="status" className="pkr-record-empty">Loading saved records...</p>}
      {error&&<div role="alert" className="pkr-record-error"><p>{error}</p><button type="button" onClick={()=>setRetry(n=>n+1)}>Try again</button></div>}
      {detail&&<>
        {detail.warning&&<p role="alert" className="pkr-record-error">{detail.warning}</p>}
        {detail.rows.length>5&&<label className="pkr-record-search">Find a record
          <input type="search" value={query} placeholder="Search names, games or amounts"
            onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label>}
        <div className="pkr-record-list">
          {rows.slice(currentPage*pageSize,(currentPage+1)*pageSize).map(row=>{
            const content=<><span><strong>{row.label}</strong>{row.detail&&<small>{row.detail}</small>}</span>
              {row.value&&<b>{row.value}</b>}{(row.href||row.next)&&<span aria-hidden="true">&rsaquo;</span>}</>;
            return row.href||row.next?<button type="button" className="pkr-record-row" key={row.id}
              onClick={()=>{if(row.next)onNext(row.next);else if(row.href){onClose();router.push(row.href);}}}>{content}</button>
              :<div className="pkr-record-row" key={row.id}>{content}</div>;
          })}
          {!rows.length&&<p className="pkr-record-empty">{query?'No records match your search.':'No matching records have been saved.'}</p>}
        </div>
        {pageCount>1&&<div className="pkr-record-pagination">
          <button type="button" disabled={currentPage===0} onClick={()=>setPage(n=>Math.max(0,n-1))}>Previous</button>
          <span>Page {currentPage+1} of {pageCount}</span>
          <button type="button" disabled={currentPage>=pageCount-1} onClick={()=>setPage(n=>n+1)}>Next</button>
        </div>}
      </>}
    </div>
    <footer className="pkr-record-footer">
      {canGoBack?<button type="button" onClick={onBack}>Back to breakdown</button>:<span>Saved records only. No payment is made here.</span>}
      <button type="button" onClick={onClose}>Done</button>
    </footer>
  </dialog>,document.body);
}
