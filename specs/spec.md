# Technical Specification: Quizzl (Next.js + React + TypeScript + Chakra UI)

## 1. Purpose and Scope

### 1.1 Purpose

Build a **static web prototype** that helps **groups/classes** learn with **freely selectable topics**, combining:

* **Notes** (rich text)
* **Quiz / Flashcards**
* **Study plans** (predefined steps)

It also demonstrates a **group feeling** via:

* **Leaderboard view** (user-only, since prototype is single-user)
* **Shared study times view** (user-only)

### 1.2 Target Users

* Learners in a class/group using a shared concept, but **this prototype supports only one real user per browser**.

### 1.3 Non-goals

* No backend, no authentication, no real multi-user synchronization.
* No teacher/admin authoring UI.
* No externally fetched content (only content shipped with the static site).
* No advanced analytics, payments, notifications, or messaging.

### 1.4 Release Type

* **Prototype**: fast to use, designed for iteration after user feedback.

### 1.5 Success Criteria (Prototype)

* Users can select topics and immediately start learning.
* Notes, quiz/flashcards, and study plan are all usable end-to-end.
* Progress and settings persist via localStorage.
* “Leaderboard” and “Shared study times” are present and meaningful for a single user.
* Clear empty/error states with actionable tips.

---

## 2. Product Requirements

## 2.1 Core Features (Must Have)

### 2.1.1 Topic Discovery and Selection

* The app lists available topics from bundled content files.
* Each topic shows:

  * Title
  * Short description
  * Optional tags/level (if present in content)
* User selects any number of topics for themselves.
* Only selected topics appear in “My Topics”.

### 2.1.2 Learning Area per Topic (Tabs)

Inside a topic, the UI shows **tabs**:

1. **Quiz**
2. **Notes**
3. **Study Plan**

Tabs are always visible and switching tabs does not lose state.

### 2.1.3 Quiz / Flashcards

Supports three question types:

* **Type A: Single-choice** (exactly 1 correct)
* **Type B: Multi-choice** (one or more correct)
* **Type C: Flashcard** (self-assessed “I knew it” / “I didn’t”)

#### Question behavior

* Questions are presented in an ordered list defined by content.
* User can:

  * Answer the current question
  * Navigate next/previous (allowed; answers persist)
  * See per-topic progress (answered / total, points)

#### Scoring

* **Type A**: +1 point if correct, else 0.
* **Type B**: partial with penalties:

  * +1 per correctly selected option
  * −1 per incorrectly selected option
  * minimum 0 per question
* **Type C**: “I knew it” = +1 point, “I didn’t” = 0.

#### Completion states

* When all questions have answers/self-assessment recorded:

  * Show topic quiz summary:

    * total points
    * breakdown per question (optional in prototype but recommended)
    * “Retry incorrect / not known” action (recommended)

### 2.1.4 Notes (Rich Text)

* Each topic has a notes area.
* Notes are a **rich text editor** (basic formatting: bold, italic, lists, headings, links).
* Notes are saved automatically (debounced) to localStorage per topic.
* Notes are private to the user (single-user prototype).

### 2.1.5 Study Plan (Predefined per Topic)

* Each topic includes a **predefined study plan**, structured as ordered steps (e.g., “Day 1”, “Day 2”).
* Each step contains:

  * title
  * optional description
  * a list of tasks, each task referencing either:

    * a subset of quiz questions (by ids) OR
    * a generic task (e.g., “Review notes”, “Do flashcards”)

#### Study plan behavior

* User can mark tasks complete.
* Step progress shows:

  * tasks completed / total
* Topic progress should incorporate plan completion (separately from quiz points).

### 2.1.6 Group Experience Views (User-only)

Because there is no multi-user interaction, these are **user-only** but must be present and useful.

#### Leaderboard (User-only)

* A “Leaderboard” page exists.
* It displays the user’s stats as if they were in a group:

  * total points across selected topics
  * streak (optional)
  * rank shown as “You (1/1)” or similar
* Copy/text must clarify implicitly that this is a prototype view (without mentioning “fake users” since none are shown).

#### Shared Study Times (User-only)

* A “Shared Study Times” page exists.
* It shows the user’s study sessions and totals:

  * today’s study time
  * this week’s study time
  * recent sessions list (start, end, duration, topic)
* “Shared” framing remains but only the user is visible.

