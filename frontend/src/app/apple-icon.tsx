/* iOS Home Screen branding uses the same approved Open Chip K master. */
import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
export const size={width:180,height:180};
export const contentType='image/png';
export default async function AppleIcon(){
 const icon=await readFile(path.join(process.cwd(),'public','brand','pkr-night-icon.svg'));
 const src='data:image/svg+xml;base64,'+icon.toString('base64');
 return new ImageResponse(<div style={{display:'flex',width:'180px',height:'180px',background:'#0B0D14'}}><img alt="PKR" src={src} width={180} height={180}/></div>,size);
}
