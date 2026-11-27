import {HTTPException} from 'hono/http-exception';

/** All current call sites have mandatory named path segments. Hono 4.13
 * correctly types param() as possibly missing; never query D1 with undefined. */
export function requiredRouteParam(value:string|undefined):string{
  if(typeof value!=='string'||!value.length)throw new HTTPException(400,{message:'Missing required route parameter'});
  return value;
}
