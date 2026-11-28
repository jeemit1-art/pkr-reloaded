/* The approved brand asset is the sole source for share previews. No stock/abstract imagery. */
import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
export const size={width:1200,height:630};
export const contentType='image/png';
export default async function Image(){
 const svg=await readFile(path.join(process.cwd(),'public','brand','pkr-night-cover.svg'));
 const src='data:image/svg+xml;base64,'+svg.toString('base64');
 return new ImageResponse(<div style={{display:'flex',width:'100%',height:'100%',background:'#0B0D14'}}><img src={src} alt="PKR - The Night Is On" width={1200} height={630}/></div>,size);
}
