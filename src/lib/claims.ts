import type { TechFinding } from "./checks";
import { permalink } from "./github";
import { bestWindows, isImportLine, keyTerms, looksLikeCode, stem, termMatcher, type Hit, type TestCount } from "./scan";
import type { EvidenceItem, EvidenceVerdict } from "./serv";
import type { Claim, ClaimResult, Evidence, LinkCheck, RepoFile, RepoSnapshot, RuleCheck, Ruleset } from "./types";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`#>|~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutLinkTargets(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/** A claim counts only if its quote really is in the write-up. The reader cannot add claims of its own. */
export function quoteIsInText(quote: string, text: string): boolean {
  const q = normalize(quote);
  if (q.length < 8) return false;
  if (normalize(text).includes(q)) return true;
  return normalize(withoutLinkTargets(text)).includes(normalize(withoutLinkTargets(quote)));
}

const TEST_WORD = /\btests?\b|\bspecs?\b|\btest cases?\b/i;
const BUILD_WORD = /\b(built|build|created|developed|written|wrote|made|started|began|shipped)\b[^.\n]{0,60}\b(hackathon|window|from scratch|this week|these two weeks|for this)\b|\bfrom scratch\b|\bnew project\b|\bexisting project\b|\bbefore the hackathon\b|\bduring the hackathon\b|\bbuilt for\b/i;

/**
 * The reader labels each claim, and a wrong label would send it to the wrong check.
 * This puts a claim back in a safe kind when its own words do not fit the label.
 */
export function fixKinds(claims: Claim[]): Claim[] {
  return claims.map((claim) => {
    if (claim.kind === "test_count" && !TEST_WORD.test(claim.quote)) return { ...claim, kind: "number" as const };
    if (claim.kind === "built_in_window" && !BUILD_WORD.test(claim.quote)) return { ...claim, kind: "other" as const };
    // A measured figure has a figure in it. "Runs nine checks" is something the code does.
    if (claim.kind === "number" && !/\d/.test(claim.quote)) return { ...claim, kind: "feature" as const };
    if (claim.kind === "live_link" || claim.kind === "onchain") {
      const inQuote = claim.quote.match(/https?:\/\/[^\s<>"'`)\]]+/)?.[0]?.replace(/[.,;]+$/, "") ?? null;
      const url = claim.url && /^https?:\/\//.test(claim.url) ? claim.url : inQuote;
      if (!url && claim.kind === "live_link") return { ...claim, kind: "other" as const, url: null };
      return { ...claim, url };
    }
    return claim;
  });
}

