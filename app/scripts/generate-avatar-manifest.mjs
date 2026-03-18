import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'http://wp10665333.server-he.de';
const SEARCH_URL = `${BASE_URL}/cgi/search`;
const PAGE_SIZE = 500;
const CONCURRENCY = 8;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.json();
}

function readTextChunks(buffer) {
  const signatureLength = 8;
  const metadata = {};
  let offset = signatureLength;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > buffer.length) {
      break;
    }

    if (type === 'tEXt') {
      const chunk = buffer.subarray(dataStart, dataEnd);
      const separatorIndex = chunk.indexOf(0);

      if (separatorIndex > 0) {
        const key = chunk.toString('latin1', 0, separatorIndex);
        const value = chunk.toString('latin1', separatorIndex + 1).trim();
        metadata[key] = value;
      }
    }

    offset = dataEnd + 4;
    if (type === 'IEND') {
      break;
    }
  }

  return metadata;
}

function normalizeAccessories(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

async function listAllAvatarUrls() {
  const urls = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchJson(`${SEARCH_URL}?limit=${PAGE_SIZE}&offset=${offset}`);
    if (!Array.isArray(page.items) || page.items.length === 0) {
      return urls;
    }

    urls.push(...page.items.map((item) => item.url));
  }
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

async function buildManifest() {
  const urls = await listAllAvatarUrls();

  const items = await mapWithConcurrency(
    urls,
    async (relativeUrl, index) => {
      const response = await fetch(`${BASE_URL}${relativeUrl}`);
      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`Skipping missing avatar ${relativeUrl}`);
          return null;
        }

        throw new Error(`Failed to fetch ${relativeUrl}: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const metadata = readTextChunks(buffer);
      const fileName = relativeUrl.split('/').pop() ?? '';

      const subject = metadata.var_subject?.trim();
      if (!subject) {
        throw new Error(`Missing var_subject in ${relativeUrl}`);
      }

      return {
        id: fileName.replace(/\.png$/i, ''),
        imageUrl: `${BASE_URL}${relativeUrl}`,
        subject,
        accessories: normalizeAccessories(metadata.var_accessories),
        sortOrder: index,
      };
    },
    CONCURRENCY
  );

  const validItems = items.filter((item) => item !== null);

  const manifest = {
    generatedAt: new Date().toISOString(),
    total: validItems.length,
    subjects: Array.from(new Set(validItems.map((item) => item.subject))).sort((left, right) =>
      left.localeCompare(right)
    ),
    accessories: Array.from(
      new Set(validItems.flatMap((item) => item.accessories))
    ).sort((left, right) => left.localeCompare(right)),
    items: validItems,
  };

  const outputPath = path.join(process.cwd(), 'src', 'data', 'avatarManifest.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`Wrote ${manifest.total} avatars to ${outputPath}`);
}

buildManifest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
