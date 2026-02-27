# Acceptance Criteria: Group Learning Prototype

Generated: 2026-02-27T16:00:00Z
Source: spec.md

## Criteria

### AC-001: Project Scaffold and Routing
- **Description**: Next.js app with TypeScript and Chakra UI builds successfully with `next build`. All required routes exist: `/`, `/topics`, `/topic/[slug]`, `/leaderboard`, `/study-times`, `/settings`.
- **Verification**: Run `npm run build` — no TypeScript errors, no build failures. Navigate to each route in browser and verify page renders.
- **Type**: integration

### AC-002: Content Ingestion and Topic Model
- **Description**: At least 3 bundled topics exist as JSON files. Each topic normalizes to the `Topic` TypeScript type with title, description, tags, quiz questions (covering all 3 types), and a study plan. Content is importable at build time.
- **Verification**: `npm run build` succeeds. Topics page loads and displays at least 3 topics with title and description.
- **Type**: integration

### AC-003: Topic Selection Persistence
- **Description**: User can select and deselect topics. "My Topics" list updates immediately. Selection persists in localStorage (`lp_selectedTopics_v1`) and survives page refresh.
- **Verification**: Select a topic, refresh page — topic remains selected. Deselect, refresh — topic is deselected.
- **Type**: e2e

### AC-004: Topic Page Tabs
- **Description**: Topic detail page shows Quiz, Notes, and Study Plan tabs. Switching tabs does not lose state (quiz answers, note content).
- **Verification**: Navigate to a topic, answer a quiz question, switch to Notes tab, switch back — answer is still recorded.
- **Type**: e2e

### AC-005: Quiz Type A (Single Choice)
- **Description**: Single-choice questions display options. Selecting an option records the answer. Score updates by +1 for correct, +0 for incorrect. Answer persists after refresh.
- **Verification**: Answer a single-choice question correctly — score increments by 1. Refresh — answer still selected.
- **Type**: e2e

### AC-006: Quiz Type B (Multi Choice)
- **Description**: Multi-choice questions allow selecting multiple options. Score = sum(+1 per correct option selected) + sum(-1 per incorrect option selected), floored at 0. Answer persists after refresh.
- **Verification**: Select all correct and one wrong option — score reflects partial calculation. Refresh — answers persist.
- **Type**: e2e

### AC-007: Quiz Type C (Flashcard)
- **Description**: Flashcard shows front side. User clicks to reveal back. User selects "I knew it" (+1) or "I didn't" (0). Answer persists after refresh.
- **Verification**: Click reveal, select "I knew it" — score +1. Refresh — self-assessment persists.
- **Type**: e2e

### AC-008: Quiz Navigation and Summary
- **Description**: User can navigate Prev/Next between questions. Progress indicator shows answered/total. When all questions answered, a summary screen shows total points and a retry option.
- **Verification**: Answer all questions — summary screen appears with correct total points and a retry button.
- **Type**: e2e

### AC-009: Notes Editor
- **Description**: Rich text editor (TipTap or equivalent) is present in Notes tab. Supports bold, italic, lists, headings, links. Content autosaves (debounced) to localStorage per topic (`lp_progress_v1[slug].notesHtml`). Notes persist after refresh.
- **Verification**: Type formatted text (bold heading, bullet list), refresh page — content and formatting preserved.
- **Type**: e2e

### AC-010: Study Plan Rendering
- **Description**: Study Plan tab shows ordered steps from content. Each step shows title, optional description, and a task checklist. Tasks can be marked complete. Progress (completed/total) is displayed per step.
- **Verification**: Mark tasks complete — progress counter updates. Steps show correct completion ratio.
- **Type**: e2e

### AC-011: Study Plan Persistence
- **Description**: Completed task IDs persist in localStorage (`lp_progress_v1[slug].completedTaskIds`). After refresh, checked tasks remain checked.
- **Verification**: Mark 2 tasks complete, refresh — both tasks remain checked.
- **Type**: e2e

### AC-012: Study Time Tracking
- **Description**: Topic page has Start/Stop session controls. Starting a session records `startedAt` in `lp_studyTimes_v1.activeSession`. Stopping appends a completed session with durationMs. Active session survives refresh (prompt to continue/stop).
- **Verification**: Start session, wait 2s, stop — session appears in study times with durationMs > 0. Refresh during active session — prompted to continue or stop.
- **Type**: e2e