### 2.1.7 Style / Mood Setting (Calm vs Playful)

* The user can choose a constrained style setting:

  * `calm` or `playful`
* This affects UI theme tokens (colors, accent, subtle animations).
* The setting persists in localStorage.
* Default: `calm`.

### 2.1.8 Clear Empty/Error States

* If content fails to load or a topic has missing sections:

  * show a clear message
  * show a next-step tip (e.g., “Choose another topic” / “This topic has no quiz yet”)
* No empty screens without explanation.

---

## 3. Non-Functional Requirements

### 3.1 Performance

* First load should be fast (static assets).
* Navigation between pages should feel instant.
* localStorage reads/writes must be debounced to avoid UI lag.

### 3.2 Reliability

* If localStorage is unavailable (private mode limitations):

  * app still runs
  * show warning and operate in “non-persistent mode” (in-memory until refresh)

### 3.3 Accessibility

* Keyboard navigable:

  * tab switching
  * answering questions
  * navigating steps
* Reasonable contrast in both style modes.
* ARIA labels for editor controls and interactive elements.

### 3.4 Responsiveness

* Fully usable on:

  * desktop
  * mobile
  * tablet
* Layout must adapt (stacked components on small screens).

### 3.5 Privacy

* All data remains in the browser (localStorage). No network calls required for core functions.

---

## 4. Technical Requirements

## 4.1 Tech Stack

* **Next.js** (static export capable)
* **React**
* **TypeScript**
* **Chakra UI** for components and styling
* Content: **Markdown and/or JSON** bundled with the app
* Persistence: **localStorage** only

## 4.2 App Routing (Suggested)

* `/` Home / onboarding quick start
* `/topics` Topic list (available topics + “My Topics”)
* `/topic/[slug]` Topic detail with Tabs:

  * `Quiz` tab
  * `Notes` tab
  * `Study Plan` tab
* `/leaderboard` User-only leaderboard
* `/study-times` User-only shared study times
* `/settings` Style toggle + reset data

(Exact routing can be adjusted, but the above views must exist.)

## 4.3 Data Model

### 4.3.1 Content Schema (TypeScript types)

Define a unified internal type, regardless of Markdown/JSON input:

```ts
type Topic = {
  slug: string;
  title: string;
  description: string;
  tags?: string[];
  quiz: QuizQuestion[];
  studyPlan: StudyPlan;
};

type QuizQuestion =
  | { id: string; type: "single"; prompt: string; options: Option[]; correctOptionId: string; explanation?: string }
  | { id: string; type: "multi"; prompt: string; options: Option[]; correctOptionIds: string[]; explanation?: string }
  | { id: string; type: "flashcard"; front: string; back: string };

type Option = { id: string; text: string };

type StudyPlan = {
  steps: StudyStep[];
};

type StudyStep = {
  id: string;
  title: string;
  description?: string;
  tasks: StudyTask[];
};

type StudyTask =
  | { id: string; type: "quiz"; questionIds: string[]; title: string }
  | { id: string; type: "notes"; title: string }
  | { id: string; type: "flashcards"; questionIds?: string[]; title: string }
  | { id: string; type: "custom"; title: string; description?: string };
```

### 4.3.2 User Data Schema (localStorage)

Single user profile.

Keys (suggested):

* `lp_settings_v1`
* `lp_selectedTopics_v1`
* `lp_progress_v1`
* `lp_studyTimes_v1`

Types:

```ts
type Settings = {
  mood: "calm" | "playful";
};

type SelectedTopics = {
  slugs: string[];
};

type TopicProgress = {
  // Quiz
  answers: Record<string, { kind: "single"; optionId: string } | { kind: "multi"; optionIds: string[] } | { kind: "flashcard"; knewIt: boolean }>;
  quizPoints: number; // cached total (or computed on load)
  // Notes
  notesHtml: string; // serialized editor output
  // Study plan
  completedTaskIds: string[];
};

type Progress = {
  byTopicSlug: Record<string, TopicProgress>;
};

type StudySession = {
  id: string;
  topicSlug?: string;
  startedAt: string; // ISO
  endedAt: string;   // ISO
  durationMs: number;
};

type StudyTimes = {
  sessions: StudySession[];
  activeSession?: { startedAt: string; topicSlug?: string };
};
```

Rules:

* Notes and progress are stored per topic.
* “No persistence layer” means only browser storage; no sharing.

