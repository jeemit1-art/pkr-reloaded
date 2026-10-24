# PKR Reloaded — staging acceptance matrix

**Status: NOT YET PERFORMED.** Production release remains blocked.
Test with fictional players and payments only, using the exact staging commit.
Do not use live contacts, real funds, production tokens or personal financial records.

## Prerequisites
The same commit must have green Worker/SQL/unit tests AND a green frontend
build. Confirm Vercel Preview is available on that exact commit and calls only
the isolated staging Worker, database and KV. For the revision/stack cases,
the additive D1 migration must have been applied to isolated staging and
both feature flags enabled there. Until then, those cases are blocked.

Use two independent signed-in phones (A and B) and one desktop browser. For
each test record device/browser, SHA, date, expected/actual, Pass/Fail, and a
private issue/evidence reference. Do not paste secrets or D1 exports in GitHub.

| ID | Action | Pass criteria |
| --- | --- | --- |
| S01 | Hosts A and B start the same game concurrently | One start succeeds; seats and RSVPs are not duplicated |
| S02 | Two hosts claim the same seat | First wins, second sees a conflict |
| F01 | Both hosts change the same buy-in from one revision | Exactly one update, durable explicit conflict for the other |
| F02 | A changes an amount, changes it back; B submits the original revision | Rejected despite equal amounts (ABA) |
| F03 | Offline cash-out, close tab, restore and reconnect | Pending journal survives if storage persists, no duplicate write |
| F04 | Block/clear storage, then edit financially | Edit fails closed; no misleading saved/synced indication |
| F05 | Network timeout after server write and retry | No duplicate financial transaction |
| H01 | Confirm physical starting stacks for every seated player | No SB/BB/straddle posts until confirmed; no guessed counts |
| H02 | Cancel stack confirmation after hand creation | No blind posted; hand can resume or be voided safely |
| H03 | Disconnect between SB and BB/straddle | Refresh refuses betting until all mandatory blinds post |
| H04 | Bet beyond available chips or falsely declare all-in | Worker rejects and hand pot remains unchanged |
| H05 | Two hosts submit different actions for same turn | One write, second gets a history conflict |
| H06 | Two hosts change the same board card | Stale edit blocked, server board reloads |
| H07 | Multiple all-in tiers, folded dead money, unmatched wager | Side pots/refunds conserve all chips |
| H08 | Tied winners and odd chip | First eligible winner clockwise after button receives extra chip |
| H09 | Stale Undo Winner or Undo Action | Newer action/result remains intact |
| H10 | Void a hand with history | History retained and hand number never recycled |
| T01 | Double-tap rebuy/add-on, then retry after offline interruption | Exactly one receipt and chip credit |
| T02 | Both hosts advance blind level | Exactly one advancement; Worker time authoritative |
| T03 | Pause on A, resume on B | Elapsed time consistent across devices |
| T04 | Concurrent eliminations and refresh | No duplicated finishing positions; history persists |
| T05 | Percentage payout with odd cents | Recorded prize pool reconciles to exact cent |
| R01 | Settle game and reload | Buy-ins, cash-outs, net and transfers reconcile |
| R02 | Independently restore backup to isolated copy | Schema, row counts and aggregate amounts reconcile |

## Stop/release blockers

Stop immediately if a financial amount, seat, pot, winner or hand history can be
silently overwritten, if offline edits disappear without an explicit warning,
if a false all-in is accepted, or if any staging request targets production.
A source build, synthetic tests and a written checklist do NOT substitute
for executing the above real-device cases.

Owner approval must identify a frozen commit, verified independent production
backup and restore, reconciled financial evidence and a rollback owner.
No merge or production promotion is authorised by this document.
