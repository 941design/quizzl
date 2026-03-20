# notestr

## Multi-platform development

This project is developed across Linux x86_64 and macOS ARM (darwin-arm64). Native dependencies (rolldown, @next/swc) are platform-specific.

- Never assume `node_modules/` from a previous session has the right native binaries.
- The Makefile `node_modules` target stamps the current platform — switching platforms triggers a fresh `npm install`.
- When running build, test, or dev commands, always go through `make` so the platform check runs first.
- Do not run `npm install` and then `touch node_modules` without also writing the platform stamp.

## Static export and dynamic data

The app uses `output: 'export'` (fully static) and is hosted on GitHub Pages. Dynamic path segments like `/groups/[id]` cause 404s on page reload because no HTML file exists at that path.

- Use **query parameters** (`/groups?id=xxx`) instead of path segments for client-side dynamic data.
- Keep all views for a route in a single page file (e.g. `pages/groups.tsx` renders both the list and detail views based on `router.query.id`).
- Do not create `[param].tsx` files unless `getStaticPaths` can enumerate all values at build time (like `topic/[slug].tsx` does).
