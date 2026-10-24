/**
 * Keep stored authentication material out of client responses.
 *
 * These helpers are used on *all* event and game API response paths, including
 * create/list/history endpoints. Authorized members do not need credential
 * hashes or shared game-start passwords.
 */
export function clientSafeEvent<T extends Record<string, any>>(event: T): Omit<T, 'master_password'> {
  const { master_password: _privateCredential, ...safe } = event;
  return safe;
}

export function clientSafeGame<T extends Record<string, any>>(game: T): Omit<T, 'game_password'> {
  const { game_password: _privateCredential, ...safe } = game;
  return safe;
}
