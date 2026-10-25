import {describe,it,expect} from 'vitest';
import {corsHeaders} from './middleware';
const primary='https://mypkr.app';
const canonical='https://pkr-reloaded-git-codex-pkr-product-b49f4c-jeemit1-arts-projects.vercel.app';
const preview='https://pkr-reloaded-ohkeqniy8-jeemit1-arts-projects.vercel.app';
describe('isolated staging CORS',()=>{
  it('permits the exact production origin without opening preview hosts',()=>{
    expect(corsHeaders(primary,primary)['Access-Control-Allow-Origin']).toBe(primary);
    expect(corsHeaders(preview,primary)['Access-Control-Allow-Origin']).toBe(primary);
  });
  it('permits only PKR-owned preview domains for the staging Worker',()=>{
    expect(corsHeaders(preview,canonical,true)['Access-Control-Allow-Origin']).toBe(preview);
    expect(corsHeaders(canonical,canonical,true)['Access-Control-Allow-Origin']).toBe(canonical);
    expect(corsHeaders('https://pkr-reloaded-other.example.com',canonical,true)['Access-Control-Allow-Origin']).toBe(canonical);
    expect(corsHeaders('https://pkr-reloaded-evil-vercel.app',canonical,true)['Access-Control-Allow-Origin']).toBe(canonical);
    expect(corsHeaders('https://evil.example.com',canonical,true)['Access-Control-Allow-Origin']).toBe(canonical);
  });
});