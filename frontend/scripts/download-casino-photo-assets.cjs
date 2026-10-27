/**
 * Download and optimise genuinely photographed poker props for PKR.
 *
 * Only execute in the isolated Classic Poker development branch. Source files
 * are Unsplash photos explicitly marked "Free to use under the Unsplash License".
 * Source IDs and URLs are pinned — no search API, scraper or wildcard domains.
 * Photos decorate management/marketing only; real game table is never replaced.
 */
const fs=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');

const destination=path.resolve(__dirname,'../public/images/casino');
const photos=[
 {
  name:'real-poker-chips.webp',
  id:'photo-1518133196839-3aa1219f671d',
  author:'Chris Liverani',
  source:'https://unsplash.com/photos/person-holding-playing-cards-beside-poker-chips-2y7yiuEgT3k',
  description:'Real poker chips stacked at a private poker table with a hand of cards',
  width:1500
 },
 {
  name:'real-casino-props.webp',
  id:'photo-1708919166614-60f3d21b4284',
  author:'James Nilsson',
  source:'https://unsplash.com/photos/playing-cards-and-dice-on-a-black-background-Ih32pz1tMis',
  description:'Actual playing cards, poker chips and dice on a black tabletop',
  width:1500
 },
 {
  name:'real-chip-closeup.webp',
  id:'photo-1518133120397-258d5eb470c6',
  author:'Chris Liverani',
  source:'https://unsplash.com/photos/closeup-photography-of-poker-chip-set-MJX7-BAdkt0',
  description:'Close-up photograph of a real set of poker chips',
  width:1350
 }
];

async function main(){
 if(process.env.GITHUB_REF && process.env.GITHUB_REF!=='refs/heads/design/pkr-classic-poker-20261027')
  throw Error('Refusing to write casino assets outside approved development branch');
 await fs.mkdir(destination,{recursive:true});
 for(const photo of photos){
  const u=new URL('https://images.unsplash.com/'+photo.id);
  u.search=new URLSearchParams({fit:'crop',fm:'jpg',q:'84',w:String(photo.width)}).toString();
  let body;
  for(let attempt=1;attempt<=3;attempt++){
   try{
    const response=await fetch(u,{signal:AbortSignal.timeout(30000),headers:{'accept':'image/jpeg'}});
    if(!response.ok||!(response.headers.get('content-type')||'').startsWith('image/')){
     throw Error('Unexpected photo response '+response.status+' '+response.headers.get('content-type'));
    }
    const length=Number(response.headers.get('content-length')||0);
    if(length>9_000_000)throw Error('Image exceeds 9MB source limit');
    body=Buffer.from(await response.arrayBuffer());
    if(body.length<18_000||body.length>9_000_000)throw Error('Invalid source image length '+body.length);
    break;
   }catch(e){
    if(attempt===3)throw Error('Could not retrieve licensed photo '+photo.name+': '+e.message);
    await new Promise(resolve=>setTimeout(resolve,attempt*1200));
   }
  }
  const img=sharp(body).rotate();
  const meta=await img.metadata();
  if(meta.width<750||meta.height<450)throw Error('Photograph too small: '+photo.name);
  const target=path.join(destination,photo.name);
  await img.resize({width:photo.width,withoutEnlargement:true}).webp({quality:83,effort:5}).toFile(target);
  const stat=await fs.stat(target);
  if(stat.size<25_000||stat.size>1_800_000)throw Error('Unusual optimised file size: '+photo.name+' '+stat.size);
  console.log(photo.name,meta.width+'x'+meta.height,Math.round(stat.size/1024)+'KB');
 }
 const readme=[
  '# PKR real casino photography',
  '',
  'These assets are photos of physical poker chips, playing cards and dice.',
  'They are **not** product screenshots and must not be represented as features of the PKR game engine.',
  '',
  'Each photo was labelled as free to use under the Unsplash License at the time of selection.',
  'License: https://unsplash.com/license (commercial use permitted; attribution appreciated).',
  '',
  ...photos.map(p=>'- **'+p.name+'** — '+p.description+'. Photo by '+p.author+'. '+p.source),
  '',
  'Optimised to WebP, served locally. Do not add visible casino betting claims.',
  'Photographs are decorative only and must never replace the approved live poker felt, seats, or controls.',
  ''
 ].join('\n');
 await fs.writeFile(path.join(destination,'README.md'),readme,'utf8');
}
main().catch(error=>{console.error(error);process.exitCode=1});
