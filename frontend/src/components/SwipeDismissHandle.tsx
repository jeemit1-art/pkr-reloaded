import './swipe-dismiss.css';

/** Visual hint only: accessible Close/Done buttons remain alongside the gesture. */
export default function SwipeDismissHandle(){
  return <div className="pkr-swipe-handle" aria-hidden="true" data-pkr-swipe-handle><span/></div>;
}
