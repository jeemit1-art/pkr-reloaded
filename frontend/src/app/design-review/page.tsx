import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import DesignReviewClient from '@/components/DesignReviewClient';
import './design-review.css';

export const metadata:Metadata={
 title:'PKR Design Review — The Night Is On',
 description:'Fictional-data walkthrough of the approved PKR host and player screens.',
 robots:{index:false,follow:false},
};

export default function DesignReview(){
 // Never expose the fictional UI as a production route. No auth emulation
 // and no access to real rooms, members, wagers or payments.
 if(process.env.VERCEL_ENV==='production')notFound();
 return <DesignReviewClient/>;
}
