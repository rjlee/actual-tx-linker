# actual-tx-linker

Automatically identify and link transfer pairs in Actual Budget. Scans historical activity, matches candidate transactions, converts them into transfers, and cleans up duplicates.

## Features

- Configurable lookback, window, and similarity thresholds for precise linking.
- Deterministic handling of multiple candidates on the same day/amount.
- Repair mode to fix broken or duplicate transfers.
- Optional integration with `actual-events` for near real-time linking.
- Docker image with health check and persistent budget cache volume.

## Requirements

- Node.js ≥ 22.
- Actual Budget server credentials (`ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID`).
- Lookback window tuned to your import cadence.

## Installation

```bash
git clone https://github.com/rjlee/actual-tx-linker.git
cd actual-tx-linker
npm install
```

Optional git hooks:

```bash
npm run prepare
```

### Docker quick start

```bash
cp .env.example .env
docker build -t actual-tx-linker .
mkdir -p data/budget
docker run -d --env-file .env \
  -v "$(pwd)/data:/app/data" \
  actual-tx-linker --mode daemon
```

Published images live at `ghcr.io/rjlee/actual-tx-linker:<tag>` (see [Image tags](#image-tags)).

## Configuration

- `.env` – primary configuration, copy from `.env.example`.
- `config.yaml` / `config.yml` / `config.json` – optional defaults, copy from `config.example.yaml`.

Precedence: CLI flags > environment variables > config file.

| Setting                                 | Description                                         | Default              |
| --------------------------------------- | --------------------------------------------------- | -------------------- |
| `BUDGET_DIR`                            | Budget cache directory                              | `./data/budget`      |
| `LOOKBACK_DAYS`                         | How far back to scan for candidate links            | `14`                 |
| `WINDOW_HOURS`                          | Max time gap between two sides of a transfer        | `72`                 |
| `MIN_SCORE`                             | Text similarity threshold for matches               | `0.2`                |
| `MAX_LINKS_PER_RUN`                     | Cap on links performed per execution                | `50`                 |
| `DRY_RUN`                               | Default dry-run mode (`true` keeps changes local)   | `true`               |
| `LINK_CRON` / `LINK_CRON_TIMEZONE`      | Daemon cron schedule                                | `15 * * * *` / `UTC` |
| `DISABLE_CRON_SCHEDULING`               | Disable cron while in daemon mode                   | `false`              |
| `PAIR_MULTIPLES`                        | Handle duplicate same-day amounts deterministically | `true`               |
| `DELETE_DUPLICATE`                      | Remove the duplicate side after linking             | `true`               |
| `MERGE_NOTES`                           | Append match context to kept transaction notes      | `true`               |
| `ENABLE_EVENTS` / `EVENTS_URL`          | Subscribe to `actual-events` SSE stream             | disabled             |
| `EVENTS_AUTH_TOKEN`                     | Bearer token for the SSE stream                     | unset                |
| `INCLUDE_ACCOUNTS` / `EXCLUDE_ACCOUNTS` | Account filters (names or IDs)                      | unset                |

## Usage

### CLI modes

- Preview matches (dry-run): `npm start -- --mode link-once`
- Apply changes: `npm start -- --mode link-once --dry-run=false`
- Interactive review: `npm start -- --mode link-once --interactive`
- Repair existing transfers: `npm start -- --mode repair --dry-run=false`

### Daemon

- Cron-driven daemon: `npm start -- --mode daemon`
- Event-triggered daemon: `ENABLE_EVENTS=true EVENTS_URL=http://localhost:4000/events npm start -- --mode daemon`

### Docker daemon

```bash
docker run -d --env-file .env \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/rjlee/actual-tx-linker:latest --mode daemon
```

## Testing & linting

```bash
npm test
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

## Image tags

- `ghcr.io/rjlee/actual-tx-linker:<semver>` – pinned to a specific `@actual-app/api` release.
- `ghcr.io/rjlee/actual-tx-linker:latest` – highest supported API version.

See [rjlee/actual-auto-ci](https://github.com/rjlee/actual-auto-ci) for tagging policy and release automation.

## License

MIT © contributors.
