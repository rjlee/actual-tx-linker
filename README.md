# Actual Transaction Linker

Automatically links inter‑account transfers in Actual. It detects matching transactions across accounts, converts the kept side into a proper transfer (so Actual creates the counterpart), removes the duplicate, and fixes common “Needs Repair” cases (e.g., self‑transfers or transfers with categories). Run it on demand or as a small daemon, optionally reacting to events for near‑real‑time linking.

Key features

- Detects matches by amount, time window, and text similarity
- Pairs same‑day, same‑amount multiples deterministically to avoid ambiguity
- Converts one side into a transfer so Actual auto‑creates the counterpart
- Clears categories on transfers; repairs self‑transfers and broken/orphaned links
- Supports dry‑run, daemon mode, and optional event‑based triggering

Prerequisites

- An Actual Server and budget configured
- Transactions already imported (e.g., via GoCardless integration)

Configuration
Provide env vars (via shell or `.env` file at project root):

- `ACTUAL_SERVER_URL`: URL of your Actual server
- `ACTUAL_PASSWORD`: Server password
- `ACTUAL_SYNC_ID`: Budget sync ID
- `ACTUAL_BUDGET_ENCRYPTION_PASSWORD` (optional): Budget encryption password
- `BUDGET_DIR` (optional): Local data dir for Actual cache, default `./data/budget`
- `INCLUDE_ACCOUNTS` (optional): Comma-separated list of exact account names or ids to include
- `EXCLUDE_ACCOUNTS` (optional): Comma-separated list of exact account names or ids to exclude
- `DRY_RUN` (optional): `true` (default) logs actions only; set to `false` to apply links without passing the CLI flag
- `LOOKBACK_DAYS` / `WINDOW_HOURS` / `MIN_SCORE` / `INTERVAL_MINS` (optional): default scan/timing values used unless overridden by CLI
- `MAX_LINKS_PER_RUN` (optional, default 50): cap changes per run
- `PAIR_MULTIPLES` (optional, default `true`): deterministically pair same‑day, same‑amount multiples
- `DELETE_DUPLICATE` (optional, default `true`): delete the duplicate counterpart after linking
- `MERGE_NOTES` (optional, default `true`): append concise match info to kept txn notes
- `KEEP` (optional, `outgoing`|`incoming`, default `outgoing`): which side to keep
- `CLEARED_ONLY` (optional, default `true`): only consider cleared transactions
- `SKIP_RECONCILED` (optional, default `true`): skip reconciled transactions entirely
- `PREFER_RECONCILED` (optional, default `true`): when not skipping reconciled, keep the reconciled side

CLI

- One-off linking (dry-run by default): `node src/index.js --mode link-once`
- Daemon every N minutes: `node src/index.js --mode daemon --interval-mins 5`
  - Stop the daemon with Ctrl+C; it shuts down gracefully and closes the budget.
- Repair broken/self-transfers: `node src/index.js --mode repair`
  - Scans recent transactions for self-transfer payees that Actual marks as “Needs Repair” and fixes them by pointing to the correct opposite account, optionally deleting the duplicate counterpart.

### Optional: Event-based triggers (actual-events)

You can optionally listen to events from the `actual-events` sidecar to trigger near-real-time linking when new transactions arrive. This runs alongside the daemon interval (interval remains a fallback) and debounces bursts of events to avoid redundant runs.

Enable via environment variables:

```
ENABLE_EVENTS=true
EVENTS_URL=http://localhost:4000/events
# Optional if actual-events enforces auth
EVENTS_AUTH_TOKEN=your-token
```

By default, the listener subscribes to `transaction.created` and `transaction.updated` and schedules a link run shortly after changes are detected. You can include your own query params in `EVENTS_URL` to narrow by entities, events, or accounts; otherwise defaults are applied.

Common flags

- `--lookback-days` (default 14): how far back to scan
- `--window-hours` (default 72): max time difference between paired txns
- `--min-score` (default 0.2): minimum text-similarity score to accept
- `--dry-run` (boolean, default true): print actions without changing data
  - You can also control this via `DRY_RUN` env; CLI flag overrides the env default.
- `--include-accounts` (array): only scan accounts listed (name or id), can be repeated or comma-separated
- `--exclude-accounts` (array): skip accounts listed (name or id), can be repeated or comma-separated
  - If not provided, `INCLUDE_ACCOUNTS`/`EXCLUDE_ACCOUNTS` from the environment are used.
- `--merge-notes` (boolean, default true): merge a concise note from the matched counterpart into the kept transaction
- `--keep` (outgoing|incoming, default outgoing): choose which side to keep
- `--cleared-only` (boolean, default true): only match cleared transactions
- `--skip-reconciled` (boolean, default true): skip reconciled transactions entirely
- `--prefer-reconciled` (boolean, default true): when not skipping reconciled, keep the reconciled side if only one is reconciled
- `--max-links-per-run` (number, default 50): cap changes per run for safety
- `--pair-multiples` (boolean, default true): when multiple same-day, same-amount candidates exist on both sides, pair deterministically by id instead of skipping as ambiguous
- `--verbose` (boolean): more logs

Env vs CLI precedence

- All of the above env vars act as defaults. Any CLI flag explicitly provided overrides the corresponding env var for that run.

Repair specifics

- Targets transactions using a transfer payee that points back to the same account (self-transfer), a common cause of “Needs Repair”.
- Re-selects the correct transfer payee for the opposite account and (optionally) deletes the redundant duplicate on the other account.
- Respects `--dry-run` the same as linking (defaults to true, can be overridden by CLI or `DRY_RUN` env).
- Also respects `--cleared-only`, `--skip-reconciled`, `--keep`, and `--prefer-reconciled`.

Heuristics

- Opposite-signed amounts with the same absolute value
- Within the time window
- Simple token-overlap similarity on description/notes/imported payee
- Skip splits and already-linked transfers
- Only act on unambiguous single best matches

Notes

- By default we keep the outgoing (negative) transaction and delete the incoming duplicate.
- Actual auto-creates the mirrored transfer on update.
- The tool logs skip reasons (ambiguous, below-score, out-of-window) and prints a concise summary at the end.
- Amounts in logs show both human-readable units and raw milliunits for clarity.
