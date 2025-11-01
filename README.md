# Actual Transaction Linker

Links matching inter-account transactions (e.g., Monzo → Starling) in Actual into proper transfers and removes duplicates created by bank importers (e.g., GoCardless).

Key features

- Detects matches by amount, time window, and text similarity
- Converts one side into a transfer so Actual auto-creates the linked counterpart
- Deletes the redundant duplicate on the other account
- Supports dry-run and daemon (interval) mode

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

CLI

- One-off linking (dry-run by default): `node src/index.js --mode link-once`
- Daemon every N minutes: `node src/index.js --mode daemon --interval-mins 5`
  - Stop the daemon with Ctrl+C; it shuts down gracefully and closes the budget.

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
- `--include-accounts` (array): only scan accounts listed (name or id), can be repeated or comma-separated
- `--exclude-accounts` (array): skip accounts listed (name or id), can be repeated or comma-separated
  - If not provided, `INCLUDE_ACCOUNTS`/`EXCLUDE_ACCOUNTS` from the environment are used.
- `--merge-notes` (boolean, default true): merge a concise note from the matched counterpart into the kept transaction
- `--keep` (outgoing|incoming, default outgoing): choose which side to keep
- `--cleared-only` (boolean, default true): only match cleared transactions
- `--skip-reconciled` (boolean, default true): skip reconciled transactions entirely
- `--prefer-reconciled` (boolean, default true): when not skipping reconciled, keep the reconciled side if only one is reconciled
- `--max-links-per-run` (number, default 50): cap changes per run for safety
- `--verbose` (boolean): more logs

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
