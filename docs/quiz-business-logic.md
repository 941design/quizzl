# Quizzl — Quiz Engine Business Logic

This document describes the complete business logic of the Quizzl quiz system: how questions are defined, how users interact with them, how answers are evaluated and scored, how progress is persisted, and how quiz data flows through the application.

---

## 1. Content Architecture

### 1.1 Topics as the Top-Level Unit

All quiz content is organized into **topics**. A topic is a self-contained learning unit identified by a URL slug (e.g., `javascript-basics`, `human-biology`). Each topic bundles:

| Field         | Type             | Description                                     |
|---------------|------------------|-------------------------------------------------|
| `slug`        | `string`         | URL-safe identifier, unique across the catalogue |
| `title`       | `string`         | Human-readable name                             |
| `description` | `string`         | Short summary                                   |
| `tags`        | `string[]`       | Filterable labels (e.g., "beginner", "science") |
| `quiz`        | `QuizQuestion[]` | Ordered list of questions (all three types)     |
| `studyPlan`   | `StudyPlan`      | Structured learning steps referencing questions  |

### 1.2 Content Storage and Loading

Content is authored as **static JSON files** under `app/public/content/{language}/{slug}.json`, one file per topic per language. Currently supported languages are `en` (English) and `de` (German).

Available topic slugs are registered in a hardcoded manifest array:

```
javascript-basics | world-history | human-biology
```

**Build time** — `getStaticProps` uses `loadAllTopicsSync()` to read topic JSON from the filesystem with Node's `fs` module. This produces the full `TopicCatalogue` (a `Record<LanguageCode, Topic[]>`) that is embedded into each statically exported page.

**Runtime (dev)** — `fetchTopic()` and `fetchAllTopics()` load content via HTTP `fetch` from the public directory.

All raw JSON passes through `normalizeTopic()`, which validates required fields (`slug`, `title`, `description`) and supplies defaults for optional fields (`tags → []`, `quiz → []`, `studyPlan → { steps: [] }`).

### 1.3 Language Resolution

The topic page resolves content by current UI language with English fallback:

```
topicsByLanguage[language] → topicsByLanguage['en'] → null (404)
```

---

## 2. Question Types

Quizzl supports **three question types**, defined as a discriminated union on the `type` field.

### 2.1 Single Choice (`type: "single"`)

A classic radio-button question with exactly one correct answer.

**Schema:**

| Field             | Type       | Description                                    |
|-------------------|------------|------------------------------------------------|
| `id`              | `string`   | Unique within the topic's quiz array           |
| `type`            | `"single"` | Discriminator                                  |
| `prompt`          | `string`   | The question text shown to the user            |
| `options`         | `Option[]` | List of selectable answers (`{ id, text }`)    |
| `correctOptionId` | `string`   | The `id` of the single correct option          |
| `explanation`     | `string?`  | Optional rationale shown after answering        |

**Interaction flow:**
1. The prompt is displayed with radio buttons for each option.
2. User selects one option → answer is immediately recorded.
3. Radio buttons become disabled after selection (one attempt only).
4. Feedback is shown inline: the correct option highlights green; an incorrect selection highlights red.
5. If an `explanation` exists, it appears in the feedback alert.

**Answer record:** `{ kind: "single", optionId: string }`

### 2.2 Multiple Choice (`type: "multi"`)

A checkbox question where one or more options may be correct.

**Schema:**

| Field              | Type         | Description                                 |
|--------------------|--------------|---------------------------------------------|
| `id`               | `string`     | Unique within the topic's quiz array        |
| `type`             | `"multi"`    | Discriminator                               |
| `prompt`           | `string`     | The question text                           |
| `options`          | `Option[]`   | List of selectable answers (`{ id, text }`) |
| `correctOptionIds` | `string[]`   | IDs of all correct options                  |
| `explanation`      | `string?`    | Optional rationale shown after answering     |

**Interaction flow:**
1. The prompt is displayed with the instruction "Select all that apply".
2. User toggles checkboxes freely — no answer is recorded yet.
3. User explicitly clicks a **"Submit Answer"** button to lock in their selection.
4. The button is disabled when no checkboxes are selected.
5. After submission, checkboxes become disabled.
6. Feedback highlights each option: correct options in green, incorrectly selected options in red.
7. A score label shows partial credit earned (e.g., "Score: 2 points").

**Answer record:** `{ kind: "multi", optionIds: string[] }`

**Key difference from single choice:** Multi-choice requires an explicit submit action, because the user needs to be able to select/deselect multiple options before committing. Single choice commits immediately on selection.

### 2.3 Flashcard (`type: "flashcard"`)

A self-assessed recall card with a front (question) and back (answer).

**Schema:**

