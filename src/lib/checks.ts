import { permalink } from "./github";
import { fileKind, findReviewerHit, findReviewerText, grep, hiddenComments, type Hit, type SecretHit } from "./scan";
import type { AuditResult, Declared, Evidence, LinkCheck, ReaderInfo, RepoSnapshot, RuleCheck, Ruleset } from "./types";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export type WindowStats = Pick<AuditResult["stats"], "commits" | "commitsInWindow" | "commitsBefore" | "commitsAfter" | "firstCommit" | "lastCommit">;

export function windowStats(snapshot: RepoSnapshot, ruleset: Ruleset): WindowStats {
  const start = Date.parse(ruleset.start);
  const end = Date.parse(ruleset.end);
  let before = 0;
  let inside = 0;
  let after = 0;
  for (const commit of snapshot.commits) {
    const t = Date.parse(commit.date);
    if (t < start) before += 1;
    else if (t > end) after += 1;
    else inside += 1;
  }
  const dates = snapshot.commits.map((c) => c.date).sort();
  return {
    commits: snapshot.commits.length,
    commitsInWindow: inside,
    commitsBefore: before,
    commitsAfter: after,
    firstCommit: dates[0] ?? null,
    lastCommit: dates[dates.length - 1] ?? null,
  };
}

export function checkPublic(snapshot: RepoSnapshot, ruleset: Ruleset): RuleCheck {
  return {
    id: "public",
    label: "Public repo",
    status: snapshot.isPublic ? "pass" : "fail",
    note: snapshot.isPublic
      ? `Anyone can open it. ${snapshot.license ? `License: ${snapshot.license}.` : "No license file was detected."}`
      : "The repo is private.",
    rule: ruleset.quotes.public,
    evidence: [{ label: `${snapshot.owner}/${snapshot.repo}`, url: snapshot.url || undefined }],
  };
}

export function checkWindow(snapshot: RepoSnapshot, ruleset: Ruleset, declared: Declared, now: Date): RuleCheck {
  const stats = windowStats(snapshot, ruleset);
  const base = { id: "window" as const, label: "Built in the window", rule: ruleset.quotes.window };
  const windowLink: Evidence = {
    label: "Commits inside the window",
    url: snapshot.url ? `${snapshot.url}/commits?since=${ruleset.start.slice(0, 10)}&until=${ruleset.end.slice(0, 10)}` : undefined,
  };
  const created: Evidence = { label: `Repo created on GitHub: ${day(snapshot.createdAt)}`, detail: "Set by GitHub. It cannot be backdated." };

  if (stats.commits === 0) return { ...base, status: "unknown", note: "The repo has no commits to read.", evidence: [created] };

  const span = `First commit ${day(stats.firstCommit!)}, last ${day(stats.lastCommit!)}.`;
  const more = snapshot.commitsTruncated ? " The history is longer than the 500 commits read here." : "";
  const late =
    stats.commitsAfter > 0 && now.getTime() > Date.parse(ruleset.end)
      ? ` ${stats.commitsAfter} ${stats.commitsAfter === 1 ? "commit is" : "commits are"} dated after the deadline, so the repo is not the version that was submitted.`
      : "";
  const evidence = [windowLink, created];

  if (declared === "existing") {
    if (stats.commitsInWindow === 0) {
      return { ...base, status: "fail", note: `Entered as an existing project with new work, but no commit is dated inside the window. ${span}${more}`, evidence };
    }
    return {
      ...base,
      status: late ? "warn" : "pass",
      note: `${stats.commitsInWindow} of ${stats.commits} commits are dated inside the window. Those are the new work to judge. ${span}${late}${more}`,
      evidence,
    };
  }

  if (stats.commitsBefore > 0) {
    const share = stats.commitsBefore / stats.commits;
    const heavy = share > 0.1 || stats.commitsBefore >= 3;
    const lead = declared === "new" ? "Entered as a new project, but" : "It was not stated whether this is new or existing, and";
    return {
      ...base,
      status: declared === "new" && heavy ? "fail" : "warn",
      note: `${lead} ${stats.commitsBefore} of ${stats.commits} commits are dated before the window opened. ${span}${late}${more}`,
      evidence,
    };
  }

  const createdEarly = Date.parse(snapshot.createdAt) < Date.parse(ruleset.start) - 24 * 3600 * 1000;
  if (createdEarly) {
    return {
      ...base,
      status: "warn",
      note: `Every commit is dated inside the window, but GitHub created the repo on ${day(snapshot.createdAt)}, before it opened. ${span}${late}`,
      evidence,
    };
  }
  if (stats.commits <= 2) {
    return {
      ...base,
      status: "warn",
      note: `Only ${stats.commits} ${stats.commits === 1 ? "commit" : "commits"}, dated inside the window. That shows when the code was pushed, not when it was written. ${span}${late}`,
      evidence,
    };
  }
  return {
    ...base,
    status: late ? "warn" : "pass",
    note: `All ${stats.commits - stats.commitsAfter} commits up to the deadline are dated inside the window. ${span}${late}${more}`,
    evidence,
  };
}

