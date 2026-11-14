import { checkDemo, checkPublic, checkReviewer, checkSecrets, checkTech, checkWindow, checkWriteup, findTech, windowStats } from "./checks";
import { addMissedTestCounts, evidenceItems, fixKinds, keepQuotedClaims, patternClaims, verifyClaims } from "./claims";
import { fetchRepo } from "./github";
import { checkLink } from "./links";
import { claimLinkKind, countTests, extractLinks, findReadme, findSecrets, stripComments } from "./scan";
import { readClaims, readEvidence, type ClaimsReading, type EvidenceItem, type EvidenceVerdict } from "./serv";
import type { AuditResult, Declared, LinkCheck, Progress, ReaderInfo, RepoSnapshot, Ruleset } from "./types";

export type AuditInput = {
  repoUrl: string;
  /** The submission text. When empty, the repo's README is read instead. */
  writeup?: string;
  ruleset: Ruleset;
  declared: Declared;
  now?: Date;
};

export type AuditDeps = {
  loadRepo?: (url: string) => Promise<RepoSnapshot>;
  openLink?: (url: string, kind: LinkCheck["kind"]) => Promise<LinkCheck>;
  claimsReader?: (writeup: string) => Promise<ClaimsReading>;
  evidenceReader?: (items: EvidenceItem[]) => Promise<{ status: ReaderInfo["status"]; verdicts: EvidenceVerdict[]; ms: number }>;
  onProgress?: (progress: Progress) => void;
};

const MAX_LINKS = 10;

export async function audit(input: AuditInput, deps: AuditDeps = {}): Promise<AuditResult> {
  const now = input.now ?? new Date();
  const say = (stage: Progress["stage"], message: string) => deps.onProgress?.({ stage, message });
  const { ruleset, declared } = input;

  say("repo", "Reading the repo from GitHub.");
  const snapshot = await (deps.loadRepo ?? fetchRepo)(input.repoUrl);

  say("code", `Read ${snapshot.files.length} files and ${snapshot.commits.length} commits. Running the code checks.`);
  const readme = findReadme(snapshot);
  const given = input.writeup?.trim() ?? "";
  const writeup = given.length >= 80 ? given : (readme?.text ?? "");
  const usedReadme = given.length < 80;

  const tests = countTests(snapshot.files);
  const secrets = findSecrets(snapshot.files);
  const tech = findTech(snapshot, ruleset);
  const windowCheck = checkWindow(snapshot, ruleset, declared, now);

  say("claims", "SERV Reasoning is listing the write-up's claims, word for word.");
  const found = extractLinks(writeup, snapshot.homepage);
  const toOpen = [...found.filter((l) => l.kind === "demo").slice(0, 4), ...found.filter((l) => l.kind === "video").slice(0, 2)];
  const open = deps.openLink ?? ((url, kind) => checkLink(url, kind));

  const [reading, firstLinks] = await Promise.all([
    // The reader never sees hidden comments. Code reports them instead.
    writeup.length >= 80 ? (deps.claimsReader ?? readClaims)(stripComments(writeup)) : Promise.resolve<ClaimsReading>({ info: { status: "off" }, claims: [], track: null, reviewerQuote: null }),
    Promise.all(toOpen.map((l) => open(l.url, l.kind))),
  ]);

  const readerOk = reading.info.status === "ok";
  const listed = readerOk ? addMissedTestCounts(reading.claims, writeup) : patternClaims(writeup);
  const { kept, dropped } = keepQuotedClaims(fixKinds(listed), writeup);

  say("links", "Opening the links the write-up points to.");
  const links = [...firstLinks];
  const extra = kept
    .filter((c) => (c.kind === "live_link" || c.kind === "onchain") && c.url && /^https?:\/\//.test(c.url))
    .map((c) => ({ url: c.url!, kind: c.kind === "onchain" ? ("other" as const) : claimLinkKind(c.url!) }))
    .filter((l) => !links.some((done) => done.url.replace(/\/+$/, "") === l.url.replace(/\/+$/, "")))
    .slice(0, Math.max(0, MAX_LINKS - links.length));
  links.push(...(await Promise.all(extra.map((l) => open(l.url, l.kind)))));

  let verdicts: EvidenceVerdict[] = [];
  let evidenceMs = 0;
  const items = readerOk ? evidenceItems(snapshot, kept, ruleset) : [];
  if (items.length > 0) {
    say("evidence", `Comparing ${items.length} ${items.length === 1 ? "claim" : "claims"} with the code, line by line.`);
    const result = await (deps.evidenceReader ?? readEvidence)(items);
    verdicts = result.verdicts;
    evidenceMs = result.ms;
  }

  const claims = verifyClaims(kept, {
    snapshot,
    ruleset,
    tests,
    tech,
    windowCheck,
    links,
    verdicts,
    items,
    readerOk,
  });

  const reviewSources = [
    ...(usedReadme ? [] : [{ name: "write-up", text: given }]),
    ...(readme ? [{ name: "README", text: readme.text }] : []),
  ];
  const rules = [
    checkPublic(snapshot, ruleset),
    windowCheck,
    checkTech(snapshot, ruleset, tech),
    checkDemo(links, ruleset),
    checkWriteup(writeup, ruleset, reading.track),
    checkSecrets(snapshot, secrets),
    checkReviewer(reviewSources, reading.info, reading.reviewerQuote),
  ];

  const notes: string[] = [];
  if (usedReadme) notes.push(readme ? "No write-up was pasted, so the README was read as the write-up." : "No write-up was pasted and the repo has no README.");
  if (!readerOk) {
    notes.push(
      reading.info.status === "off"
        ? "The reader is off, so only claims that match a pattern (test counts, live links) are listed."
        : "The reader did not return a usable list, so only claims that match a pattern (test counts, live links) are listed.",
    );
  }
  if (dropped > 0) notes.push(`${dropped} ${dropped === 1 ? "claim was" : "claims were"} thrown out because the quote was not in the write-up word for word.`);
  if (snapshot.codeNote) notes.push(snapshot.codeNote);
  if (snapshot.skipped > 0) notes.push(`${snapshot.skipped} files were skipped (binary, generated, lock files, or over 400 KB).`);
  notes.push("Commit dates come from git and can be set by the author. The repo creation date comes from GitHub and cannot.");

  const counts = { verified: 0, unverified: 0, contradicted: 0 };
  for (const claim of claims) counts[claim.status] += 1;

  say("done", "Done.");
  return {
    repo: { owner: snapshot.owner, repo: snapshot.repo, url: snapshot.url, headSha: snapshot.headSha, description: snapshot.description },
    ruleset: { id: ruleset.id, name: ruleset.name, start: ruleset.start, end: ruleset.end },
    declared,
    checkedAt: now.toISOString(),
    rules,
    claims,
    counts,
    stats: { ...windowStats(snapshot, ruleset), files: snapshot.files.length, testFiles: tests.files, testCases: tests.cases },
    reader: { ...reading.info, ms: reading.info.ms !== undefined ? reading.info.ms + evidenceMs : undefined },
    notes,
  };
}