| Field   | Type          | Description                       |
|---------|---------------|-----------------------------------|
| `id`    | `string`      | Unique within the topic's quiz array |
| `type`  | `"flashcard"` | Discriminator                     |
| `front` | `string`      | The question/prompt side          |
| `back`  | `string`      | The answer/explanation side       |

**Interaction flow:**
1. Only the **front** text is shown initially.
2. User clicks **"Reveal Answer"** to show the back text (animated collapse/expand).
3. After revealing, two self-assessment buttons appear:
   - **"I didn't know it"** → records `knewIt: false`, scores 0 points.
   - **"I knew it!"** → records `knewIt: true`, scores 1 point.
4. After self-assessment, a colored feedback banner shows the result (green or red).

**Answer record:** `{ kind: "flashcard", knewIt: boolean }`

**Key difference:** Flashcards have no objectively "correct" answer — they rely on honest self-assessment. There is no `explanation` field; the back of the card serves that purpose.

---

## 3. Scoring System

### 3.1 Per-Question Scoring

Scoring is calculated by `scoreQuestion(question, answer)` in `app/src/lib/scoring.ts`.

| Question Type | Scoring Rule                                                                                          | Min | Max                          |
|---------------|-------------------------------------------------------------------------------------------------------|-----|------------------------------|
| **single**    | +1 if `answer.optionId === question.correctOptionId`, else 0                                          | 0   | 1                            |
| **multi**     | For each option: +1 if correctly selected, −1 if incorrectly selected. Result floored at 0.          | 0   | `correctOptionIds.length`    |
| **flashcard** | +1 if `answer.knewIt === true`, else 0                                                                | 0   | 1                            |

#### Multi-Choice Scoring Detail

The multi-choice scorer iterates over **all options** (not just selected ones) and applies:

```
For each option in question.options:
  if option is correct AND selected   → +1
  if option is NOT correct AND selected → −1
  if option is correct AND NOT selected → +0 (no penalty for missing)
  if option is NOT correct AND NOT selected → +0

Final score = max(0, sum)
```

This means:
- Selecting all correct options and no incorrect ones yields the maximum score.
- Selecting an incorrect option costs −1, which can cancel out a correct selection.
- The score cannot go below zero (floored).
- Not selecting a correct option is a missed opportunity but carries no penalty.

**Example:** A question with `correctOptionIds: ["a", "b", "d"]` and 4 total options. If a user selects `["a", "c"]`:
- `a` correct + selected = +1
- `b` correct + not selected = +0
- `c` not correct + selected = −1
- `d` correct + not selected = +0
- Raw sum = 0, floored = **0 points**

### 3.2 Aggregate Scoring

| Function              | Purpose                                            |
|-----------------------|----------------------------------------------------|
| `calculateTotalPoints(questions, answers)` | Sums `scoreQuestion` for all answered questions |
| `maxPossiblePoints(questions)`             | Sums maximum per question (1 for single/flashcard, `correctOptionIds.length` for multi) |
| `answeredCount(questions, answers)`        | Count of questions with a recorded answer          |
| `isQuizComplete(questions, answers)`       | True when all questions have an answer             |

### 3.3 Leaderboard Aggregation

The leaderboard page aggregates points across all **selected topics** (topics the user has added to their personal list):

```
totalPoints = sum of topicProgress.quizPoints for each selected topic
```

This is a single-player leaderboard (rank is always 1/1) — the feature is scaffolded for future multi-player support.

---

## 4. Quiz Workflow

### 4.1 Entry Points

A user reaches a quiz through one of two paths:

1. **Direct navigation:** Topics page → select a topic → Topic detail page → Quiz tab (default tab).
2. **Study plan:** Topic detail page → Study Plan tab → a quiz task references specific `questionIds`.

### 4.2 Quiz Session Flow

```
┌─────────────────────────────────────────┐
│           QUIZ IN PROGRESS              │
│                                         │
│  Progress bar:  [████░░░░░░]  3/10      │
│  Score tracker: 3/10 answered · 5 pts   │
│                                         │
│  ┌─ Question Card ─────────────────┐    │
│  │  [SINGLE CHOICE] badge          │    │
│  │                                  │    │
│  │  Which keyword declares...?      │    │
│  │  ○ var                           │    │
│  │  ● let  ← selected (green)      │    │
│  │  ○ set                           │    │
│  │  ○ def                           │    │
│  │                                  │    │
│  │  ✅ Correct!                     │    │
│  │  `let` declares a block-scoped…  │    │
│  └──────────────────────────────────┘    │
│                                         │
│  [← Previous]              [Next →]     │
└─────────────────────────────────────────┘
```

**Step-by-step:**

