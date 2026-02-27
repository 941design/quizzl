import type { Topic } from '@/src/types';

// Content is loaded from /public/content/*.json at runtime
// For a static export, we load all topic slugs at build time via getStaticProps
// and fetch each JSON file. In dev/runtime, we load via fetch.

// List of all bundled topic slugs (must match filenames in /public/content/)
export const TOPIC_SLUGS: string[] = [
  'javascript-basics',
  'world-history',
  'human-biology',
];

/**
 * Fetch and validate a topic by slug.
 * Returns null if topic not found or invalid.
 */
export async function fetchTopic(slug: string): Promise<Topic | null> {
  try {
    const res = await fetch(`/content/${slug}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return normalizeTopic(data);
  } catch {
    return null;
  }
}

/**
 * Fetch all available topics.
 */
export async function fetchAllTopics(): Promise<Topic[]> {
  const results = await Promise.all(TOPIC_SLUGS.map(fetchTopic));
  return results.filter((t): t is Topic => t !== null);
}

/**
 * Normalize raw JSON data into the Topic type.
 * Provides defaults for optional fields.
 */
export function normalizeTopic(raw: unknown): Topic | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  if (
    typeof obj.slug !== 'string' ||
    typeof obj.title !== 'string' ||
    typeof obj.description !== 'string'
  ) {
    return null;
  }

  return {
    slug: obj.slug,
    title: obj.title,
    description: obj.description,
    tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : [],
    quiz: Array.isArray(obj.quiz) ? obj.quiz as Topic['quiz'] : [],
    studyPlan: (obj.studyPlan as Topic['studyPlan']) ?? { steps: [] },
  };
}

/**
 * Load topics for getStaticProps.
 * Uses fs/path to read from public directory at build time.
 */
export function loadAllTopicsSync(): Topic[] {
  // This function is only usable server-side (in getStaticProps)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path');

  const contentDir = path.join(process.cwd(), 'public', 'content');
  const topics: Topic[] = [];

  for (const slug of TOPIC_SLUGS) {
    try {
      const filePath = path.join(contentDir, `${slug}.json`);
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const topic = normalizeTopic(raw);
      if (topic) topics.push(topic);
    } catch {
      // Skip invalid topics
    }
  }

  return topics;
}
