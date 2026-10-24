#!/usr/bin/env node
// Parse shipped browser JavaScript without running it or touching production.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

const root = resolve(import.meta.dirname, '../..');
const files = [
  'frontend/public/hand-tracker.js',
  'frontend/public/tournament.js',
  'frontend/public/extras.js',
  'frontend/public/sw.js',
];
for (const file of files) {
  const code = readFileSync(resolve(root,file),'utf8');
  new Script(code,{filename:file});
  console.log('PASS browser JavaScript syntax: ' + file);
}

const playFile='frontend/src/app/games/[id]/play/page.tsx';
const page=readFileSync(resolve(root,playFile),'utf8');
const header='function getTableJS(gameId: string, router: any) {\n  return `';
const start=page.indexOf(header);
if(start<0)throw Error('Inline poker table script not found');
const ending='\n`;\n}';
const end=page.indexOf(ending,start+header.length);
if(end<0)throw Error('Inline poker table script terminator not found');
const inline=page.slice(start+header.length,end);
if(inline.includes('${'))throw Error('Unexpected live template interpolation in poker table source');
new Script(inline,{filename:playFile+'#game-table'});
console.log('PASS browser JavaScript syntax: '+playFile+' (embedded table runtime)');