1. The quiz presents questions **one at a time**, indexed by `currentIndex`.
2. A **progress bar** shows `answeredCount / totalQuestions` as a percentage.
3. A **score tracker** shows `answered/total answered · N pts`.
4. A **type badge** labels the current question: "Single Choice", "Multiple Choice", or "Flashcard".
5. The user answers the question (interaction varies by type — see Section 2).
6. On answer, `onAnswer(questionId, answer, newTotalPoints)` fires, which:
   - Recalculates total points across all answers (including the new one).
   - Calls `recordAnswer()` from the `useTopicProgress` hook.
   - Persists the updated `TopicProgress` to localStorage immediately.
7. **Previous / Next** buttons allow free navigation between questions.
   - Users can revisit already-answered questions (answers are shown as read-only).
   - Users can skip ahead to unanswered questions.
   - Navigation does not reset or change answers.
8. Questions are presented in their **authored order** (array index in the JSON).

### 4.3 Quiz Completion

When `isQuizComplete()` returns true (all questions answered), the quiz tab switches to a **summary view**:

- A heading "Quiz Complete!" with the final score: `totalPoints / maxPoints points`.
- A count of questions answered.
- A per-question breakdown: each question listed with its earned points (green/neutral badge).
- A **"Retry Quiz"** button that:
  - Calls `resetQuiz()`, which clears all answers and resets `quizPoints` to 0.
  - Resets `currentIndex` to 0.
  - Persists the cleared state to localStorage.

### 4.4 Empty State

If a topic has zero quiz questions (`topic.quiz.length === 0`), the quiz tab shows a message directing the user to the Notes or Study Plan tabs instead.

---

## 5. Progress Persistence

### 5.1 Data Model

All quiz progress is stored per-topic in localStorage under the key `lp_progress_v1`.

```typescript
type Progress = {
  byTopicSlug: Record<string, TopicProgress>;
};

type TopicProgress = {
  answers: Record<string, QuizAnswer>;  // questionId → answer
  quizPoints: number;                   // cached total score
  notesHtml: string;                    // (non-quiz field)
  completedTaskIds: string[];           // (study plan field)
};
```

The `answers` map is keyed by question ID. Each value is a discriminated union:

```typescript
type QuizAnswer =
  | { kind: 'single'; optionId: string }
  | { kind: 'multi'; optionIds: string[] }
  | { kind: 'flashcard'; knewIt: boolean };
```

### 5.2 Persistence Lifecycle

| Event                  | Action                                                                  |
|------------------------|-------------------------------------------------------------------------|
| Page load              | `useTopicProgress` reads from localStorage, hydrates React state        |
| Answer a question      | `recordAnswer()` merges the new answer into state, writes to localStorage immediately |
| Retry quiz             | `resetQuiz()` clears `answers` to `{}`, sets `quizPoints` to 0, writes to localStorage |
| Switch topic           | Hook re-runs with new slug, loads that topic's progress from localStorage |

There is no debouncing or batching — every answer triggers an immediate synchronous write to localStorage. The `quizPoints` field is a cached value that is recalculated on each answer to avoid recomputation on read.

### 5.3 Hydration Guard

Because localStorage is unavailable during SSR/static export, the hook exposes a `hydrated` boolean. Until `hydrated === true`, the UI renders placeholder dashes (`—`) for all progress-dependent values and passes empty objects for answers. This prevents hydration mismatches between server-rendered and client-rendered HTML.

---

## 6. Study Plan Integration

### 6.1 Study Plan Structure

Each topic includes a `StudyPlan` with ordered `StudyStep` items, each containing `StudyTask` items.

```typescript
type StudyTask =
  | { id: string; type: 'quiz';       questionIds: string[]; title: string }
  | { id: string; type: 'flashcards'; questionIds?: string[]; title: string }
  | { id: string; type: 'notes';      title: string }
  | { id: string; type: 'custom';     title: string; description?: string };
```

### 6.2 Quiz Tasks within Study Plans

Tasks of type `quiz` and `flashcards` carry a `questionIds` array referencing specific question IDs from the same topic's quiz array. This allows the study plan to:

- Assign specific questions to specific study days/steps.
- Mix question types within a single step.
- Reference the same question in multiple tasks (e.g., a flashcard review on day 3 of a question introduced on day 1).

**Important:** Study plan tasks are tracked independently from quiz answers. Marking a quiz task as "complete" in the study plan (via checkbox toggle) does not depend on whether those questions have been answered in the quiz tab, and vice versa. They are parallel tracking systems — `completedTaskIds` for the study plan and `answers` for the quiz.

### 6.3 Study Plan Progress

Study plan progress is tracked as a flat array of completed task IDs (`completedTaskIds` in `TopicProgress`). The `toggleTask()` function adds or removes a task ID from this array, persisting immediately.

Per-step progress is calculated at render time: `completedCount / totalTasks` with a visual progress bar. A step is marked "Done" when all its tasks are complete. Overall progress aggregates across all steps.

---

## 7. Content JSON Schema Reference

Complete example showing all three question types in a single topic:

