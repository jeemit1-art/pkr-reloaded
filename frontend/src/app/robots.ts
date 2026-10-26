import type {MetadataRoute} from 'next';

export default function robots():MetadataRoute.Robots {
 return {
  rules:[{
   userAgent:'*',
   allow:'/',
   disallow:['/dashboard','/events/','/games/','/insights','/schedule','/invite/','/phone-invite/','/mobile-login']
  }],
  sitemap:'https://mypkr.app/sitemap.xml',
  host:'https://mypkr.app'
 };
}
