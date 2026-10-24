import { describe, expect, it } from 'vitest';
import { clientSafeEvent, clientSafeGame } from './public-data';

describe('client-facing response redaction', () => {
  it('never exposes event PIN hashes to group members', () => {
    const stored = { id:'evt', name:'Test', master_password:'sensitive-sha256-hash', member_count:2 };
    const result = clientSafeEvent(stored);
    expect(result).toEqual({ id:'evt', name:'Test', member_count:2 });
    expect(JSON.stringify(result)).not.toContain('sensitive-sha256-hash');
    expect(stored.master_password).toBe('sensitive-sha256-hash');
  });

  it('never exposes a plaintext game-start password', () => {
    const stored = { id:'game', event_id:'evt', game_password:'sensitive-shared-password', status:'scheduled' };
    const result = clientSafeGame(stored);
    expect(result).toEqual({ id:'game', event_id:'evt', status:'scheduled' });
    expect(JSON.stringify(result)).not.toContain('sensitive-shared-password');
    expect(stored.game_password).toBe('sensitive-shared-password');
  });

  it('preserves all ordinary event and game fields', () => {
    expect(clientSafeEvent({ id:'event', master_password:null, buy_in:2000, role:'host' }))
      .toEqual({ id:'event', buy_in:2000, role:'host' });
    expect(clientSafeGame({ id:'g', game_password:null, live_token:'public-live-token', scheduled_at:123 }))
      .toEqual({ id:'g', live_token:'public-live-token', scheduled_at:123 });
  });
});
