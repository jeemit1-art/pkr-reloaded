/* One-time, syntax-aware source edit. Removed after verified source is committed. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const report={dialogs:0,metrics:0,files:[]};
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
function exact(file,from,to){const text=fs.readFileSync(file,'utf8');assert.equal(text.split(from).length-1,1,'Expected one source anchor: '+from.slice(0,90));fs.writeFileSync(file,text.replace(from,to));}
const layout=path.join(root,'src/app/layout.tsx');
exact(layout,"import type { Metadata } from 'next';","import type { Metadata, Viewport } from 'next';\nimport AppExperience from '@/components/AppExperience';");
exact(layout,'export const metadata = {',`export const viewport: Viewport = {
  width:'device-width', initialScale:1, viewportFit:'cover', themeColor:'#0B0F12', colorScheme:'dark',
};
export const metadata: Metadata = {
  applicationName:'PKR', manifest:'/manifest.json',
  appleWebApp:{capable:true,title:'PKR',statusBarStyle:'black-translucent'},
  icons:{icon:'/icon-192.png',apple:'/icon-192.png'},`);
exact(layout,'<body>','<body>\n        <AppExperience>');
exact(layout,'</body>','</AppExperience>\n      </body>');
exact(layout,'<html lang="en"','<html lang="en-AU"');
{
 const text=fs.readFileSync(layout,'utf8');
 const matches=[...text.matchAll(/<script dangerouslySetInnerHTML=\{\{__html:`[\s\S]*?`\}\}\s*\/>/g)].filter(match=>match[0].includes("serviceWorker.register('/sw.js')"));
 assert.equal(matches.length,1,'The existing service-worker registration must be removed exactly once');
 fs.writeFileSync(layout,text.replace(matches[0][0],''));
}
exact(path.join(root,'scripts/compile-theme-a.cjs'),"'pkr-theme-a-overlays.css'","'pkr-theme-a-overlays.css','pkr-app-experience.css'");
const board=path.join(root,'src/components/StandingsBoard.tsx');
exact(board,'type BoardProps={','type BoardProps={\n  roomId?:string;');
exact(board,'function StandingsBoard({leaders,settledGames,onSelectPlayer}:BoardProps)','function StandingsBoard({leaders,settledGames,onSelectPlayer,roomId}:BoardProps)');
const req=(kind,title,extra='')=>`{kind:'${kind}',title:${title}${extra?','+extra:''}}`;
const quote=value=>JSON.stringify(value);
const skip=new Set(['AppExperience.tsx','AppDialog.tsx','RecordMetric.tsx']);
for(const file of walk(path.join(root,'src')).filter(file=>file.endsWith('.tsx')&&!skip.has(path.basename(file)))){
 const source=fs.readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const rel=path.relative(root,file).replaceAll(path.sep,'/');
 const edits=[];let metrics=0,dialogs=0,needDialog=false;
 const changes=(start,end,text)=>edits.push({start,end,text});
 const attr=(node,name)=>node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(sf)===name);
 const classes=node=>{const value=attr(node,'className')?.initializer;return value&&ts.isStringLiteral(value)?value.text.split(/\s+/):[];};
 const has=(node,name)=>classes(node).includes(name);
 const direct=node=>node.children.filter(child=>ts.isJsxElement(child));
 function wrap(node,request){
   assert(!/<button\b|<RecordMetric\b/.test(source.slice(node.openingElement.end,node.closingElement.getStart(sf))),'Nested interactive metric: '+rel);
   changes(node.openingElement.end,node.openingElement.end,`<RecordMetric request={${request}}>`);
   changes(node.closingElement.getStart(sf),node.closingElement.getStart(sf),'</RecordMetric>');metrics++;
 }
 function rename(node,name,extra=''){
   changes(node.openingElement.tagName.getStart(sf),node.openingElement.tagName.end,name);
   changes(node.closingElement.tagName.getStart(sf),node.closingElement.tagName.end,name);
   if(extra)changes(node.openingElement.attributes.end,node.openingElement.attributes.end,' '+extra);
 }
 function bare(node,request){rename(node,'RecordMetric',`bare request={${request}}`);metrics++;}
 function metricChildren(node,requests){
   const children=direct(node).filter(child=>child.openingElement.tagName.getText(sf)==='div');
   assert.equal(children.length,requests.length,'Metric structure changed: '+rel+' '+classes(node.openingElement).join(' '));
   children.forEach((child,index)=>wrap(child,requests[index]));
 }
 function visit(node){
   if(ts.isJsxElement(node)){
     const open=node.openingElement,tag=open.tagName.getText(sf),text=node.getText(sf);
     if(tag==='div'&&has(open,'modal-overlay')){
       let innerDialog;
       const findInner=child=>{
         if(!innerDialog&&child!==node&&ts.isJsxElement(child)&&attr(child.openingElement,'role')?.initializer?.getText(sf)==='"dialog"')innerDialog=child;
         ts.forEachChild(child,findInner);
       };
       findInner(node);
       let labels='';
       if(innerDialog){
         for(const name of ['role','aria-modal','aria-label','aria-labelledby']){
           const a=attr(innerDialog.openingElement,name);
           if(a){if((name==='aria-label'||name==='aria-labelledby')&&!attr(open,name))labels+=' '+a.getText(sf);changes(a.getStart(sf),a.end,'');}
         }
       }
       rename(node,'AppDialog',labels.trim());needDialog=true;dialogs++;
     }
     else if(rel==='src/components/UpgradeModal.tsx'&&tag==='div'&&attr(open,'style')?.initializer?.getText(sf)==='{s.overlay}'){
       rename(node,'AppDialog','aria-label="Choose a PKR plan"');needDialog=true;dialogs++;
     }else if(rel==='src/app/dashboard/page.tsx'&&tag==='div'&&attr(open,'style')?.initializer?.getText(sf).includes("background:'rgba(0,0,0,0.92)'")){
       rename(node,'AppDialog','aria-label="Scan invite" onDismiss={()=>{setShowScanner(false);setScanning(false);}}');needDialog=true;dialogs++;
     }
     if(rel==='src/components/FinancialNotice.tsx'&&attr(open,'role')?.initializer?.getText(sf)==='"status"')changes(open.attributes.end,open.attributes.end,' className="pkr-financial-notice"');
     if(rel==='src/components/PersistentNavigation.tsx'&&has(open,'pkr-mobile-more-panel')){
       changes(open.getStart(sf),open.getStart(sf),'<AppDialog aria-label="More PKR navigation" onDismiss={()=>setMoreOpen(false)} onClick={event=>{if(event.target===event.currentTarget)setMoreOpen(false);}}>');
       changes(node.end,node.end,'</AppDialog>');needDialog=true;dialogs++;
       for(const name of ['role','aria-modal','aria-label']){const a=attr(open,name);if(a)changes(a.getStart(sf),a.end,'');}
     }
     if(rel==='src/app/dashboard/page.tsx'){
       if(has(open,'pkr-pro-stats'))metricChildren(node,[
         req('games',quote('Games recorded'),"roomId:featuredRoom?.id"),
         req('members',quote('Room members'),"roomId:featuredRoom?.id"),
         req('games',quote('Games across rooms')),
         `nextGame?${req('game',quote('Next game'),"gameId:nextGame.id")}:${req('games',quote('Upcoming games'),"roomId:featuredRoom?.id,filter:'upcoming'")}`,
       ]);
       if(has(open,'pkr-pro-member-stats'))metricChildren(node,[req('members',quote('Room members'),'roomId:featuredRoom?.id'),req('rooms',quote('Active rooms'))]);
     }
     if(rel==='src/app/insights/page.tsx'){
       if(has(open,'pkr-insights-kpis'))metricChildren(node,[
         req('games',quote('Games recorded'),'roomId:selected'),req('games',quote('Settled games'),"roomId:selected,filter:'settled'"),
         req('members',quote('Room members'),'roomId:selected'),
         `best?${req('player',"best.display_name+' - game results'",'roomId:selected,playerId:best.user_id,playerName:best.display_name')}:${req('leaders',quote('Player results'),'roomId:selected')}`,
         req('transfers',quote('Outstanding payments'),"roomId:selected,filter:'outstanding',period"),
       ]);
       if(has(open,'pkr-insights-balance-tiles'))metricChildren(node,['owing','receiving','paid','outstanding'].map((filter,i)=>req('transfers',quote(['Players who owe','Players to receive','Paid transfers','Outstanding transfers'][i]),`roomId:selected,filter:'${filter}',period`)));
       if(has(open,'pkr-insights-payment-summary'))metricChildren(node,['paid','outstanding','outstanding'].map((filter,i)=>req('transfers',quote(['Paid transfers','Outstanding transfers','Outstanding amount'][i]),`roomId:selected,filter:'${filter}',period`)));
       if(has(open,'pkr-vnext-bar-column'))bare(node,req('games',"'Settled games - '+month.label","roomId:selected,filter:'settled',month:month.key"));
       if(has(open,'pkr-vnext-bar-chart')){const role=attr(open,'role');if(role)changes(role.initializer.getStart(sf),role.initializer.end,'"group"');}
       if(has(open,'pkr-insights-balance-row'))bare(node,req('transfers',"p.name+' - outstanding transfers'","roomId:selected,filter:'outstanding',playerId:p.id,period"));
       if(has(open,'pkr-vnext-performance-row'))bare(node,req('player',"p.display_name+' - game results'",'roomId:selected,playerId:p.user_id,playerName:p.display_name'));
       if(has(open,'pkr-insights-player-mobile-row'))wrap(node,req('player',"p.display_name+' - game results'",'roomId:selected,playerId:p.user_id,playerName:p.display_name'));
       if(tag==='td'&&node.parent&&ts.isJsxElement(node.parent)&&attr(node.parent.openingElement,'key')?.initializer?.getText(sf)==='{p.user_id}'){
         wrap(node,req('player',"p.display_name+' - game results'",'roomId:selected,playerId:p.user_id,playerName:p.display_name'+(text.includes('{p.games_won}')?",filter:'profitable'":'')));
       }
     }
     if(rel==='src/app/events/[id]/page.tsx'&&has(open,'pkr-event-metrics'))metricChildren(node,[
       req('settings',quote('Default room buy-in'),'roomId:id'),req('games',quote('Games recorded'),'roomId:id'),req('members',quote('Room members'),'roomId:id'),
       `upcoming[0]?${req('game',quote('Next game'),'gameId:upcoming[0].id')}:${req('games',quote('Upcoming games'),"roomId:id,filter:'upcoming'")}`,
     ]);
     if(rel==='src/app/games/live/[token]/page.tsx'&&tag==='div'&&attr(open,'key')?.initializer?.getText(sf)==='{s.l}')wrap(node,
       "{kind:'live-money',title:s.l,publicToken:String(token),measure:s.l==='Buy-ins'?'buyins':s.l==='Cashouts'?'cashouts':'bank'}");
     if(rel==='src/app/games/[id]/page.tsx'){
       if(tag==='div'&&attr(open,'key')?.initializer?.getText(sf)==='{s.label}')wrap(node,"{kind:s.label==='Seats'?'seats':s.label==='Buy-in'?'game':s.label==='RSVPs'?'rsvps':'players',title:s.label,gameId:id,filter:s.label==='RSVPs'?'yes':'all'}");
       if(has(open,'pkr-player-activity'))metricChildren(node,['bought-in','cashed-out','all'].map((filter,i)=>req('players',quote(['Players bought in','Players cashed out','All game players'][i]),`gameId:id,filter:'${filter}'`)));
     }
     if(rel==='src/components/StandingsBoard.tsx'&&has(open,'pkr-standings-summary'))metricChildren(node,[
       req('leaders',quote('Ranked players'),'roomId'),req('games',quote('Settled games'),"roomId,filter:'settled'"),req('sessions',quote('Player sessions'),'roomId'),
     ]);
   }
   if(ts.isJsxSelfClosingElement(node)){
     if(rel==='src/app/events/[id]/page.tsx'&&node.tagName.getText(sf)==='StandingsBoard')changes(node.attributes.end,node.attributes.end,' roomId={id}');
     if(rel==='src/components/PersistentNavigation.tsx'&&has(node,'pkr-mobile-more-overlay'))changes(node.getStart(sf),node.end,'');
   }
   ts.forEachChild(node,visit);
 }
 visit(sf);
 if(metrics||needDialog){
   const imports=[metrics?"import RecordMetric from '@/components/RecordMetric';":'',needDialog?"import AppDialog from '@/components/AppDialog';":''].filter(Boolean).join('\n');
   const directive=sf.statements.find(statement=>ts.isExpressionStatement(statement)&&ts.isStringLiteral(statement.expression)&&statement.expression.text==='use client');
   assert(directive,'Client directive missing: '+rel);
   changes(directive.end,directive.end,'\n'+imports+'\n');
 }
 if(edits.length){
   edits.sort((a,b)=>b.start-a.start||b.end-a.end);
   let out=source,last=source.length;
   for(const edit of edits){assert(edit.end<=last,'Overlapping source edits in '+rel);out=out.slice(0,edit.start)+edit.text+out.slice(edit.end);last=edit.start;}
   const parsed=ts.createSourceFile(file,out,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
   assert.equal(parsed.parseDiagnostics.length,0,'Invalid TSX generated in '+rel+': '+parsed.parseDiagnostics.map(d=>d.messageText).join(';'));
   fs.writeFileSync(file,out);report.files.push({path:rel,metrics,dialogs});report.metrics+=metrics;report.dialogs+=dialogs;
 }
}
assert(report.metrics>=35,'Not all metric groups were wired');
assert(report.dialogs>=10,'Dialog audit found fewer action popups than expected');
for(const rel of ['src/app/dashboard/page.tsx','src/app/insights/page.tsx','src/app/events/[id]/page.tsx','src/app/games/[id]/page.tsx','src/components/StandingsBoard.tsx'])assert(report.files.some(file=>file.path===rel&&file.metrics>0),'Missing metric wiring: '+rel);
// This statistic is a count of saved game records, not only games that were played.
exact(path.join(root,'src/app/dashboard/page.tsx'),'<small>Games played</small>','<small>Games recorded</small>');
console.log(JSON.stringify(report,null,2));
