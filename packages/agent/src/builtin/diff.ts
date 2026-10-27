import type { FileDiff } from "@bochica/shared";

// A small line diff for the activity log: how many lines a write added and removed, and a
// short unified patch to show when the row is expanded.

const CONTEXT = 2;
/** Above this many line pairs the middle is reported as replaced, without aligning it. */
const MAX_CELLS = 2_000_000;
const MAX_PATCH_LINES = 200;

type Op = { kind: " " | "-" | "+"; text: string; oldLine: number; newLine: number };

function lines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r?\n$/, "").split(/\r?\n/);
}

function align(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: " ", text: a[i] ?? "", oldLine: i, newLine: i });
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_CELLS) {
    midA.forEach((text, i) => ops.push({ kind: "-", text, oldLine: start + i, newLine: start }));
    midB.forEach((text, j) => ops.push({ kind: "+", text, oldLine: endA, newLine: start + j }));
  } else {
    // Longest common subsequence, filled from the end so the walk below goes forwards.
    const lcs = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * (m + 1) + j] =
          midA[i] === midB[j]
            ? (lcs[(i + 1) * (m + 1) + j + 1] ?? 0) + 1
            : Math.max(lcs[(i + 1) * (m + 1) + j] ?? 0, lcs[i * (m + 1) + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push({ kind: " ", text: midA[i] ?? "", oldLine: start + i, newLine: start + j });
        i++;
        j++;
      } else if (
        i < n &&
        (j >= m || (lcs[(i + 1) * (m + 1) + j] ?? 0) >= (lcs[i * (m + 1) + j + 1] ?? 0))
      ) {
        // Removed lines first, as in any unified diff.
        ops.push({ kind: "-", text: midA[i] ?? "", oldLine: start + i, newLine: start + j });
        i++;
      } else {
        ops.push({ kind: "+", text: midB[j] ?? "", oldLine: start + i, newLine: start + j });
        j++;
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ kind: " ", text: a[endA + k] ?? "", oldLine: endA + k, newLine: endB + k });
  }
  return ops;
}

/** The diff between two versions of a file; `before` is "" for a new file. */
export function diffFiles(path: string, before: string, after: string): FileDiff {
  const ops = align(lines(before), lines(after));
  const added = ops.filter((op) => op.kind === "+").length;
  const removed = ops.filter((op) => op.kind === "-").length;

  const patch: string[] = [];
  let k = 0;
  while (k < ops.length && patch.length < MAX_PATCH_LINES) {
    if (ops[k]?.kind === " ") {
      k++;
      continue;
    }
    // A hunk: the change plus context, merging changes closer than twice the context.
    const from = Math.max(0, k - CONTEXT);
    let to = k;
    while (to < ops.length) {
      let next = to;
      while (next < ops.length && ops[next]?.kind === " ") next++;
      if (next >= ops.length || next - to > CONTEXT * 2) break;
      while (next < ops.length && ops[next]?.kind !== " ") next++;
      to = next;
    }
    const end = Math.min(ops.length, to + CONTEXT);
    const hunk = ops.slice(from, end);
    const first = hunk[0];
    const oldCount = hunk.filter((op) => op.kind !== "+").length;
    const newCount = hunk.filter((op) => op.kind !== "-").length;
    patch.push(
      `@@ -${(first?.oldLine ?? 0) + 1},${oldCount} +${(first?.newLine ?? 0) + 1},${newCount} @@`,
    );
    for (const op of hunk) patch.push(`${op.kind}${op.text}`);
    k = end;
  }
  const truncated = patch.length >= MAX_PATCH_LINES;
  return {
    path,
    added,
    removed,
    patch: patch.slice(0, MAX_PATCH_LINES).join("\n") + (truncated ? "\n…" : ""),
  };
}
