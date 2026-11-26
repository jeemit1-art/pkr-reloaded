// Synthetic release/state fixtures only. No browser or real service requests.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const ts=require('typescript');
const {generate,releaseVersion,unstampedWorker}=require('../scripts/generate-app-version.cjs');
const frontend=path.resolve(__dirname,'..');
const running='a'.repeat(64),newer='b'.repeat(64);

function loadTypeScript(relative,requireStub){
  const source=fs.readFileSync(path.join(frontend,relative),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
  const exposed={};new Function('exports','require',output)(exposed,requireStub);return exposed;
}
const update=loadTypeScript('src/lib/app-update.ts',name=>{
  assert.equal(name,'./app-version.generated.json');return {schema:1,version:running};
});

async function main(){
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pkr-release-test-'));
  const write=(file,value)=>{const absolute=path.join(temporary,file);fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,value);};
  const worker=unstampedWorker(fs.readFileSync(path.join(frontend,'public/sw.js'),'utf8'));
  try{
    write('src/app/page.tsx','export default function Page(){return null}\n');
    write('src/app/header.css','header { background: white; }\n');
    write('public/sw.js',worker);write('public/icon.svg','<svg/>');write('package.json','{}\n');
    const first=generate(temporary);
    assert.match(first,/^[a-f0-9]{64}$/);
    const originalGenerated=fs.readFileSync(path.join(temporary,'public/app-version.json'),'utf8');
    assert.equal(fs.readFileSync(path.join(temporary,'src/lib/app-version.generated.json'),'utf8'),originalGenerated);
    assert.equal(JSON.parse(originalGenerated).version,first);
    assert.equal(generate(temporary),first,'Unchanged rebuilds must not announce another release');
    assert.equal(fs.readFileSync(path.join(temporary,'public/app-version.json'),'utf8'),originalGenerated);
    assert.equal(unstampedWorker(fs.readFileSync(path.join(temporary,'public/sw.js'),'utf8')),worker,
      'Release stamping must preserve all existing worker/push behaviour');
    const firstStampedWorker=fs.readFileSync(path.join(temporary,'public/sw.js'),'utf8');
    write('src/app/page.tsx','export default function Page(){return "New interface"}\n');
    const javascriptRelease=generate(temporary);
    assert.notEqual(javascriptRelease,first,'JS-only changes must announce a release');
    assert.notEqual(fs.readFileSync(path.join(temporary,'public/sw.js'),'utf8'),firstStampedWorker,
      'Existing installed clients require byte-changed sw.js to discover this release');
    write('src/app/header.css','header { background: #fff; padding-top: 4px; }\n');
    const cssRelease=generate(temporary);
    assert.notEqual(cssRelease,javascriptRelease,'CSS-only changes must announce a release');
    write('public/icon.svg','<svg><path/></svg>');
    const assetRelease=generate(temporary);assert.notEqual(assetRelease,cssRelease);
    for(const file of ['.env.local','.git/HEAD','node_modules/example.js','.next/server/page.js',
      'tests/fixture.json','artifacts/test.png','src/.env.local','public/.env','src/lib/app-version.generated.json',
      'public/app-version.json','public/design-version.json','src/app/pkr-theme-a.css'])write(file,'excluded synthetic content');
    assert.equal(releaseVersion(temporary),assetRelease,'Secrets, build outputs and test fixtures are excluded');
    assert.equal(generate(temporary),assetRelease);
    assert.equal(generate(temporary),assetRelease,'Regeneration must remain stable after replacing generated files');
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}

  const journal={
    pkr_token:'synthetic-session-token',
    pkr_pending_v2_synthetic_game_synthetic_user:JSON.stringify([{id:'synthetic-operation',kind:'buyin',amount:2500}]),
    pkr_pending_conflict_v1_synthetic_game_synthetic_user:JSON.stringify({actionId:'synthetic-operation'}),
    pkrCtx:JSON.stringify({gameId:'synthetic-game',userId:'synthetic-user'}),
    pkr_push_opt_in:'synthetic-registration',
  };
  const before=JSON.stringify(journal);let reloads=0,confirmations=0,storageWrites=0;
  global.localStorage={getItem:key=>journal[key]??null,setItem:()=>{storageWrites++;},removeItem:()=>{storageWrites++;},clear:()=>{storageWrites++;}};
  global.window={location:{reload:()=>{reloads++;}}};
  const requests=[];
  const fetchVersion=value=>async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(value),{headers:{'content-type':'application/json; charset=utf-8'}});};
  assert.deepEqual(await update.checkAppVersion(fetchVersion({schema:1,version:running})),
    {runningVersion:running,latestVersion:running,updateAvailable:false});
  assert.deepEqual(await update.checkAppVersion(fetchVersion({schema:1,version:newer,ignored:'synthetic-private-field'})),
    {runningVersion:running,latestVersion:newer,updateAvailable:true});
  assert.equal(reloads,0,'Detecting a ready release must never reload the running app');
  for(const request of requests){
    assert.equal(request.url,'/app-version.json');assert.equal(request.options.cache,'no-store');
    assert.equal(request.options.credentials,'omit');assert.equal(request.options.redirect,'error');
    assert.deepEqual(request.options.headers,{Accept:'application/json'});
  }
  for(const value of [{schema:0,version:newer},{schema:1,version:'not-a-release'},[],null,{error:'synthetic failure'}])
    await assert.rejects(update.checkAppVersion(fetchVersion(value)),/could not verify/);
  await assert.rejects(update.checkAppVersion(async()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}})),/could not verify/);
  await assert.rejects(update.checkAppVersion(async()=>new Response(JSON.stringify({schema:1,version:newer}),{status:503,headers:{'content-type':'application/json'}})),/could not verify/);
  await assert.rejects(update.checkAppVersion(async()=>{throw new Error('Synthetic offline request');}),/Synthetic offline/);

  const environment={pathname:'/account',online:true,hasPendingActions:()=>false,
    confirm:message=>{confirmations++;assert.equal(message,update.REFRESH_CONFIRMATION);return false;},reload:()=>{reloads++;}};
  assert.equal(update.refreshAppSafely(environment),'cancelled');assert.equal(reloads,0);
  for(const pathname of ['/games/synthetic/play','/games/synthetic/tv/'])
    assert.equal(update.refreshAppSafely({...environment,pathname}),'live-game');
  assert.equal(update.refreshAppSafely({...environment,online:false}),'offline');
  assert.equal(update.refreshAppSafely({...environment,hasPendingActions:()=>true}),'pending-actions');
  assert.equal(update.refreshAppSafely({...environment,hasPendingActions:()=>{throw Error('Cannot verify');}}),'unverified');
  assert.equal(confirmations,1,'Blocked refreshes must not prompt or reload');assert.equal(reloads,0);
  assert.equal(update.refreshAppSafely({...environment,confirm:()=>true}),'refreshed');assert.equal(reloads,1);
  assert.equal(JSON.stringify(journal),before);assert.equal(storageWrites,0,'Refresh/detection must preserve journals, sign-in and push opt-ins');

  // The only worker release change is a comment. Existing activation and push
  // handlers remain, without cache deletion or subscription replacement.
  const events={};let skipped=0,claimed=0;
  const self={addEventListener:(name,handler)=>{events[name]=handler;},skipWaiting:()=>{skipped++;},clients:{claim:()=>{claimed++;return Promise.resolve();}}};
  vm.runInNewContext('// PKR app release: '+newer+'\n'+worker,{self});
  events.install();await events.activate({waitUntil:promise=>promise});
  assert.equal(skipped,1);assert.equal(claimed,1);assert.equal(typeof events.push,'function');assert.equal(typeof events.notificationclick,'function');
  assert.equal(events.fetch,undefined,'The release bridge must not introduce an offline page cache');

  // Diagnostics contain only layout facts. Forbidden state access throws, so a
  // future accidental URL/session/device-data read fails this test immediately.
  const display=loadTypeScript('src/lib/app-display-details.ts',name=>{
    assert.equal(name,'./app-update');return {RUNNING_APP_VERSION:running};
  });
  let appended=0,removed=0;
  const probe={style:{},setAttribute:(name,value)=>{assert.equal(name,'aria-hidden');assert.equal(value,'true');},remove:()=>{removed++;}};
  const root={kind:'root',scrollTop:0,classList:{contains:name=>{assert.equal(name,'pkr-contained-scroll');return true;}}};
  const body={kind:'body',scrollTop:280,clientHeight:844,scrollHeight:1800,
    getBoundingClientRect:()=>({top:0,bottom:844,height:844}),
    appendChild:node=>{assert.equal(node,probe);appended++;}};
  const header={textContent:'PRIVATE_DIAGNOSTIC_SENTINEL',getBoundingClientRect:()=>({top:0,right:390,bottom:123,left:0,width:390,height:123})};
  global.document={documentElement:root,scrollingElement:root,body,
    querySelector:selector=>{assert.equal(selector,'.pkr-primary-mobile-utility');return header;},
    createElement:tag=>{assert.equal(tag,'div');return probe;},
    get cookie(){throw Error('Diagnostics cannot read cookies');}};
  global.window={screen:{width:390,height:844},innerWidth:390,innerHeight:844,scrollY:0,
    visualViewport:{width:390,height:844,offsetTop:0,offsetLeft:0,scale:1},
    matchMedia:query=>{assert.equal(query,'(display-mode: standalone)');return {matches:true};},
    getComputedStyle:node=>node===probe?{paddingTop:'59px',paddingRight:'0px',paddingBottom:'34px',paddingLeft:'0px'}:
      node===header?{position:'fixed',paddingTop:'68px',opacity:'1',backgroundColor:'rgb(255, 255, 255)',display:'flex'}:
      {backgroundColor:'rgb(255, 255, 255)',overflowY:node===body?'auto':'hidden',position:node===body?'fixed':'static'},
    get location(){throw Error('Diagnostics cannot read URLs');},
    get localStorage(){throw Error('Diagnostics cannot read saved state');}};
  const previousNavigator=Object.getOwnPropertyDescriptor(global,'navigator');
  Object.defineProperty(global,'navigator',{configurable:true,value:{standalone:false,
    get userAgent(){throw Error('Diagnostics cannot read identifying browser data');}}});
  try{
    const details=display.collectDisplayDetails();
    assert.deepEqual(Object.keys(details),['appVersion','standalone','screen','innerViewport','visualViewport','canvas','header','safeArea','scrollSurface']);
    assert.equal(details.appVersion,running);assert.equal(details.standalone,true);
    assert.deepEqual(details.safeArea,{top:'59px',right:'0px',bottom:'34px',left:'0px'});
    assert.equal(details.header.rect.top,0);assert.equal(details.header.paddingTop,'68px');
    assert.equal(details.canvas.rootBackground,'rgb(255, 255, 255)');
    assert.deepEqual(details.scrollSurface,{mode:'contained-body',windowTop:0,documentTop:0,bodyTop:280,
      bodyHeight:844,bodyScrollHeight:1800,rootOverflowY:'hidden',bodyOverflowY:'auto',bodyPosition:'fixed',
      bodyBounds:{top:0,bottom:844,height:844}});
    assert(!JSON.stringify(details).includes('PRIVATE_DIAGNOSTIC_SENTINEL'));
    assert.equal(appended,1);assert.equal(removed,1,'The safe-area probe must leave no DOM residue');
  }finally{
    if(previousNavigator)Object.defineProperty(global,'navigator',previousNavigator);else delete global.navigator;
    delete global.document;
  }

  const config=require('../next.config.js');
  const headers=await config.headers();
  for(const endpoint of ['/app-version.json','/sw.js'])
    assert.equal(headers.find(row=>row.source===endpoint).headers.find(header=>header.key==='Cache-Control').value,'no-store, max-age=0');
  const scripts=JSON.parse(fs.readFileSync(path.join(frontend,'package.json'),'utf8')).scripts;
  for(const script of [scripts.predev,scripts.prebuild])assert(script.indexOf('compile-theme-a.cjs')<script.indexOf('generate-app-version.cjs'));
  delete global.localStorage;delete global.window;
  console.log('PASS: deterministic JS/CSS/asset release stamps, unchanged worker behaviour, validated non-cached update checks, voluntary safe refresh, unchanged private journals and display-only diagnostics.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
