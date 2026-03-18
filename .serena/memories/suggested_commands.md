# Suggested Commands

All build/test/dev commands should go through `make` to ensure the platform stamp check runs (avoids cross-platform native binary issues).

## Development
| Command | Description |
|---------|-------------|
| `make run-dev` | Start Next.js dev server (http://localhost:3000) |
| `make build` | Build static export to `app/out/` |
| `make install` | Clean install of dependencies |
| `make clean` | Remove node_modules, .next, and out |

## Testing
| Command | Description |
|---------|-------------|
| `make test` | Run all tests (unit + E2E) |
| `make test-unit` | Run Vitest unit tests (`app/tests/unit/`) |
| `make test-e2e` | Run Playwright E2E tests (`app/tests/e2e/`) |

## Deployment
| Command | Description |
|---------|-------------|
| `make deploy-check` | Verify FTP credentials and build output exist |
| `make deploy` | Deploy static build via FTP to HostEurope |
| `make deploy-dryrun` | Show what would be deployed |

## System Utilities (Darwin/macOS)
| Command | Description |
|---------|-------------|
| `git` | Version control |
| `ls`, `cd`, `find`, `grep` | Standard filesystem navigation |
| `brew` | Package manager (for lftp, etc.) |
| `lftp` | FTP client for deployment |

## Important Notes
- **Never run `npm install` directly** — always use `make install` or let Make targets handle deps
- Unit tests: `app/tests/unit/**/*.test.ts`
- E2E tests: `app/tests/e2e/`
- Playwright spins up a dev server automatically for E2E
