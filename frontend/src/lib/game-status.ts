/**
 * Presentation-only status rules. Never modifies saved game state or financial data.
 * A historical game with status='active' is unfinished, not proof that play is live.
 */
export type GameStatusFields = { status: string; scheduled_at: number };
const DAY = 24 * 60 * 60;

/** The UI should not present long-expired sessions as live or upcoming. */
export function isUnfinishedGame(game: GameStatusFields, now = Math.floor(Date.now() / 1000)): boolean {
  if (game.status === 'active') return game.scheduled_at < now - 2 * DAY;
  if (game.status === 'scheduled' || game.status === 'lobby') return game.scheduled_at < now - DAY;
  return false;
}

export function isLiveGame(game: GameStatusFields, now = Math.floor(Date.now() / 1000)): boolean {
  return game.status === 'active' && !isUnfinishedGame(game, now);
}

export function isCurrentGame(game: GameStatusFields, now = Math.floor(Date.now() / 1000)): boolean {
  return ['active', 'scheduled', 'lobby'].includes(game.status) && !isUnfinishedGame(game, now);
}

export function gameStatusLabel(game: GameStatusFields, now = Math.floor(Date.now() / 1000)): string {
  if (isUnfinishedGame(game, now)) return game.status === 'active' ? 'Unfinished' : 'Past due';
  if (game.status === 'active') return 'Live now';
  if (game.status === 'lobby') return 'Lobby open';
  if (game.status === 'scheduled') return 'Upcoming';
  if (game.status === 'settled') return 'Settled';
  if (game.status === 'cancelled') return 'Cancelled';
  return game.status;
}
