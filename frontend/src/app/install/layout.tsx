import type {Metadata} from 'next';

export const metadata:Metadata={
 title:'Install PKR on iPhone, Android or Desktop — Home Poker Web App',
 description:'Use PKR for home poker games on your phone, tablet or computer. Learn to open and install the browser-based poker game manager on a supported device.',
 alternates:{canonical:'/install'},
 robots:{index:true,follow:true}
};

export default function InstallLayout({children}:{children:React.ReactNode}){
 return children;
}