### AC-013: Shared Study Times Page
- **Description**: `/study-times` page exists and shows today's study time, this week's study time, and a recent sessions list (start time, end time, duration, topic).
- **Verification**: After recording sessions, navigate to /study-times — sessions appear with correct totals.
- **Type**: e2e

### AC-014: Leaderboard Page
- **Description**: `/leaderboard` page exists and shows the user's total points across selected topics. Rank shown as "You (1/1)" or equivalent. No fake users displayed.
- **Verification**: After answering quiz questions, navigate to /leaderboard — total points correct, rank shown.
- **Type**: e2e

### AC-015: Mood Theming
- **Description**: Settings page has calm/playful toggle. Setting persists in `lp_settings_v1.mood`. UI reflects theme change (different colors/accents between modes). Default is calm.
- **Verification**: Toggle to playful — visual theme changes. Refresh — playful theme persists. Toggle back to calm — calm theme applies.
- **Type**: e2e

### AC-016: Settings Reset
- **Description**: Settings page has "Reset all data" action that clears all `lp_*` localStorage keys. After reset, app returns to empty/default state.
- **Verification**: Add progress data, click reset — all data cleared, topics deselected, progress gone.
- **Type**: e2e

### AC-017: Empty/Error States
- **Description**: No topics selected → "Pick topics" CTA shown on home/topics page. Topic missing quiz → clear message shown with next-step tip. localStorage unavailable → warning banner shown; app still runs.
- **Verification**: With no topics selected, home page shows empty state with CTA. Navigate to a topic with no quiz — helpful message appears.
- **Type**: e2e

### AC-018: Accessibility and Responsiveness
- **Description**: All interactive elements are keyboard-navigable. ARIA labels present on editor controls. App is usable on mobile viewport (375px wide). Reasonable contrast in both theme modes.
- **Verification**: Tab through quiz questions with keyboard — can answer questions. Resize to 375px — layout adapts without horizontal scroll.
- **Type**: manual

## Verification Plan

All E2E criteria (AC-003 through AC-017) will be verified using Playwright tests running against `next dev` or `next start` with static export. Tests will use chromium browser. Unit tests using Jest + React Testing Library will cover quiz scoring logic (AC-005, AC-006, AC-007) and localStorage utilities.

## E2E Test Plan

### E2E Scenario 1: Full Learning Flow
- **Services**: Next.js dev server on port 3000
- **Browser**: Chromium via Playwright
- **Steps**:
  1. Navigate to `/topics`
  2. Select a topic → verify it appears in "My Topics"
  3. Navigate to `/topic/[slug]`
  4. Answer a single-choice question → verify score updates
  5. Switch to Notes tab → type text with bold formatting
  6. Switch to Study Plan tab → mark a task complete
  7. Refresh page → verify all state persists
  8. Navigate to `/leaderboard` → verify points shown

### E2E Scenario 2: Quiz Types Verification
- **Services**: Next.js dev server on port 3000
- **Browser**: Chromium via Playwright
- **Steps**:
  1. Navigate to a topic with all 3 quiz types
  2. Answer Type A (single) correctly → score +1
  3. Answer Type B (multi) with partial correct → verify floor-0 scoring
  4. Answer Type C (flashcard) → reveal → select "I knew it" → score +1
  5. Navigate to next question with Prev/Next
  6. Complete all questions → verify summary screen appears

### E2E Scenario 3: Study Times and Leaderboard
- **Services**: Next.js dev server on port 3000
- **Browser**: Chromium via Playwright
- **Steps**:
  1. Navigate to a topic → click Start session
  2. Wait → click Stop session
  3. Navigate to `/study-times` → verify session appears
  4. Navigate to `/leaderboard` → verify points aggregated

### E2E Scenario 4: Settings and Theme
- **Services**: Next.js dev server on port 3000
- **Browser**: Chromium via Playwright
- **Steps**:
  1. Navigate to `/settings`
  2. Toggle mood to playful → verify theme visually changes
  3. Refresh → verify playful theme persists
  4. Click "Reset all data" → verify data cleared
