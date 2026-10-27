// Prepare real PKR UI screenshots from the synthetic-only browser test artifact.
// Never signs in to a real account, contacts production APIs, or uses client data.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const source = process.argv[2];
const output = path.resolve(__dirname,'../public/demo/theme-a');
if (!source || !fs.existsSync(source)) throw Error('Expected synthetic browser screenshots directory');
fs.mkdirSync(output,{recursive:true});

const entries = [
 ['desktop-live-table.png','live-table.webp','table'],
 ['desktop-dashboard.png','host-dashboard.webp','desktop'],
 ['desktop-room.png','room-and-standings.webp','desktop'],
 ['desktop-rsvp.png','rsvp-board.webp','desktop'],
 ['desktop-insights.png','insights.webp','desktop'],
 ['desktop-standings.png','standings.webp','desktop'],
 ['desktop-schedule.png','schedule.webp','desktop'],
 ['desktop-game-detail.png','game-detail.webp','desktop'],
 ['phone-dashboard.png','mobile-dashboard.webp','phone'],
 ['phone-live-table.png','mobile-live-table.webp','phone'],
 ['phone-rsvp.png','mobile-rsvp.webp','phone'],
 ['phone-insights.png','mobile-insights.webp','phone'],
 ['phone-standings.png','mobile-standings.webp','phone'],
];

async function run(){
 for(const [input,name,kind] of entries){
  const file=path.join(source,input);
  if(!fs.existsSync(file))throw Error('Missing required synthetic screenshot: '+input);
  const meta=await sharp(file).metadata();
  if(kind==='phone' && (meta.width!==390 || meta.height!==844))throw Error('Unexpected phone dimensions for '+input);
  if(kind!=='phone' && (meta.width!==1440 || meta.height!==900))throw Error('Unexpected desktop dimensions for '+input);
  const pipeline=sharp(file).removeAlpha();
  // Preserve the actual table and its seats; only the app chrome changes in source CSS.
  if(kind==='desktop')pipeline.extract({left:205,top:28,width:1225,height:845}).resize({width:1225});
  else if(kind==='table')pipeline.resize({width:1440});
  const out=path.join(output,name);
  await pipeline.webp({quality:84,effort:5}).toFile(out);
  const stat=fs.statSync(out);
  if(stat.size<10000 || stat.size>1200000)throw Error('Unexpected image size '+name+': '+stat.size);
  console.log(name+': '+(stat.size/1024).toFixed(0)+'KB');
 }
 const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/design-version.json'),'utf8'));
 manifest.sourceCommit=process.env.GITHUB_SHA||'local';
 manifest.sampleData=true;
 manifest.images=entries.map(([,name])=>name);
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(output,'README.md'), [
  '# PKR product screenshots',
  '',
  'These are real screenshots of the PKR application from the six-viewport Playwright suite.',
  'All players, rooms, balances, timestamps and games are synthetic fixtures.',
  '',
  '- Source: synthetic browser test capture produced on this design branch.',
  '- Screenshots reflect the current PKR interface including the refreshed design theme.',
  '- Label the screenshots as sample data wherever shown publicly.',
  '- Never replace them with client screenshots or private account data.',
  '- Sharp converts PNG captures to optimised WebP files and removes metadata.',
  ''
 ].join('\n'));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
