export interface HighlightRange {
  start: number;
  end: number;
}

interface NormalizedMap {
  normalized: string;
  indexMap: number[];
}

function stripLeadingOrder(text: string): string {
  return text
    .trim()
    .replace(/^[\[(（【]?\s*[0-9A-Za-z一二三四五六七八九十]+\s*[\])）】、.．:：-]+\s*/, '')
    .trim();
}

function normalizeWhitespaceWithMap(text: string): NormalizedMap {
  let normalized = '';
  const indexMap: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (/\s/.test(char)) {
      if (!lastWasSpace && normalized.length > 0) {
        normalized += ' ';
        indexMap.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    normalized += char;
    indexMap.push(i);
    lastWasSpace = false;
  }

  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    indexMap.pop();
  }

  return { normalized, indexMap };
}

function normalizeLooseWithMap(text: string): NormalizedMap {
  let normalized = '';
  const indexMap: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (/[\u4e00-\u9fa5A-Za-z0-9]/.test(char)) {
      normalized += char.toLowerCase();
      indexMap.push(i);
    }
  }

  return { normalized, indexMap };
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function buildSnippetCandidates(snippet: string | null | undefined): string[] {
  const rawSnippet = snippet?.trim();
  if (!rawSnippet) return [];

  const cleaned = stripLeadingOrder(rawSnippet);
  const fragments = cleaned
    .split(/(?:\r?\n|[。！？!?；;]|\.{3,}|…+)/)
    .map((item) => stripLeadingOrder(item))
    .filter((item) => item.length >= 8);

  return uniqueStrings([cleaned, rawSnippet, ...fragments]).sort((a, b) => b.length - a.length);
}

function tryMatchRange(content: string, candidate: string): HighlightRange | null {
  const trimmedCandidate = stripLeadingOrder(candidate);
  if (!trimmedCandidate) return null;

  const directIndex = content.indexOf(trimmedCandidate);
  if (directIndex >= 0) {
    return { start: directIndex, end: directIndex + trimmedCandidate.length };
  }

  const contentSpaceMap = normalizeWhitespaceWithMap(content);
  const candidateSpaceMap = normalizeWhitespaceWithMap(trimmedCandidate);
  if (candidateSpaceMap.normalized) {
    const normalizedIndex = contentSpaceMap.normalized.indexOf(candidateSpaceMap.normalized);
    if (normalizedIndex >= 0) {
      const start = contentSpaceMap.indexMap[normalizedIndex];
      const lastCharIndex = normalizedIndex + candidateSpaceMap.normalized.length - 1;
      const end = (contentSpaceMap.indexMap[lastCharIndex] ?? start) + 1;
      return { start, end };
    }
  }

  const contentLooseMap = normalizeLooseWithMap(content);
  const candidateLooseMap = normalizeLooseWithMap(trimmedCandidate);
  if (candidateLooseMap.normalized.length >= 8) {
    const looseIndex = contentLooseMap.normalized.indexOf(candidateLooseMap.normalized);
    if (looseIndex >= 0) {
      const start = contentLooseMap.indexMap[looseIndex];
      const lastCharIndex = looseIndex + candidateLooseMap.normalized.length - 1;
      const end = (contentLooseMap.indexMap[lastCharIndex] ?? start) + 1;
      return { start, end };
    }
  }

  return null;
}

export function findHighlightRange(content: string, snippet: string | null | undefined): HighlightRange | null {
  if (!content) return null;

  const candidates = buildSnippetCandidates(snippet);
  for (const candidate of candidates) {
    const matchedRange = tryMatchRange(content, candidate);
    if (matchedRange) {
      return matchedRange;
    }
  }

  return null;
}

export function pickSearchSnippet(snippet: string | null | undefined): string {
  return buildSnippetCandidates(snippet)[0] || snippet?.trim() || '';
}