export function keepQuotedClaims(claims: Claim[], writeup: string): { kept: Claim[]; dropped: number } {
  const seen = new Set<string>();
  const kept: Claim[] = [];
  let dropped = 0;
  for (const claim of claims) {
    const key = normalize(claim.quote);
    if (!quoteIsInText(claim.quote, writeup) || seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    kept.push({ ...claim, quote: claim.quote.slice(0, 280) });
  }
  return { kept, dropped };
}

/** Claims found by pattern: test counts and live links. Used alone when the reader is off, and to fill gaps when it is on. */
export function patternClaims(writeup: string): Claim[] {
  const claims: Claim[] = [];
  for (const raw of writeup.split("\n")) {
    const line = raw.replace(/^[\s>*#-]+/, "").trim();
    if (line.length < 8 || claims.length >= 8) continue;
    const tests = line.match(/\b(\d{1,3}(?:,\d{3})+|\d+)\s+(?:[a-z-]+\s+){0,2}tests?\b/i);
    if (tests && Number(tests[1].replace(/,/g, "")) > 0) {
      claims.push({ id: `p${claims.length + 1}`, quote: line.slice(0, 240), kind: "test_count", number: Number(tests[1].replace(/,/g, "")), subject: null, url: null, searchTerms: [] });
      continue;
    }
    const live = line.match(/\b(live|deployed|hosted|try it|play it)\b[^\n]*?(https?:\/\/[^\s)>\]]+)/i);
    if (live) {
      claims.push({ id: `p${claims.length + 1}`, quote: line.slice(0, 240), kind: "live_link", number: null, subject: null, url: live[2].replace(/[.,;]+$/, ""), searchTerms: [] });
    }
  }
  return claims;
}

/** Adds a test count the reader passed over, so the most checkable claim is never missed. */
export function addMissedTestCounts(claims: Claim[], writeup: string): Claim[] {
  const counted = claims.some((c) => c.kind === "test_count" && c.number !== null && TEST_WORD.test(c.quote));
  const first = patternClaims(writeup).find((c) => c.kind === "test_count");
  if (!first || counted) return claims;
  return [{ ...first, id: "t1" }, ...claims];
}

export function isRequiredTech(claim: Claim, ruleset: Ruleset): boolean {
  const text = `${claim.subject ?? ""} ${claim.quote}`.toLowerCase();
  return text.includes(ruleset.requiredTech.toLowerCase()) || ruleset.strongPatterns.some((p) => text.includes(p.toLowerCase()));
}

const needsReader = (claim: Claim, ruleset: Ruleset) => claim.kind === "feature" || (claim.kind === "uses_tech" && !isRequiredTech(claim, ruleset));

const fileWord = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

function evidenceFromHits(snapshot: RepoSnapshot, hits: Hit[], max = 3): Evidence[] {
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

/** Words to look for in the code. The project's own name is left out: it is everywhere and proves nothing. */
function searchWords(claim: Claim, snapshot: Pick<RepoSnapshot, "repo">): string[] {
  const own = snapshot.repo.toLowerCase();
  const fromSubject = claim.kind === "uses_tech" && claim.subject ? claim.subject.split(/\s+/) : [];
  return [...new Set([...claim.searchTerms.flatMap((t) => t.split(/\s+/)), ...fromSubject].filter((t) => t.length >= 3).map(stem))].filter((t) => !own.includes(t));
}

/** Builds the snippets the reader will compare feature and technology claims against. */
export function evidenceItems(snapshot: RepoSnapshot, claims: Claim[], ruleset: Ruleset, maxClaims = 10): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const claim of claims) {
    if (!needsReader(claim, ruleset) || items.length >= maxClaims) continue;
    const windows = bestWindows(snapshot.files, searchWords(claim, snapshot), keyTerms([claim.quote]), 3, 6);
    if (windows.length > 0) items.push({ id: claim.id, quote: claim.quote, snippets: windows.map((w) => ({ path: w.path, text: w.text })) });
  }
  return items;
}

function findLine(file: RepoFile, line: string): number | null {
  const target = line.trim();
  if (target.length < 4) return null;
  const lines = file.text.split("\n");
  let index = lines.findIndex((l) => l.trim() === target);
  if (index === -1) index = lines.findIndex((l) => l.includes(target));
  return index === -1 ? null : index + 1;
}

export type VerifyContext = {
  snapshot: RepoSnapshot;
  ruleset: Ruleset;
  tests: TestCount;
  tech: TechFinding;
  windowCheck: RuleCheck;
  links: LinkCheck[];
  verdicts: EvidenceVerdict[];
  /** The snippets that were shown to the reader, per claim. */
  items: EvidenceItem[];
  readerOk: boolean;
};

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

