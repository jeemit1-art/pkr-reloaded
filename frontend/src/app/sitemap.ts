import type {MetadataRoute} from 'next';

const origin='https://mypkr.app';
const updated=new Date('2026-10-27T00:00:00+10:00');

export default function sitemap():MetadataRoute.Sitemap {
 return [
  {url:origin+'/',lastModified:updated,changeFrequency:'weekly',priority:1},
  {url:origin+'/pricing',lastModified:updated,changeFrequency:'monthly',priority:.9},
  {url:origin+'/home-poker-game-tracker',lastModified:updated,changeFrequency:'monthly',priority:.9},
  {url:origin+'/poker-tournament-manager',lastModified:updated,changeFrequency:'monthly',priority:.8},
  {url:origin+'/home-poker-settlement',lastModified:updated,changeFrequency:'monthly',priority:.8},
  {url:origin+'/install',lastModified:updated,changeFrequency:'monthly',priority:.6}
 ];
}
