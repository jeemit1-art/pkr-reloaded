// A deterministic release identity for both new and already-installed clients.
// Generated outputs never feed back into the hash; rebuilding unchanged sources
// must not advertise another update or replace any push-registration behaviour.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const generated=new Set([
  'src/lib/app-version.generated.json','public/app-version.json',
  'public/design-version.json','src/app/pkr-theme-a.css',
]);
const stamp=/^\/\/ PKR app release: [a-f0-9]{64}\r?\n/;
function unstampedWorker(source){return source.replace(stamp,'');}
function filesWithin(root,directory){
  const absolute=path.join(root,directory);
  if(!fs.existsSync(absolute))return [];
  return fs.readdirSync(absolute,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
    if(entry.name.startsWith('.'))return [];
    const relative=directory+'/'+entry.name;
    return entry.isDirectory()?filesWithin(root,relative):entry.isFile()?[relative]:[];
  });
}
function releaseVersion(root){
  const configuration=['package.json','package-lock.json','next.config.js','tsconfig.json',
    'tailwind.config.js','tailwind.config.ts','postcss.config.js'];
  const inputs=[...filesWithin(root,'src'),...filesWithin(root,'public'),...filesWithin(root,'scripts'),
    ...configuration.filter(file=>fs.existsSync(path.join(root,file)))].filter(file=>!generated.has(file)).sort();
  const hash=crypto.createHash('sha256');
  for(const file of inputs){
    let content=fs.readFileSync(path.join(root,file));
    if(file==='public/sw.js')content=Buffer.from(unstampedWorker(content.toString('utf8')));
    hash.update(file+'\0');hash.update(content);hash.update('\0');
  }
  return hash.digest('hex');
}
function writeChanged(file,content){
  if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===content)return;
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
}
function generate(root){
  const version=releaseVersion(root);
  const metadata=JSON.stringify({schema:1,version},null,2)+'\n';
  writeChanged(path.join(root,'src/lib/app-version.generated.json'),metadata);
  writeChanged(path.join(root,'public/app-version.json'),metadata);
  const workerPath=path.join(root,'public/sw.js');
  const worker=unstampedWorker(fs.readFileSync(workerPath,'utf8'));
  writeChanged(workerPath,'// PKR app release: '+version+'\n'+worker);
  return version;
}
if(require.main===module){
  const version=generate(path.resolve(__dirname,'..'));
  console.log('Prepared PKR app release: '+version.slice(0,12));
}
module.exports={generate,releaseVersion,unstampedWorker};
