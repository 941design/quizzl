import { test, expect } from '@playwright/test';

const TOPIC_URL = '/topic/javascript-basics';

test.describe('Story 03 - Topic Page Tabs and Quiz Engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('lp_progress_v1');
    });
  });

  test('topic page renders with title, description, and tabs', async ({ page }) => {
    await page.goto(TOPIC_URL);
    await expect(page.getByRole('heading', { name: 'JavaScript Basics' })).toBeVisible();
    await expect(page.getByTestId('tab-quiz')).toBeVisible();
    await expect(page.getByTestId('tab-notes')).toBeVisible();
    await expect(page.getByTestId('tab-study-plan')).toBeVisible();
  });

  test('quiz shows first question with progress indicator', async ({ page }) => {
    await page.goto(TOPIC_URL);
    await expect(page.getByTestId('question-card')).toBeVisible();
    await expect(page.getByTestId('quiz-progress')).toBeVisible();
    await expect(page.getByTestId('question-prompt')).toBeVisible();
  });

  test('Type A (single choice): answering correctly updates score', async ({ page }) => {
    await page.goto(TOPIC_URL);

    // First question is single-choice - select correct answer (let)
    await page.getByTestId('option-b').click();

    // Feedback should appear
    await expect(page.getByTestId('question-feedback')).toBeVisible();

    // Stats should show 1 pt (answered)
    await expect(page.getByTestId('topic-stats')).toContainText('1/5 answered');
  });

  test('single choice answer persists after tab switch and return', async ({ page }) => {
    await page.goto(TOPIC_URL);

    // Answer first question
    await page.getByTestId('option-b').click();
    await expect(page.getByTestId('question-feedback')).toBeVisible();

    // Switch to Notes tab and back
    await page.getByTestId('tab-notes').click();
    await page.getByTestId('tab-quiz').click();

    // Answer should still be recorded
    await expect(page.getByTestId('question-feedback')).toBeVisible();
  });

  test('navigation: prev/next buttons move between questions', async ({ page }) => {
    await page.goto(TOPIC_URL);

    // Check question 1 is shown
    const prompt1 = await page.getByTestId('question-prompt').textContent();

    // Go to next question
    await page.getByTestId('next-question-btn').click();
    const prompt2 = await page.getByTestId('question-prompt').textContent();

    expect(prompt2).not.toBe(prompt1);

    // Go back
    await page.getByTestId('prev-question-btn').click();
    const backToPrompt1 = await page.getByTestId('question-prompt').textContent();
    expect(backToPrompt1).toBe(prompt1);
  });

  test('flashcard: reveal answer then self-assess', async ({ page }) => {
    // Navigate to question 3 (index 2) which is a flashcard
    await page.goto(TOPIC_URL);

    // Navigate to 3rd question (index 2)
    await page.getByTestId('next-question-btn').click();
    await page.getByTestId('next-question-btn').click();

    // Should show flashcard front
    await expect(page.getByTestId('flashcard-front')).toBeVisible();

    // Reveal answer
    await page.getByTestId('reveal-answer-btn').click();
    await expect(page.getByTestId('flashcard-back')).toBeVisible();

    // Self-assess "I knew it"
    await page.getByTestId('knew-it-btn').click();

    // Feedback should show
    await expect(page.getByTestId('question-feedback')).toBeVisible();
    await expect(page.getByTestId('question-feedback')).toContainText('+1');
  });

  test('Type B (multi choice): submit answer shows score feedback', async ({ page }) => {
    await page.goto(TOPIC_URL);

    // Navigate to 2nd question (multi-choice)
    await page.getByTestId('next-question-btn').click();

    // Select options a and b (two correct ones)
    await page.getByTestId('option-a').click();
    await page.getByTestId('option-b').click();

    // Submit
    await page.getByTestId('submit-multi-answer').click();

    // Feedback should show score
    await expect(page.getByTestId('question-feedback')).toBeVisible();
    await expect(page.getByTestId('question-feedback')).toContainText('point');
  });

  test('quiz completion shows summary screen with retry', async ({ page }) => {
    await page.goto(TOPIC_URL);

    // Answer all 5 questions quickly
    // Q1: single - select option b
    await page.getByTestId('option-b').click();
    await page.getByTestId('next-question-btn').click();

    // Q2: multi - select a, b, d and submit
    await page.getByTestId('option-a').click();
    await page.getByTestId('option-b').click();
    await page.getByTestId('option-d').click();
    await page.getByTestId('submit-multi-answer').click();
    await page.getByTestId('next-question-btn').click();

    // Q3: flashcard - reveal and say knew it
    await page.getByTestId('reveal-answer-btn').click();
    await page.getByTestId('knew-it-btn').click();
    await page.getByTestId('next-question-btn').click();

    // Q4: single
    await page.getByTestId('option-b').click();
    await page.getByTestId('next-question-btn').click();

    // Q5: flashcard
    await page.getByTestId('reveal-answer-btn').click();
    await page.getByTestId('knew-it-btn').click();

    // Should show completion summary
    await expect(page.getByText('Quiz Complete!')).toBeVisible();
    await expect(page.getByTestId('retry-quiz-btn')).toBeVisible();
  });

  test('quiz progress persists after page refresh', async ({ page }) => {
    await page.goto(TOPIC_URL);

    // Answer first question
    await page.getByTestId('option-b').click();

    // Refresh
    await page.reload();

    // Should still show 1 answered
    await expect(page.getByTestId('topic-stats')).toContainText('1/5 answered');
  });

  test('flashcard self-assessment persists after page refresh (AC-007)', async ({ page }) => {
    await page.goto(TOPIC_URL);

    // Navigate to flashcard question (3rd question, index 2)
    await page.getByTestId('next-question-btn').click();
    await page.getByTestId('next-question-btn').click();

    // Reveal and self-assess
    await page.getByTestId('reveal-answer-btn').click();
    await page.getByTestId('knew-it-btn').click();
    await expect(page.getByTestId('question-feedback')).toContainText('+1');

    // Refresh
    await page.reload();

    // Navigate back to the flashcard
    await page.getByTestId('next-question-btn').click();
    await page.getByTestId('next-question-btn').click();

    // Feedback should still be visible (answer persisted)
    await expect(page.getByTestId('question-feedback')).toBeVisible();
    await expect(page.getByTestId('question-feedback')).toContainText('+1');
  });
});
