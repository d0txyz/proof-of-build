import type { RepoFile, RepoSnapshot } from "./types";

export type FileKind = "doc" | "test" | "config" | "source";

const DOC = /(^|\/)(docs?|documentation)(\/|$)|\.(md|mdx|txt|rst|adoc)$/i;
const TEST = /(^|\/)(tests?|__tests__|spec|e2e)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rs)$|\.t\.sol$/i;
const CODE = /\.(m?[jt]sx?|cjs|py|rs|go|sol|java|kt|kts|rb|php|cs|c|cc|cpp|h|hpp|swift|move|cairo|vy|sh|bash|ps1|sql|lua|ex|exs|dart|scala|zig|svelte|vue|astro)$/i;

/** "source" means program code only. Config, dotfiles and data count as "config". */
export function fileKind(path: string): FileKind {
  if (DOC.test(path)) return "doc";
  if (!CODE.test(path)) return "config";
  return TEST.test(path) ? "test" : "source";
}

export type Hit = { path: string; line: number; text: string; kind: FileKind };

/** Finds a literal string, case-insensitive, and returns the lines it is on. */
export function grep(files: RepoFile[], needle: string, limit = 40): Hit[] {
  const hits: Hit[] = [];
  const lower = needle.toLowerCase();
  if (lower.length < 2) return hits;
  for (const file of files) {
    if (!file.text.toLowerCase().includes(lower)) continue;
    const kind = fileKind(file.path);
    const lines = file.text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].toLowerCase().includes(lower)) {
        hits.push({ path: file.path, line: i + 1, text: lines[i].trim().slice(0, 200), kind });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

/** Lines around a hit, for showing to the reader. */
export function snippet(file: RepoFile, line: number, radius = 3): string {
  const lines = file.text.split("\n");
  const from = Math.max(0, line - 1 - radius);
  const to = Math.min(lines.length, line + radius);
  return lines
    .slice(from, to)
    .map((text) => text.slice(0, 220))
    .join("\n");
}

const TEST_CASE: { ext: RegExp; pattern: RegExp }[] = [
  { ext: /\.(m?[jt]sx?|cjs)$/i, pattern: /^\s*(?:it|test)(?:\.(?:only|concurrent|each\b[^\n]*?\)))?\s*\(\s*[`'"]/gm },
  { ext: /\.py$/i, pattern: /^\s*(?:async\s+)?def\s+test_\w+/gm },
  { ext: /\.rs$/i, pattern: /#\[(?:tokio::|async_std::)?test[^\]]*\]/g },
  { ext: /\.go$/i, pattern: /^func\s+Test\w+\s*\(/gm },
  { ext: /\.sol$/i, pattern: /function\s+test\w*\s*\(/g },
  { ext: /\.(rb)$/i, pattern: /^\s*(?:it|test)\s+['"]/gm },
  { ext: /\.(java|kt)$/i, pattern: /@Test\b/g },
];

export type TestCount = { files: number; cases: number; byFile: { path: string; cases: number }[] };

/** Counts test cases by pattern. Table-driven tests count once, so this can undercount. */
export function countTests(files: RepoFile[]): TestCount {
  const byFile: { path: string; cases: number }[] = [];
  for (const file of files) {
    let cases = 0;
    const inTestPath = fileKind(file.path) === "test";
    for (const { ext, pattern } of TEST_CASE) {
      if (!ext.test(file.path)) continue;
      // Rust and Solidity keep tests beside the code, so count those anywhere.
      const inline = /\.(rs|sol)$/i.test(file.path);
      if (!inTestPath && !inline) continue;
      cases += (file.text.match(pattern) ?? []).length;
    }
    if (cases > 0) byFile.push({ path: file.path, cases });
  }
  byFile.sort((a, b) => b.cases - a.cases);
  return { files: byFile.length, cases: byFile.reduce((sum, f) => sum + f.cases, 0), byFile };
}

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "SERV API key", pattern: /\bserv_[0-9a-f]{24}_[0-9a-f]{32}\b/ },
  { name: "OpenAI-style API key", pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "wallet private key assignment", pattern: /PRIVATE_KEY\s*[=:]\s*["']?(?:0x)?[0-9a-fA-F]{64}\b/ },
];

export type SecretHit = { path: string; line: number; name: string };

/** Reports where a secret-shaped string sits. Never returns the value. */
export function findSecrets(files: RepoFile[]): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const file of files) {
    const base = file.path.split("/").pop() ?? "";
    if (/^\.env(\.[^.]+)?$/.test(base) && !/example|sample|template|dist/i.test(base)) {
      const hasValue = file.text.split("\n").some((line) => /^[A-Z0-9_]+\s*=\s*\S{12,}/.test(line.trim()));
      if (hasValue) {
        hits.push({ path: file.path, line: 1, name: "committed .env file with values" });
        continue;
      }
    }
    if (fileKind(file.path) === "test") continue;
    const lines = file.text.split("\n");
    for (let i = 0; i < lines.length && hits.length < 20; i += 1) {
      for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(lines[i]) && !/example|placeholder|your[_-]|xxxx|0{16,}|dummy|fake|test/i.test(lines[i])) {
          hits.push({ path: file.path, line: i + 1, name });
          break;
        }
      }
    }
  }
  return hits;
}

export function findReadme(snapshot: Pick<RepoSnapshot, "files">): RepoFile | null {
  const candidates = snapshot.files.filter((f) => /^readme(\.[a-z]+)?$/i.test(f.path));
  return candidates.find((f) => /\.md$/i.test(f.path)) ?? candidates[0] ?? null;
}

const DEMO_HOST =
  /(vercel\.app|netlify\.app|onrender\.com|fly\.dev|github\.io|workers\.dev|pages\.dev|railway\.app|herokuapp\.com|web\.app|firebaseapp\.com|surge\.sh|replit\.app|streamlit\.app|hf\.space)$/i;
const VIDEO_HOST = /(youtube\.com|youtu\.be|loom\.com|vimeo\.com|drive\.google\.com|streamable\.com)$/i;
const NOT_DEMO_HOST =
  /(github\.com|githubusercontent\.com|shields\.io|npmjs\.com|x\.com|twitter\.com|t\.me|discord\.(gg|com)|typeform\.com|openserv\.ai|docs\.[a-z0-9-]+\.[a-z]+|wikipedia\.org|opensource\.org|localhost)$/i;

/** An API base address or endpoint is not a page a person opens. */
export function isApiUrl(url: URL): boolean {
  return /^(api|inference|rpc|gateway)[.-]|inference-api/i.test(url.hostname) || /(^|\/)(v\d+|api|rpc|sse|webhooks?|graphql|mcp)(\/|$)|\.(json|ya?ml|svg|png)$/i.test(url.pathname);
}

/** Decides how a link named in a claim should be treated. */
export function claimLinkKind(raw: string): "demo" | "video" | "other" {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (VIDEO_HOST.test(host)) return "video";
    if (NOT_DEMO_HOST.test(host) || isApiUrl(url)) return "other";
    return "demo";
  } catch {
    return "other";
  }
}

export type FoundLink = { url: string; kind: "demo" | "video" | "other"; context: string };

/** Pulls links out of a write-up and guesses which are the demo and the video. */
export function extractLinks(text: string, homepage: string | null): FoundLink[] {
  const found = new Map<string, FoundLink>();
  const add = (raw: string, context: string, forced?: "demo") => {
    let url: URL;
    try {
      url = new URL(raw.replace(/[).,;'"`>\]]+$/, ""));
    } catch {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    const host = url.hostname.toLowerCase();
    if (NOT_DEMO_HOST.test(host) && !forced) return;
    const key = url.toString();
    if (found.has(key)) return;
    const labelled = /\b(live|demo|try it|play it|app|website|hosted|deployed)\b/i.test(context);
    const kind = VIDEO_HOST.test(host) ? "video" : isApiUrl(url) ? "other" : forced || DEMO_HOST.test(host) || labelled ? "demo" : "other";
    found.set(key, { url: key, kind, context: context.trim().slice(0, 160) });
  };

  if (homepage) add(homepage, "repo homepage", "demo");
  for (const line of text.split("\n")) {
    for (const match of line.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) add(match[0], line);
  }
  return [...found.values()];
}

