'use client';

import {Suspense,useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import GameNightPayments from '@/components/GameNightPayments';
import {preservePageScrollForNavigation} from '@/lib/page-scroll';
import '../game-night-payments.css';

const LedgerAndTools=dynamic(()=>import('../insights/page'),{
 loading:()=> <main className="pkr-gn-payments"><p role="status">Loading the payment ledger…</p></main>,
});

export default function PaymentsPage(){
 return <Suspense fallback={<main className="pkr-gn-payments" aria-label="Payments"><p role="status">Loading payments…</p></main>}>
  <PaymentsWorkspace/>
 </Suspense>;
}

function PaymentsWorkspace(){
 const params=useSearchParams();
 const query=params.toString();
 const [settlementAnchor,setSettlementAnchor]=useState(false);
 useEffect(()=>{
  const update=()=>setSettlementAnchor(window.location.hash==='#pkr-settlement');
  update();window.addEventListener('hashchange',update);
  return()=>window.removeEventListener('hashchange',update);
 },[query]);
 const view=params.get('paymentsView');
 // Keep earlier direct links and the original settlement anchor operational.
 const tools=view==='ledger'||view==='classic'||view==='tools'||settlementAnchor&&view!=='overview';
 function sectionHref(section:'overview'|'ledger'){
  const next=new URLSearchParams(query);
  next.set('paymentsView',section);
  return '/payments?'+next.toString();
 }
 return <div className="pkr-gn-payment-workspace" data-payment-section={tools?'ledger':'overview'}>
  <nav className="pkr-gn-payment-sections" aria-label="Payment sections">
   <Link href={sectionHref('overview')} aria-current={!tools?'page':undefined} scroll={false}
     onNavigate={()=>preservePageScrollForNavigation(sectionHref('overview'))}><span>Overview</span></Link>
   <Link href={sectionHref('ledger')} aria-current={tools?'page':undefined} scroll={false}
     onNavigate={()=>preservePageScrollForNavigation(sectionHref('ledger'))}><span>Ledger &amp; tools</span></Link>
  </nav>
  {tools?<section className="pkr-gn-payment-ledger" aria-label="Payment ledger and tools"><LedgerAndTools/></section>:<GameNightPayments/>}
 </div>;
}
