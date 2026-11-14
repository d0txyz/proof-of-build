import type { AuditResult, ClaimStatus, Status } from "./types";

export const RULE_WORD: Record<Status, string> = { pass: "Confirmed", warn: "Look closer", fail: "Problem", unknown: "Not checked" };
export const CLAIM_WORD: Record<ClaimStatus, string> = { verified: "Verified", unverified: "Could not verify", contradicted: "Contradicted" };
export const DECLARED_WORD = { new: "a new project", existing: "an existing project with new work", unstated: "not stated" } as const;

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/** The audit as Markdown, for pasting into a judging sheet. */
export function toMarkdown(result: AuditResult): string {
  const lines: string[] = [];
  const { repo, counts } = result;
  lines.push(`# Proof of Build: ${repo.owner}/${repo.repo}`);
  lines.push("");
  lines.push(repo.url ? `- Repo: ${repo.url} at \`${repo.headSha.slice(0, 7)}\`` : "- Repo: a made-up entry, not on GitHub");
  lines.push(`- Rules: ${result.ruleset.name}`);
  lines.push(`- Entered as: ${DECLARED_WORD[result.declared]}`);
  lines.push(`- Checked: ${shortDate(result.checkedAt)} UTC${result.recorded ? " (recorded run)" : ""}`);
  lines.push(`- Claims: ${counts.verified} verified, ${counts.unverified} could not verify, ${counts.contradicted} contradicted`);
  lines.push("");
  lines.push("## Rule checks");
  lines.push("");
  for (const rule of result.rules) {
    lines.push(`- **${RULE_WORD[rule.status]}: ${rule.label}.** ${rule.note}`);
    for (const e of rule.evidence.slice(0, 3)) lines.push(`  - ${e.url ? `[${e.label}](${e.url})` : e.label}${e.detail ? `: ${e.detail}` : ""}`);
  }
  lines.push("");
  lines.push("## Claims");
  lines.push("");
  if (result.claims.length === 0) lines.push("No checkable claims were listed.");
  for (const claim of result.claims) {
    lines.push(`- **${CLAIM_WORD[claim.status]}:** "${claim.quote.replace(/\s+/g, " ")}"`);
    lines.push(`  - ${claim.note}`);
    for (const e of claim.evidence.slice(0, 2)) lines.push(`  - ${e.url ? `[${e.label}](${e.url})` : e.label}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const note of result.notes) lines.push(`- ${note}`);
  lines.push("- This report does not judge quality and does not pick winners. \"Could not verify\" means no proof was found, not that the claim is false.");
  return `${lines.join("\n")}\n`;
}