function hitEvidence(snapshot: RepoSnapshot, hits: Hit[], max = 5): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const hit of hits) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    out.push({ label: `${hit.path}:${hit.line}`, url: permalink(snapshot, hit.path, hit.line), detail: hit.text });
    if (out.length >= max) break;
  }
  return out;
}

export type TechFinding = { status: RuleCheck["status"]; sourceHits: Hit[]; otherHits: Hit[] };

export function findTech(snapshot: RepoSnapshot, ruleset: Ruleset): TechFinding {
  const sourceHits: Hit[] = [];
  const otherHits: Hit[] = [];
  for (const pattern of ruleset.strongPatterns) {
    for (const hit of grep(snapshot.files, pattern, 30)) {
      (hit.kind === "source" || hit.kind === "test" ? sourceHits : otherHits).push(hit);
    }
  }
  if (sourceHits.length > 0) return { status: "pass", sourceHits, otherHits };
  const weakSource: Hit[] = [];
  for (const pattern of ruleset.weakPatterns) {
    for (const hit of grep(snapshot.files, pattern, 20)) {
      (hit.kind === "source" ? weakSource : otherHits).push(hit);
    }
  }
  if (weakSource.length > 0 || otherHits.length > 0) return { status: "warn", sourceHits: weakSource, otherHits };
  return { status: "fail", sourceHits: [], otherHits: [] };
}

export function checkTech(snapshot: RepoSnapshot, ruleset: Ruleset, finding: TechFinding): RuleCheck {
  const base = { id: "tech" as const, label: `Uses ${ruleset.requiredTech}`, rule: ruleset.quotes.tech };
  if (snapshot.files.length === 0) {
    return { ...base, status: "unknown", note: snapshot.codeNote ?? "The source could not be read.", evidence: [] };
  }
  if (ruleset.strongPatterns.length === 0) {
    return { ...base, status: "unknown", note: "No strings were given to look for.", evidence: [] };
  }
  if (finding.status === "pass") {
    const files = new Set(finding.sourceHits.map((h) => h.path)).size;
    return {
      ...base,
      status: "pass",
      note: `Call sites found in ${files} source ${files === 1 ? "file" : "files"}.`,
      evidence: hitEvidence(snapshot, finding.sourceHits),
    };
  }
  if (finding.status === "warn") {
    const inSource = finding.sourceHits.length > 0;
    return {
      ...base,
      status: "warn",
      note: inSource
        ? "The key name appears in the code, but no call to the API was found. The address may be set outside the repo."
        : "It is named in the docs or config, but no call site was found in the source files.",
      evidence: hitEvidence(snapshot, [...finding.sourceHits, ...finding.otherHits]),
    };
  }
  return {
    ...base,
    status: "fail",
    note: `No trace of ${ruleset.requiredTech} in the repo at this commit. If the calls live in another repo, ask for it.`,
    evidence: [],
  };
}

