import type { Command } from "./types";

// Subsequence-based fuzzy match: every character of `query` must appear
// in `target`, in order, case-insensitively -- but *not* necessarily
// contiguously ("cmdp" still matches "Command Palette"). Returns `null`
// for no match at all; otherwise a score where higher is a better match.
//
// A plain substring/`includes()` filter was the easy path here, but the
// task calls out that it hides ranking problems that only show up once
// there are many more commands to search over (M3+) -- so this scores,
// rather than just filters, on:
//  - contiguous runs (a run of N consecutive matched chars is worth more
//    than N separate isolated ones)
//  - word-boundary starts (start of string, after a space/-/_//, or a
//    lower-to-upper camelCase transition) -- rewards e.g. "op" matching
//    the "O" and "P" of "Open Project" over matching two letters buried
//    mid-word
//  - an earlier first-match position
//  - a shorter overall target, as a final tie-breaker (prefer the more
//    precise/specific title when two commands match equally well)
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

// Empty query: alphabetical, so the palette isn't just "whatever order
// commands happened to register in" before the user types anything.
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
