/* Server-rendered social preview uses the actual SVG marketing asset.
 * It keeps the same PKR crest and colour treatment as the website and app. */
import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const size={width:1200,height:630};
export const contentType='image/png';
export default async function Image(){
 const svg=await readFile(path.join(process.cwd(),'public','brand','pkr-social-landscape.svg'));
 const src='data:image/svg+xml;base64,'+svg.toString('base64');
 return new ImageResponse(<div style={{display:'flex',width:'100%',height:'100%'}}><img src={src} alt="PKR - More poker. Less admin." width={1200} height={630}/></div>,size);
}
