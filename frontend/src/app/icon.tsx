/* Brand icon generated from the exact approved vector mark, with no external assets. */
import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
export const size={width:512,height:512};
export const contentType='image/png';
export default async function Icon(){
 const icon=await readFile(path.join(process.cwd(),'public','brand','pkr-night-icon.svg'));
 const src='data:image/svg+xml;base64,'+icon.toString('base64');
 return new ImageResponse(<div style={{display:'flex',width:'512px',height:'512px',background:'#0B0D14'}}><img alt="PKR" src={src} width={512} height={512}/></div>,size);
}
