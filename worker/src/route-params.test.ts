import {describe,it,expect} from 'vitest';
import {requiredRouteParam} from './route-params';
describe('required route parameter compatibility',()=>{
 it('preserves exact IDs, not an empty fallback',()=>{
  expect(requiredRouteParam('room-123')).toBe('room-123');
  expect(()=>requiredRouteParam(undefined)).toThrow('Missing required route parameter');
  expect(()=>requiredRouteParam('')).toThrow('Missing required route parameter');
 });
});