export function checkDemo(links: LinkCheck[], ruleset: Ruleset): RuleCheck {
  const base = { id: "demo" as const, label: "Demo link or video", rule: ruleset.quotes.demo };
  const shown = links.filter((l) => l.kind !== "other");
  const evidence: Evidence[] = shown.map((l) => ({ label: l.url.replace(/^https?:\/\//, "").slice(0, 70), url: l.url, detail: l.note }));
  if (shown.length === 0) {
    return { ...base, status: "warn", note: "No demo link or video was found in the write-up or the repo's homepage field. It may be in the submission form.", evidence };
  }
  const live = shown.filter((l) => l.ok);
  if (live.length === 0) {
    return { ...base, status: "fail", note: `${shown.length === 1 ? "The link does" : `None of the ${shown.length} links`} not answer right now.`, evidence };
  }
  const dead = shown.length - live.length;
  return {
    ...base,
    status: dead > 0 ? "warn" : "pass",
    note: dead > 0 ? `${live.length} of ${shown.length} links answer. ${dead} did not.` : `${live.length === 1 ? "The link answers" : `All ${live.length} links answer`}. This shows a page is up, not that the product works.`,
    evidence,
  };
}

export function checkWriteup(writeup: string, ruleset: Ruleset, readerTrack: string | null): RuleCheck {
  const base = { id: "writeup" as const, label: "Write-up covers what was asked", rule: ruleset.quotes.writeup };
  if (writeup.trim().length < 80) {
    return { ...base, status: "fail", note: "There is no README or write-up to read.", evidence: [] };
  }
  const trackNames = ruleset.tracks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const trackMatch = trackNames
    ? (writeup.match(new RegExp(`\\b(${trackNames})\\s+track\\b`, "i")) ?? writeup.match(new RegExp(`\\btrack\\b[^\\n]{0,24}\\b(${trackNames})\\b`, "i")))
    : null;
  const track = trackMatch?.[1] ?? readerTrack;
  const namesTech = [ruleset.requiredTech, ...ruleset.strongPatterns].some((p) => writeup.toLowerCase().includes(p.toLowerCase()));
  const missing: string[] = [];
  if (ruleset.tracks.length > 0 && !track) missing.push("which track it entered");
  if (!namesTech) missing.push(`how it uses ${ruleset.requiredTech}`);
  if (missing.length === 0) {
    return { ...base, status: "pass", note: `${track ? `Names its track (${track}) and` : "It"} says how it uses ${ruleset.requiredTech}.`, evidence: [] };
  }
  return { ...base, status: "warn", note: `The write-up does not say ${missing.join(" or ")}.`, evidence: [] };
}

export function checkSecrets(snapshot: RepoSnapshot, secrets: SecretHit[]): RuleCheck {
  const base = { id: "secrets" as const, label: "No secrets committed" };
  if (snapshot.files.length === 0) return { ...base, status: "unknown", note: snapshot.codeNote ?? "The source could not be read.", evidence: [] };
  if (secrets.length === 0) return { ...base, status: "pass", note: "No key-shaped strings or filled .env files were found.", evidence: [] };
  return {
    ...base,
    status: "fail",
    note: `${secrets.length} secret-shaped ${secrets.length === 1 ? "string is" : "strings are"} in the repo. Tell the author to rotate ${secrets.length === 1 ? "it" : "them"}. Values are not shown here.`,
    evidence: secrets.slice(0, 5).map((s) => ({ label: `${s.path}:${s.line}`, url: permalink(snapshot, s.path, s.line), detail: s.name })),
  };
}

export function checkReviewer(sources: { name: string; text: string }[], reader: ReaderInfo, readerQuote: string | null): RuleCheck {
  const base = { id: "reviewer" as const, label: "Written for people, not for an AI judge" };
  for (const source of sources) {
    for (const comment of hiddenComments(source.text)) {
      const hit = findReviewerText(comment);
      if (hit) {
        return {
          ...base,
          status: "fail",
          note: `The ${source.name} hides an instruction to an automated reviewer inside an HTML comment, which does not show on the rendered page.`,
          evidence: [{ label: "Hidden text", detail: hit }],
        };
      }
    }
  }
  let quotedLine: { name: string; line: string } | null = null;
  for (const source of sources) {
    const hit = findReviewerHit(source.text);
    if (hit && !hit.quoted) {
      return {
        ...base,
        status: "warn",
        note: `The ${source.name} contains a line that reads like an instruction to an automated reviewer. Read it yourself.`,
        evidence: [{ label: "The line", detail: hit.line }],
      };
    }
    if (hit) quotedLine ??= { name: source.name, line: hit.line };
  }
  if (readerQuote) {
    return {
      ...base,
      status: "warn",
      note: "The reader flagged a line as aimed at whoever reviews the entry. It may be a quoted example. Read it yourself.",
      evidence: [{ label: "The line", detail: readerQuote.slice(0, 200) }],
    };
  }
  if (reader.guardTripped) {
    return {
      ...base,
      status: "warn",
      note: "SERV's prompt guard blocked the write-up on the first read, which means it contains instruction-like text. No specific line was matched.",
      evidence: [],
    };
  }
  if (quotedLine) {
    return {
      ...base,
      status: "pass",
      note: `The ${quotedLine.name} quotes an injection attempt as an example. It sits inside quotes or a code block, so it is not treated as aimed at the reviewer.`,
      evidence: [{ label: "The quoted line", detail: quotedLine.line }],
    };
  }
  return { ...base, status: "pass", note: "Nothing addressed to an automated reviewer was found.", evidence: [] };
}

export { fileKind };
