import type { Command } from "./types";

// Subsequence match (chars of `query` appear in `target`, in order, not necessarily contiguous), scored by contiguous-run length, word-boundary starts, earlier first-match, and shorter target -- not a plain substring filter, so ranking stays meaningful as more commands are added.
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let score = 0;
  let searchFrom = 0;
  let consecutiveRun = 0;
  let firstMatchIndex = -1;

  for (let qi = 0; qi < q.length; qi++) {
    const matchIndex = t.indexOf(q[qi], searchFrom);
    if (matchIndex === -1) return null;

    if (firstMatchIndex === -1) firstMatchIndex = matchIndex;

    const isContiguous = matchIndex === searchFrom;
    consecutiveRun = isContiguous ? consecutiveRun + 1 : 1;
    score += isContiguous ? 3 + consecutiveRun : 1;

    const prevChar = target[matchIndex - 1];
    const atWordBoundary =
      matchIndex === 0 ||
      prevChar === " " ||
      prevChar === "-" ||
      prevChar === "_" ||
      prevChar === "/" ||
      (/[a-z]/.test(prevChar ?? "") && /[A-Z]/.test(target[matchIndex] ?? ""));
    if (atWordBoundary) score += 4;

    searchFrom = matchIndex + 1;
  }

  score -= firstMatchIndex * 0.5;
  score -= (t.length - q.length) * 0.05;
  return score;
}

export interface RankedCommand {
  command: Command;
  score: number;
}

// Empty query: alphabetical, not registration order.
export function rankCommands(commands: Command[], query: string): RankedCommand[] {
  if (query.trim().length === 0) {
    return [...commands]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((command) => ({ command, score: 0 }));
  }

  const ranked: RankedCommand[] = [];
  for (const command of commands) {
    const score = fuzzyScore(query, command.title);
    if (score !== null) ranked.push({ command, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