## 4.4 Content Loading

* Content must be importable at build time.
* Support at least one of:

  * `/content/*.json` parsed directly
  * `/content/*.md` parsed via frontmatter + custom parsing
* Internally normalize into `Topic`.

Prototype requirement:

* Ship with **multiple topics** and example questions demonstrating all 3 question types.

## 4.5 Rich Text Notes Editor

* Use a lightweight React rich text editor compatible with Next.js + TS (e.g., TipTap, Lexical, or similar).
* Store serialized HTML (or editor JSON) in localStorage.
* Must support mobile input well.

## 4.6 Study Time Tracking

* When the user is in a learning view (topic page), allow starting/stopping a session:

  * Start button (or auto-start on entering topic) — prototype choice, but must be consistent.
  * Stop button to end session.
* On stop, append a session record to `lp_studyTimes_v1`.
* On refresh while a session is active, recover state from localStorage and prompt user to continue/stop.

(Prototype-friendly default: manual Start/Stop.)

---

## 5. UX and Behavior Requirements

## 5.1 “Quick Start” Principle

* User can begin learning in a few clicks:

  1. Open Topics
  2. Pick a topic
  3. Start Quiz / Notes / Study Plan immediately

Advanced options (settings, details) must not block usage.

## 5.2 Topic Page Layout

* Header: topic title + small stats (points, plan progress, time today)
* Tabs: Quiz | Notes | Study Plan

### Quiz tab

* Question card with:

  * prompt (or flashcard front)
  * options / selection UI based on type
  * submit/confirm for multi-choice (to prevent accidental scoring)
  * feedback area (correct/incorrect + explanation if provided)
* Navigation controls: Prev / Next
* Progress indicator (answered/total)

### Notes tab

* Rich editor with autosave indicator.
* Optional “Insert prompt from current quiz question” (nice-to-have, not required).

### Study Plan tab

* Step list with expand/collapse
* Task checklist
* Mark complete; show step completion summary

## 5.3 Settings

* Mood toggle calm/playful
* “Reset all data” action (clears localStorage keys used by app)

## 5.4 Error/Empty States

Examples:

* No topics selected → show “Pick topics” CTA
* Topic missing quiz → show message + suggest switching to Notes/Study Plan or other topic
* localStorage unavailable → show warning banner and proceed without persistence

---

## 6. Acceptance Criteria (Testable)

### 6.1 Topic Selection

* User can select/unselect topics.
* “My Topics” updates immediately.
* Selection persists after refresh (localStorage).

### 6.2 Quiz Types

* Type A: selecting an answer records it, score updates correctly.
* Type B: user can select multiple options; scoring follows +1/-1 floor at 0.
* Type C: flashcard reveals back; user can select “I knew it / I didn’t”; scoring updates.

### 6.3 Notes

* User can write formatted notes and see formatting preserved after refresh.
* Notes are stored per topic.

### 6.4 Study Plan

* Steps and tasks render from content.
* User can mark tasks complete.
* Completion persists after refresh.

### 6.5 Leaderboard (User-only)

* Leaderboard page exists and displays total points across selected topics.
* It never shows other users.

### 6.6 Shared Study Times (User-only)

* User can record sessions and see totals and session list.
* Sessions persist after refresh.

### 6.7 Style Setting

* User can toggle calm/playful.
* Setting persists after refresh and affects UI theme.

### 6.8 Empty/Error Handling

* Missing content and empty states always show an explanatory message and a next-step tip.

---

## 7. Delivery Plan (Prototype Milestones)

1. Project scaffold (Next.js + TS + Chakra) + routing skeleton
2. Content ingestion (JSON/Markdown → normalized Topic model) + Topic list/selection
3. Topic page with tabs + Quiz engine (A/B/C) + scoring + persistence
4. Notes editor + persistence
5. Study plan rendering + task completion persistence
6. Study time tracking + “Shared study times” page
7. Leaderboard page (user-only aggregation)
8. Mood theming + settings + reset + polish of empty/error states

---

## 8. Open TODOs (Non-blocking, can be decided later)

* Exact rich text editor library choice (TipTap vs Lexical vs other)
* Exact Markdown format if Markdown is used (frontmatter + custom blocks vs JSON-only)
* Visual design details for calm/playful themes (colors, animations)
* Whether quiz review screens include per-question explanations and retry filters (recommended)
