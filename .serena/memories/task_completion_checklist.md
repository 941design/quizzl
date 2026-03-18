# Task Completion Checklist

When a coding task is completed, verify the following before considering it done:

1. **Type check**: Ensure no TypeScript errors (the build will catch these)
2. **Unit tests**: Run `make test-unit` — all tests must pass
3. **Build**: Run `make build` — static export must succeed
4. **E2E tests** (if UI changed): Run `make test-e2e`
5. **Style consistency**: Follow existing patterns (Chakra UI components, hook conventions, path aliases)
6. **No direct npm commands**: Always use `make` targets to ensure platform stamp is valid

## Key Constraints
- Static export only — no server-side APIs, no SSR, no `getServerSideProps`
- Client-side data storage (localStorage) — no database
- Production basePath is `/quizzl` — relative paths/assets must account for this
- Cross-platform: changes must work on both macOS ARM and Linux x86_64