const REVIEWER_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|earlier|above|all|any|your)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?)/i,
  /\b(ai|llm|automated|language model)\s+(judge|reviewer|evaluator|grader|assistant|agent)s?\s*[:,]/i,
  /\bnote\s+(to|for)\s+(the\s+)?(ai|llm|a\.i\.|judge|reviewer|evaluator|grader|model)\b/i,
  /\b(if|when)\s+you\s+are\s+an?\s+(ai|llm|language model|automated)/i,
  /\b(give|award|assign|rate|score|rank)\b[^.\n]{0,40}\b(10\s*\/\s*10|100\s*\/\s*100|full marks|highest|maximum|top)\s*(score|marks|rating|rank|points)?/i,
  /\bmark\s+(this|every|all|each)\b[^.\n]{0,40}\b(verified|as verified|as passed|approved)/i,
  /\bsystem\s*prompt\s*[:=]/i,
];

export type ReviewerHit = { line: string; quoted: boolean };

/** Finds text that reads like an instruction to an automated reviewer, and says whether it sits inside quotes. */
export function findReviewerHit(text: string): ReviewerHit | null {
  let quotedHit: ReviewerHit | null = null;
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const plain = line.replace(/<!--|-->/g, " ");
    for (const pattern of REVIEWER_PATTERNS) {
      const match = pattern.exec(plain);
      if (!match) continue;
      const before = plain.slice(0, match.index);
      const marks = (before.match(/["“”`*]/g) ?? []).length;
      const quoted = fenced || /^\s*(>|\|)/.test(plain) || marks % 2 === 1 || /["“`']\s*$/.test(before);
      const hit = { line: plain.trim().slice(0, 200), quoted };
      if (!quoted) return hit;
      quotedHit ??= hit;
    }
  }
  return quotedHit;
}

export function findReviewerText(text: string): string | null {
  return findReviewerHit(text)?.line ?? null;
}

/** Hidden HTML comments in a README are invisible on GitHub but visible to a model. */
export function hiddenComments(text: string): string[] {
  return [...text.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1].trim()).filter((c) => c.length > 0);
}

const STOP = new Set(
  "about above after again against also another around because before being below between both built cannot could does doing down during each every from further have having here into itself just more most only other over same should some such than that their them then there these they this those through under until very were what when where which while will with within without would your using uses used runs through real every across agent agents project".split(" "),
);

/** Reduces a word to a rough stem so "retries" finds "retry" and "settles" finds "settle". */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 5 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -1);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

export function keyTerms(texts: string[], max = 10): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const raw of text.split(/[^A-Za-z0-9_.-]+/)) {
      const word = raw.replace(/^[.-]+|[.-]+$/g, "");
      if (word.length < 4 || STOP.has(word.toLowerCase()) || /^\d+$/.test(word)) continue;
      const s = stem(word);
      if (s.length >= 3 && !out.includes(s)) out.push(s);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export type Window = { path: string; line: number; score: number; text: string };

/** Short terms must stand alone ("serv" must not match "server"). Longer ones may sit inside an identifier. */
export function termMatcher(term: string): (line: string) => boolean {
  const t = term.toLowerCase();
  if (t.length >= 5) return (line) => line.includes(t);
  const pattern = new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`);
  return (line) => pattern.test(line);
}

/**
 * Finds the places in source files where the most of a claim's terms sit close together.
 * `strong` terms (the reader's own search terms) count double.
 */
export function bestWindows(files: RepoFile[], strong: string[], weak: string[], max = 3, radius = 4): Window[] {
  const terms = [...strong.map((t) => ({ t, w: 2 })), ...weak.filter((t) => !strong.includes(t)).map((t) => ({ t, w: 1 }))].map((x) => ({ ...x, match: termMatcher(x.t) }));
  if (terms.length === 0) return [];
  const found: Window[] = [];
  for (const file of files) {
    if (fileKind(file.path) !== "source") continue;
    const lines = file.text.toLowerCase().split("\n");
    const perLine = lines.map((l) => terms.map(({ match }) => match(l)));
    let best: Window | null = null;
    for (let i = 0; i < lines.length; i += 1) {
      if (!perLine[i].some(Boolean)) continue;
      let score = 0;
      for (let k = 0; k < terms.length; k += 1) {
        let hit = false;
        for (let j = Math.max(0, i - radius); j <= Math.min(lines.length - 1, i + radius) && !hit; j += 1) hit = perLine[j][k];
        if (hit) score += terms[k].w;
      }
      if (!best || score > best.score) best = { path: file.path, line: i + 1, score, text: snippet(file, i + 1, radius) };
    }
    if (best) found.push(best);
  }
  // One matching word is enough to show the reader a place. The reader and the line check decide the rest.
  return found.sort((a, b) => b.score - a.score).slice(0, max);
}

/** True when a line is program code rather than a comment, a label or a sentence of UI copy. */
export function looksLikeCode(line: string): boolean {
  const trimmed = line.trim();
  if (/^(\/\/|#|\*|\/\*|<!--|--|;|\||- )/.test(trimmed)) return false;
  // A line of markup is interface text, not logic.
  if (/^<\/?[A-Za-z]/.test(trimmed)) return false;
  const bare = trimmed.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  return /[A-Za-z_$][\w$.]*\s*\(|=>|[^=!<>]=[^=]|\b(return|if|for|while|await|function|def|fn|func|class|match|switch)\b/.test(bare);
}

/** An import shows a dependency is wired in. It does not show a feature being done. */
export function isImportLine(line: string): boolean {
  return /^\s*(import\b|from\s+\S+\s+import\b|export\s+\*\s+from\b|use\s+[\w:]+|#include\b|(const|let|var)\s+[\w{}\s,]+=\s*require\()/.test(line);
}

/** Removes HTML comments. They do not show on a rendered page, so a reader should not see them either. */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, " ");
}
