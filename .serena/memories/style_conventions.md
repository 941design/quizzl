# Code Style & Conventions

## TypeScript
- **Strict mode** enabled in tsconfig
- File extensions: `.ts` for logic, `.tsx` for React components
- Path alias: `@/*` → `app/*` (e.g., `import Layout from '@/src/components/Layout'`)
- Type definitions in `app/src/types/`

## React / Next.js
- **Pages Router** (not App Router) — routes in `app/pages/`
- Components are **function components** (arrow functions or named functions)
- **Chakra UI v2** for UI primitives — use Chakra components, not raw HTML elements
- **Emotion** for custom styled components where needed
- Context pattern: dedicated providers in `app/src/context/`
- Custom hooks in `app/src/hooks/` (prefixed with `use`)

## Naming
- Components: PascalCase filenames matching component name (e.g., `TopicCard.tsx` → `TopicCard`)
- Hooks: camelCase with `use` prefix (e.g., `useMoodTheme.tsx`)
- Lib/utils: camelCase filenames (e.g., `storage.ts`, `scoring.ts`)
- Config: camelCase filenames in `src/config/`

## File Organization
- One primary export per file
- Components go in `src/components/`, grouped by feature subdirectories when needed (e.g., `quiz/`)
- Shared logic in `src/lib/`
- State/context in `src/context/`

## Module System
- ES modules (`import`/`export`)
- Next.js config uses `.mjs` extension