```json
{
  "slug": "example-topic",
  "title": "Example Topic",
  "description": "A demonstration of all question types.",
  "tags": ["demo"],
  "quiz": [
    {
      "id": "q1",
      "type": "single",
      "prompt": "What color is the sky on a clear day?",
      "options": [
        { "id": "a", "text": "Red" },
        { "id": "b", "text": "Blue" },
        { "id": "c", "text": "Green" }
      ],
      "correctOptionId": "b",
      "explanation": "Rayleigh scattering causes shorter blue wavelengths to scatter more."
    },
    {
      "id": "q2",
      "type": "multi",
      "prompt": "Which are primary colors in the RGB model?",
      "options": [
        { "id": "a", "text": "Red" },
        { "id": "b", "text": "Yellow" },
        { "id": "c", "text": "Green" },
        { "id": "d", "text": "Blue" }
      ],
      "correctOptionIds": ["a", "c", "d"],
      "explanation": "RGB stands for Red, Green, Blue. Yellow is a secondary color."
    },
    {
      "id": "q3",
      "type": "flashcard",
      "front": "What is the speed of light?",
      "back": "Approximately 299,792,458 meters per second in a vacuum."
    }
  ],
  "studyPlan": {
    "steps": [
      {
        "id": "step-1",
        "title": "Day 1: Light and Color",
        "description": "Learn about light, color, and optics.",
        "tasks": [
          { "id": "t1", "type": "quiz", "questionIds": ["q1", "q2"], "title": "Color quizzes" },
          { "id": "t2", "type": "flashcards", "questionIds": ["q3"], "title": "Speed of light" },
          { "id": "t3", "type": "notes", "title": "Write notes on light properties" },
          { "id": "t4", "type": "custom", "title": "Watch a video on optics" }
        ]
      }
    ]
  }
}
```

---

## 8. UI State Machine Summary

```
                    ┌──────────┐
                    │  LOADING │  (hydrated = false)
                    └────┬─────┘
                         │ localStorage read complete
                         ▼
              ┌─────────────────────┐
              │  QUIZ EMPTY?        │
              │  questions.length=0 │──yes──▶ Show empty state
              └──────────┬──────────┘
                         │ no
                         ▼
              ┌─────────────────────┐
              │  IN PROGRESS        │◀─────────────────┐
              │  currentIndex: N    │                   │
              │  Show question N    │                   │
              └──────────┬──────────┘                   │
                         │                              │
            ┌────────────┼────────────┐                 │
            ▼            ▼            ▼                 │
      ┌──────────┐ ┌──────────┐ ┌───────────┐          │
      │  SINGLE  │ │  MULTI   │ │ FLASHCARD │          │
      │ select → │ │ check →  │ │ reveal →  │          │
      │ instant  │ │ submit → │ │ self-     │          │
      │ commit   │ │ commit   │ │ assess →  │          │
      └────┬─────┘ └────┬─────┘ │ commit    │          │
           │             │       └─────┬─────┘          │
           └──────┬──────┘             │                │
                  ▼                    │                │
           recordAnswer() ◀────────────┘                │
           persist to localStorage                      │
                  │                                     │
                  ▼                                     │
           ┌──────────────┐                             │
           │ ALL ANSWERED? │──no──▶ navigate ───────────┘
           └──────┬───────┘        (prev/next)
                  │ yes
                  ▼
           ┌──────────────┐
           │   COMPLETE   │
           │ Show summary │
           │ Score: X / Y │
           │ [Retry Quiz] │──retry──▶ resetQuiz()
           └──────────────┘          clear answers
                                     currentIndex = 0
                                     ──▶ IN PROGRESS
```

---

## 9. Invariants and Constraints

1. **Question IDs must be unique within a topic's quiz array.** The `answers` map is keyed by question ID; duplicate IDs would cause one answer to overwrite another.
2. **`correctOptionId` must reference a valid option ID.** No runtime validation is performed — invalid references silently produce 0 points.
3. **`correctOptionIds` must be a non-empty subset of option IDs.** An empty array means `maxPossiblePoints` contributes 0 for that question.
4. **Answer type must match question type.** `scoreQuestion` returns 0 for mismatched types (e.g., a `single` answer applied to a `multi` question).
5. **Scores are non-negative.** Multi-choice scoring is floored at 0 — a user cannot lose points.
6. **Answers are immutable once recorded** (for single choice and flashcard). Multi-choice answers lock on submit. The only way to change answers is to retry the entire quiz.
7. **Quiz retry resets all answers**, not individual questions. There is no per-question retry.
8. **localStorage writes are synchronous and immediate.** No batching, no conflict resolution. The last write wins.
9. **The question order is fixed** — determined by the array order in the content JSON. There is no randomization.
10. **Study plan task completion is independent of quiz answers.** A user can mark a quiz task as done in the study plan without actually answering those questions, and vice versa.
