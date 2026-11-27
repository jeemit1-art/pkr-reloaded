-- PKR owner-only financial EXCEPTION inventory, read-only.
-- Never returns player identifiers, names, games, contact details or transfer IDs.
-- A flagged row requires manual evidence review: this query never updates a record.
-- Amounts use integer cents. Legacy zero buy_in_total uses buy_ins * event.buy_in
-- as in the saved game's established effective buy-in calculation.
WITH settled_players AS (
 SELECT p.game_id,p.user_id,p.net,p.cashout,p.buy_ins,p.buy_in_total,
   CASE WHEN p.buy_in_total>0 THEN p.buy_in_total
     ELSE COALESCE(p.buy_ins,0)*COALESCE(e.buy_in,0) END AS effective_buyin
 FROM game_players p JOIN games g ON g.id=p.game_id
 JOIN events e ON e.id=g.event_id
 WHERE g.status='settled'
), settled_game_totals AS (
 SELECT g.id,COUNT(p.user_id) AS players,COALESCE(SUM(p.net),0) AS net_total,
   SUM(CASE WHEN p.user_id IS NOT NULL AND (p.cashout IS NULL OR p.net IS NULL) THEN 1 ELSE 0 END) AS incomplete
 FROM games g LEFT JOIN game_players p ON p.game_id=g.id
 WHERE g.status='settled' GROUP BY g.id
)
SELECT 'settled_player_records' AS metric, (SELECT COUNT(*) FROM settled_players) AS count
UNION ALL SELECT 'settled_incomplete_players',
 (SELECT COUNT(*) FROM settled_players WHERE cashout IS NULL OR net IS NULL)
UNION ALL SELECT 'settled_effective_net_exceptions',
 (SELECT COUNT(*) FROM settled_players
  WHERE cashout IS NOT NULL AND net IS NOT NULL AND net<>cashout-effective_buyin)
UNION ALL SELECT 'settled_nonzero_net_games',
 (SELECT COUNT(*) FROM settled_game_totals WHERE net_total<>0)
UNION ALL SELECT 'settled_nonzero_games_with_incomplete_players',
 (SELECT COUNT(*) FROM settled_game_totals WHERE net_total<>0 AND incomplete>0)
UNION ALL SELECT 'settled_games_without_transfer_rows',
 (SELECT COUNT(*) FROM settled_game_totals g
  WHERE NOT EXISTS(SELECT 1 FROM settlement_transfers t WHERE t.game_id=g.id))
UNION ALL SELECT 'missing_player_revision_records',
 (SELECT COUNT(*) FROM game_players p
   LEFT JOIN game_player_revisions r ON r.game_id=p.game_id AND r.user_id=p.user_id
   WHERE r.game_id IS NULL)
UNION ALL SELECT 'nonpositive_transfer_rows',
 (SELECT COUNT(*) FROM settlement_transfers WHERE amount<=0)
ORDER BY metric;
