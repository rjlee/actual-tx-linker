## [1.7.1](https://github.com/rjlee/actual-tx-linker/compare/v1.7.0...v1.7.1) (2025-11-03)


### Bug Fixes

* amend cron schedule ([eafa24e](https://github.com/rjlee/actual-tx-linker/commit/eafa24e98b80b1a446041a7551d624ea02678d0a))

# [1.7.0](https://github.com/rjlee/actual-tx-linker/compare/v1.6.2...v1.7.0) (2025-11-03)


### Features

* added interactive cli mode ([bad6423](https://github.com/rjlee/actual-tx-linker/commit/bad64239b4c241b53304124fc3ba3d1c18654724))

## [1.6.2](https://github.com/rjlee/actual-tx-linker/compare/v1.6.1...v1.6.2) (2025-11-02)


### Bug Fixes

* support actual api version specification in docker compose file ([ab30f1a](https://github.com/rjlee/actual-tx-linker/commit/ab30f1a8aa038ed82c2e1ba04dd55f21c7aef201))

## [1.6.1](https://github.com/rjlee/actual-tx-linker/compare/v1.6.0...v1.6.1) (2025-11-02)


### Bug Fixes

* reduce test threshold ([1701f89](https://github.com/rjlee/actual-tx-linker/commit/1701f8943ae205e09a1b14f6f6ee5ccfbad9a873))
* removing temp script ([77ac619](https://github.com/rjlee/actual-tx-linker/commit/77ac619e2e7b9fb031fd986a2788c5c11bd70e69))

# [1.6.0](https://github.com/rjlee/actual-tx-linker/compare/v1.5.0...v1.6.0) (2025-11-01)


### Features

* Add new environment variables and CLI options for transaction linking behavior ([6c43609](https://github.com/rjlee/actual-tx-linker/commit/6c43609bc1e30bcb4b6d891a54058b90a5c1e6bd))

# [1.5.0](https://github.com/rjlee/actual-tx-linker/compare/v1.4.0...v1.5.0) (2025-11-01)


### Features

* Add 'pair-multiples' option to link transactions deterministically and implement corresponding tests ([92634be](https://github.com/rjlee/actual-tx-linker/commit/92634befd26ed2b09688f8a3b177ddd9c9ac14f9))

# [1.4.0](https://github.com/rjlee/actual-tx-linker/compare/v1.3.1...v1.4.0) (2025-11-01)


### Features

* Add repair mode to fix self-transfers and clear categories in transactions ([e88bac5](https://github.com/rjlee/actual-tx-linker/commit/e88bac5d30de88569457495d84d5d5998e47b6ce))

## [1.3.1](https://github.com/rjlee/actual-tx-linker/compare/v1.3.0...v1.3.1) (2025-11-01)


### Bug Fixes

* Correct transfer payee ID assignment to target the appropriate account in linkOnce function ([4445df9](https://github.com/rjlee/actual-tx-linker/commit/4445df95417052ff98c2051a5133e69303f3df9e))

# [1.3.0](https://github.com/rjlee/actual-tx-linker/compare/v1.2.0...v1.3.0) (2025-11-01)


### Features

* Add DRY_RUN environment variable support for controlling dry-run behavior ([2b1044c](https://github.com/rjlee/actual-tx-linker/commit/2b1044c72a9d345f9b9dfd7141d1515865059903))

# [1.2.0](https://github.com/rjlee/actual-tx-linker/compare/v1.1.1...v1.2.0) (2025-11-01)


### Bug Fixes

* Improve formatting and readability in event listener and debounce functions ([4cba154](https://github.com/rjlee/actual-tx-linker/commit/4cba154abc36a3c3396528a46e898ef567d52bca))


### Features

* Add event-based triggers for near-real-time linking with actual-events ([196a938](https://github.com/rjlee/actual-tx-linker/commit/196a9387fa894e30d97c8c409787ca6aaaa4c011))

## [1.1.1](https://github.com/rjlee/actual-tx-linker/compare/v1.1.0...v1.1.1) (2025-10-30)


### Bug Fixes

* Correct Docker image references in workflows and docker-compose.yml ([7061fad](https://github.com/rjlee/actual-tx-linker/commit/7061fad2bbb115ead68134a4579d36791ef1373a))

# [1.1.0](https://github.com/rjlee/actual-tx-linker/compare/v1.0.0...v1.1.0) (2025-10-30)


### Bug Fixes

* Update .prettierignore to include CHANGELOG.md and format adjustments in docker-compose.yml ([cc9c085](https://github.com/rjlee/actual-tx-linker/commit/cc9c0856381ea693416f38a41a6605e93198290d))


### Features

* Add initial docker-compose.yml for service configuration ([0294328](https://github.com/rjlee/actual-tx-linker/commit/02943283ccac9efeb33c7532e06f22423705bb07))

# 1.0.0 (2025-10-30)

### Bug Fixes

- Add clarification to logging details in README.md ([4e8997c](https://github.com/rjlee/actual-tx-linker/commit/4e8997c6938a2d528b8434b5694f3b3c55fe48e5))
- Remove redundant newline in README.md for improved formatting ([ac14953](https://github.com/rjlee/actual-tx-linker/commit/ac14953e83223a2e9814de2b7fbaf9f5064cd74a))
