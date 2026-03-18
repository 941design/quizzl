# Quizzl - Project Overview

## Purpose
Quizzl is a group-learning quiz application built as a static-export Next.js app. It features topic-based quizzes, study plans, study-time tracking, a leaderboard, a notes editor, mood theming, and user profiles with avatars/badges. Data is stored client-side (localStorage).

## Tech Stack
- **Framework**: Next.js 14 (Pages Router) with static export (`output: 'export'`)
- **Language**: TypeScript (strict mode)
- **UI Library**: Chakra UI v2 + Emotion (styled components)
- **Rich Text**: TipTap editor
- **Animations**: Framer Motion
- **Icons**: @iconify/react
- **Testing**: Vitest (unit), Playwright (E2E)
- **Build**: Makefile wrapping npm scripts, with platform-stamp mechanism for cross-platform dev (macOS ARM / Linux x86_64)
- **Deployment**: Static export via FTP (lftp) to HostEurope, deployed to `/quizzl` and `/group-learn` paths

## Codebase Structure
```
app/                      # Next.js application root
  pages/                  # Pages Router routes
    index.tsx             # Home page
    topics.tsx            # Topic listing
    topic/                # Per-topic pages
    leaderboard.tsx       # Leaderboard
    study-times.tsx       # Study time tracking
    settings.tsx          # Settings
    _app.tsx              # App wrapper (Chakra + contexts)
    _document.tsx         # Custom document
    api/                  # API routes (if any)
    fonts/                # Font loading
  src/
    components/           # React components (Layout, TopicCard, Quiz, etc.)
      quiz/               # Quiz-specific components
    context/              # React contexts (Profile, Language)
    hooks/                # Custom hooks (mood theme, study timer, topic progress, etc.)
    lib/                  # Utilities (i18n, storage, content, scoring, theme)
    config/               # Configuration (profile)
    data/                 # Static data (avatar manifest)
    types/                # TypeScript type definitions
  styles/                 # CSS (globals, Home module)
  tests/
    unit/                 # Vitest unit tests
    e2e/                  # Playwright E2E tests
  public/                 # Static assets
specs/                    # Feature specifications and epic tracking
  spec.md                 # Main spec
  user-stories.md         # User stories
  epic-group-learning-prototype/  # Epic with 8 features (scaffold, content, quiz, notes, study plan, time tracking, leaderboard, theming)
docs/                     # Documentation
Makefile                  # Build/test/deploy orchestration
CLAUDE.md                 # AI assistant instructions
```

## Key Architecture Patterns
- **Static export**: No server-side rendering; all data is client-side (localStorage)
- **Context providers**: AppThemeProvider > ChakraProvider > LanguageProvider > ProfileProvider > Layout > Page
- **Path alias**: `@/*` maps to `app/*` (e.g., `@/src/components/Layout`)
- **Production basePath**: `/quizzl` (empty in dev)