export function verifyClaim(claim: Claim, ctx: VerifyContext): ClaimResult {
  const { snapshot } = ctx;
  const done = (status: ClaimResult["status"], note: string, evidence: Evidence[] = [], by: ClaimResult["by"] = "code"): ClaimResult => ({
    ...claim,
    status,
    note,
    evidence,
    by,
  });
  const noCode = snapshot.files.length === 0;

  /** Feature and technology claims: the reader points at a line, code confirms the line exists and is code. */
  const fromReader = (what: "feature" | "tech"): ClaimResult => {
    if (noCode) return done("unverified", "The source could not be read.");
    if (!ctx.readerOk) return done("unverified", "This kind of claim needs the reader, which did not run.");
    if (!ctx.items.some((i) => i.id === claim.id)) {
      const words = searchWords(claim, snapshot);
      return done("unverified", words.length > 0 ? `No source file brings these together: ${words.map((t) => `"${t}"`).join(", ")}. It may live outside this repo.` : "No code to compare this against was found.");
    }
    const verdict = ctx.verdicts.find((v) => v.id === claim.id);
    if (verdict?.verdict === "supports" && verdict.path && verdict.line) {
      const file = snapshot.files.find((f) => f.path === verdict.path);
      const line = file ? findLine(file, verdict.line) : null;
      if (!file || !line) return done("unverified", "The reader pointed at a line that is not in the repo, so its answer was thrown out.");
      // The line must come from a snippet that was shown for this claim, not from somewhere else in the repo.
      const shown = ctx.items.find((i) => i.id === claim.id)?.snippets.some((s) => s.path === verdict.path && s.text.includes(verdict.line!.trim()));
      if (!shown) return done("unverified", "The reader pointed at a line it was not shown for this claim, so its answer was thrown out.");
      // A technology claim needs the technology's own name on the line.
      const names = searchWords(claim, snapshot);
      if (what === "tech" && !names.some((name) => termMatcher(name)(verdict.line!.toLowerCase()))) {
        return done("unverified", `The reader pointed at a line that does not name ${names.map((t) => `"${t}"`).join(" or ") || "the technology"}, so its answer was thrown out.`, [
          { label: `${file.path}:${line}`, url: permalink(snapshot, file.path, line), detail: verdict.line.trim().slice(0, 200) },
        ]);
      }
      const isComment = /^(\/\/|#|\*|\/\*|<!--)/.test(verdict.line.trim());
      if (isComment || (what === "feature" && (!looksLikeCode(verdict.line) || isImportLine(verdict.line)))) {
        return done("unverified", "The reader pointed at a comment or a line of text, not at code that does this, so its answer was thrown out.", [
          { label: `${file.path}:${line}`, url: permalink(snapshot, file.path, line), detail: verdict.line.trim().slice(0, 200) },
        ]);
      }
      return done(
        "verified",
        what === "tech"
          ? "The reader pointed at the line where this is wired in, and code confirmed the line is in the repo. That shows it is used, not how well."
          : "The reader pointed at a line that does this, and code confirmed the line is in the repo. Open it to judge for yourself.",
        [{ label: `${file.path}:${line}`, url: permalink(snapshot, file.path, line), detail: verdict.line.trim().slice(0, 200) }],
        "reader+code",
      );
    }
    if (verdict?.verdict === "unclear") return done("unverified", "The code mentions this, but no line was found that shows it being done.");
    return done("unverified", "Related code was found, but nothing that shows this claim.");
  };

  switch (claim.kind) {
    case "test_count": {
      if (noCode) return done("unverified", "The source could not be read.");
      const found = ctx.tests.cases;
      const top = ctx.tests.byFile.slice(0, 3).map((f) => ({ label: `${f.path} (${f.cases})`, url: permalink(snapshot, f.path) }));
      if (claim.number === null) {
        return found > 0
          ? done("verified", `Tests exist: about ${found} cases in ${fileWord(ctx.tests.files)}, counted by pattern.`, top)
          : done("contradicted", "No test files were found in the repo at this commit.");
      }
      if (found === 0) return done("contradicted", `Claims ${claim.number} tests. No test files were found in the repo at this commit.`);
      if (found >= claim.number * 0.8) {
        return done("verified", `Claims ${claim.number}. Found about ${found} test cases in ${fileWord(ctx.tests.files)}, counted by pattern.`, top);
      }
      return done(
        "unverified",
        `Claims ${claim.number}. Found about ${found} test cases in ${fileWord(ctx.tests.files)} by pattern. Table-driven tests count once here, which may explain the gap. Run the suite to settle it.`,
        top,
      );
    }

    case "live_link": {
      const check = claim.url ? ctx.links.find((l) => sameUrl(l.url, claim.url!)) : undefined;
      if (!claim.url || !check) return done("unverified", "This link was not opened. A check opens at most ten links.", claim.url ? [{ label: claim.url.replace(/^https?:\/\//, "").slice(0, 70), url: claim.url }] : []);
      const evidence = [{ label: check.url.replace(/^https?:\/\//, "").slice(0, 70), url: check.url, detail: check.note }];
      if (check.ok) return done("verified", "A page answered at that address when checked. That shows it is up, not that it works.", evidence);
      const gone = check.status === 404 || check.status === 410 || /does not exist|error page/.test(check.note);
      return gone
        ? done("contradicted", `The link did not open when checked. ${check.note}`, evidence)
        : done("unverified", `The link could not be confirmed. ${check.note}`, evidence);
    }

    case "built_in_window": {
      const evidence = ctx.windowCheck.evidence;
      const saysExisting = /\bexisting\b|\bbefore the hackathon\b|\bprior work\b|\bpre-?existing\b/i.test(claim.quote);
      const stats = ctx.windowCheck.note;
      if (saysExisting) return done("unverified", `The write-up says earlier work exists. ${stats}`, evidence);
      if (ctx.windowCheck.status === "pass") return done("verified", stats, evidence);
      if (ctx.windowCheck.status === "fail") return done("contradicted", stats, evidence);
      return done("unverified", stats, evidence);
    }

    case "uses_tech": {
      if (!isRequiredTech(claim, ctx.ruleset)) return fromReader("tech");
      if (noCode) return done("unverified", "The source could not be read.");
      if (ctx.tech.status === "pass") {
        return done("verified", `Call sites for ${ctx.ruleset.requiredTech} are in the source.`, evidenceFromHits(snapshot, ctx.tech.sourceHits));
      }
      if (ctx.tech.status === "warn") {
        return done("unverified", `${ctx.ruleset.requiredTech} is named in docs or config, but no call to it was found in the source files.`, evidenceFromHits(snapshot, [...ctx.tech.sourceHits, ...ctx.tech.otherHits], 2));
      }
      return done("unverified", `No trace of ${ctx.ruleset.requiredTech} was found in the repo at this commit. It may live in another repo.`);
    }

    case "feature": {
      // A feature that depends on the required technology cannot be shown while the code never calls it.
      if (!noCode && isRequiredTech(claim, ctx.ruleset) && ctx.tech.status !== "pass") {
        return done(
          "unverified",
          ctx.tech.status === "warn"
            ? `${ctx.ruleset.requiredTech} is named in docs or config, but no call to it was found in the source files.`
            : `No trace of ${ctx.ruleset.requiredTech} was found in the repo at this commit. It may live in another repo.`,
          evidenceFromHits(snapshot, [...ctx.tech.sourceHits, ...ctx.tech.otherHits], 2),
        );
      }
      return fromReader("feature");
    }

    case "onchain": {
      const check = claim.url ? ctx.links.find((l) => sameUrl(l.url, claim.url!)) : undefined;
      const evidence = check ? [{ label: check.url.replace(/^https?:\/\//, "").slice(0, 70), url: check.url, detail: check.note }] : [];
      return done("unverified", check?.ok ? "The explorer link opens. This tool does not read chains, so check the transaction yourself." : "This tool does not read chains. Check the transaction yourself.", evidence);
    }

    case "number":
      return done("unverified", "A stated figure. A repo cannot prove it. Ask for the run that produced it, or reproduce it.");

    default:
      return done("unverified", "Not something a repo can show.");
  }
}

const ORDER: Record<ClaimResult["status"], number> = { contradicted: 0, verified: 1, unverified: 2 };
const LAST = new Set(["other", "number"]);

export function verifyClaims(claims: Claim[], ctx: VerifyContext): ClaimResult[] {
  return claims
    .map((claim, index) => ({ result: verifyClaim(claim, ctx), index }))
    .sort((a, b) => ORDER[a.result.status] - ORDER[b.result.status] || Number(LAST.has(a.result.kind)) - Number(LAST.has(b.result.kind)) || a.index - b.index)
    .map((x) => x.result);
}
