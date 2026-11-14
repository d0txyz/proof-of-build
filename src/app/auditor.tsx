"use client";

import { useRef, useState } from "react";
import assay from "@/lib/recorded/assay.json";
import overclaimer from "@/lib/recorded/overclaimer.json";
import resibo from "@/lib/recorded/resibo-check.json";
import servpit from "@/lib/recorded/servpit.json";
import { CLAIM_WORD, DECLARED_WORD, RULE_WORD, shortDate, toMarkdown } from "@/lib/report";
import type { AuditResult, ClaimResult, Declared, Evidence, Progress, RuleCheck } from "@/lib/types";

type Payload = {
  repoUrl?: string;
  sample?: string;
  writeup?: string;
  rulesetId?: string;
  declared: Declared;
  custom?: { name: string; start: string; end: string; requiredTech: string; patterns: string[] };
};

type Sample = { id: string; label: string; blurb: string; payload: Payload; recorded: AuditResult };

const SAMPLES: Sample[] = [
  {
    id: "overclaimer",
    label: "A made-up overclaimer",
    blurb: "Not a real entry. Written to show what a bad one looks like.",
    payload: { sample: "overclaimer", declared: "new" },
    recorded: overclaimer as unknown as AuditResult,
  },
  {
    id: "assay",
    label: "ASSAY",
    blurb: "Best overall, Edition 01.",
    payload: { repoUrl: "OoJae/assay", rulesetId: "serv-01", declared: "unstated" },
    recorded: assay as unknown as AuditResult,
  },
  {
    id: "servpit",
    label: "SERVPIT",
    blurb: "Honorable mention, Edition 01.",
    payload: { repoUrl: "iam25th1/servpit", rulesetId: "serv-01", declared: "unstated" },
    recorded: servpit as unknown as AuditResult,
  },
  {
    id: "resibo-check",
    label: "Resibo Check",
    blurb: "Our own repo, warts and all.",
    payload: { repoUrl: "d0txyz/resibo-check", rulesetId: "serv-02", declared: "new" },
    recorded: resibo as unknown as AuditResult,
  },
];

const STAGES: { id: Progress["stage"]; label: string }[] = [
  { id: "repo", label: "Read the repo" },
  { id: "code", label: "Run the code checks" },
  { id: "claims", label: "List the claims" },
  { id: "links", label: "Open the links" },
  { id: "evidence", label: "Compare claims with code" },
];

type Phase = { name: "idle" } | { name: "running"; stage: Progress["stage"]; message: string } | { name: "done" } | { name: "error"; message: string };

function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="evidence">
      {items.map((e, i) => (
        <li key={`${e.label}-${i}`}>
          {e.url ? (
            <a href={e.url} target="_blank" rel="noreferrer">
              {e.label}
            </a>
          ) : (
            <span className="ev-label">{e.label}</span>
          )}
          {e.detail && <code>{e.detail}</code>}
        </li>
      ))}
    </ul>
  );
}

function RuleRow({ rule }: { rule: RuleCheck }) {
  return (
    <li className={`rule ${rule.status}`}>
      <span className="dot" aria-hidden="true" />
      <div>
        <p className="rule-head">
          <strong>{rule.label}</strong>
          <span className={`tag ${rule.status}`}>{RULE_WORD[rule.status]}</span>
        </p>
        <p className="rule-note">{rule.note}</p>
        {rule.rule && <p className="rule-quote">The rule: &quot;{rule.rule}&quot;</p>}
        <EvidenceList items={rule.evidence} />
      </div>
    </li>
  );
}

function ClaimCard({ claim }: { claim: ClaimResult }) {
  return (
    <li className={`claim ${claim.status}`}>
      <p className="claim-top">
        <span className={`pill ${claim.status}`}>{CLAIM_WORD[claim.status]}</span>
        <span className="by">{claim.by === "code" ? "decided by code" : "reader pointed, code confirmed"}</span>
      </p>
      <blockquote>{claim.quote}</blockquote>
      <p className="claim-note">{claim.note}</p>
      <EvidenceList items={claim.evidence} />
    </li>
  );
}

const OUTSIDE = new Set(["number", "onchain", "other"]);

/** Scrolls to a section once it has been drawn, so a result is never left below the fold. */
function bringIntoView(selector: string) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  });
}

function Report({ result, onLive, busy }: { result: AuditResult; onLive?: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  const checked = result.claims.filter((c) => c.status !== "unverified");
  const open = result.claims.filter((c) => c.status === "unverified" && !OUTSIDE.has(c.kind));
  const outside = result.claims.filter((c) => c.status === "unverified" && OUTSIDE.has(c.kind));
  const tally = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const rule of result.rules) tally[rule.status] += 1;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="report" aria-live="polite">
      {result.recorded && (
        <p className="recorded">
          <span>Recorded run from {shortDate(result.checkedAt)} UTC, so it opens at once.</span>
          {onLive && (
            <button type="button" className="link-button" onClick={onLive} disabled={busy}>
              Run it live
            </button>
          )}
        </p>
      )}

      <header className="report-head">
        <div>
          <p className="eyebrow">Report</p>
          <h2>
            {result.repo.url ? (
              <a href={result.repo.url} target="_blank" rel="noreferrer">
                {result.repo.owner}/{result.repo.repo}
              </a>
            ) : (
              `${result.repo.owner}/${result.repo.repo}`
            )}
          </h2>
          <p className="meta">
            {result.repo.url ? (
              <>
                at <code>{result.repo.headSha.slice(0, 7)}</code>
              </>
            ) : (
              "a made-up entry, so file names carry no links"
            )}{" "}
            · {result.ruleset.name} · entered as {DECLARED_WORD[result.declared]}
          </p>
        </div>
        <button type="button" className="ghost" onClick={copy}>
          {copied ? "Copied" : "Copy report as Markdown"}
        </button>
      </header>

      <div className="tally">
        <div className="tally-box contradicted">
          <b>{result.counts.contradicted}</b>
          <span>contradicted</span>
        </div>
        <div className="tally-box verified">
          <b>{result.counts.verified}</b>
          <span>verified</span>
        </div>
        <div className="tally-box unverified">
          <b>{result.counts.unverified}</b>
          <span>could not verify</span>
        </div>
        <div className="tally-box rules">
          <b>
            {tally.pass}
            <i>/{result.rules.length}</i>
          </b>
          <span>
            rules confirmed{tally.fail > 0 ? `, ${tally.fail} with a problem` : ""}
          </span>
        </div>
      </div>

      <div className="columns">
        <div>
          <h3>The rules</h3>
          <ul className="rules">
            {result.rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </ul>
          <dl className="facts">
            <div>
              <dt>Commits</dt>
              <dd>
                {result.stats.commits} ({result.stats.commitsBefore} before, {result.stats.commitsInWindow} inside, {result.stats.commitsAfter} after)
              </dd>
            </div>
            <div>
              <dt>Files read</dt>
              <dd>{result.stats.files}</dd>
            </div>
            <div>
              <dt>Tests found</dt>
              <dd>
                about {result.stats.testCases} in {result.stats.testFiles} {result.stats.testFiles === 1 ? "file" : "files"}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <h3>The claims</h3>
          {result.claims.length === 0 && <p className="empty">No checkable claims were listed.</p>}
          {checked.length > 0 && (
            <ul className="claims">
              {checked.map((claim) => (
                <ClaimCard key={claim.id} claim={claim} />
              ))}
            </ul>
          )}
          {open.length > 0 && (
            <details className="group" open={checked.length < 4}>
              <summary>
                {open.length} {open.length === 1 ? "claim" : "claims"} with no proof found in the code
              </summary>
              <ul className="claims">
                {open.map((claim) => (
                  <ClaimCard key={claim.id} claim={claim} />
                ))}
              </ul>
            </details>
          )}
          {outside.length > 0 && (
            <details className="group">
              <summary>
                {outside.length} {outside.length === 1 ? "claim" : "claims"} a repo cannot show (figures, chains, the rest)
              </summary>
              <ul className="claims">
                {outside.map((claim) => (
                  <ClaimCard key={claim.id} claim={claim} />
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      <div className="report-foot">
        <p>
          {result.reader.status === "ok" && (
            <>
              Claims listed by SERV Reasoning ({result.reader.model}){result.reader.ms ? ` in ${(result.reader.ms / 1000).toFixed(1)} s` : ""}. Every verdict
              was computed in code.
            </>
          )}
          {result.reader.status === "off" && "The reader is off. Only the code checks and pattern claims ran."}
          {(result.reader.status === "refused" || result.reader.status === "invalid" || result.reader.status === "error") &&
            "The reader did not return a usable list. Only the code checks and pattern claims ran."}
          {result.reader.guardTripped && " SERV's prompt guard blocked the first read of this write-up."}
        </p>
        <ul>
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Auditor() {
  const [repoUrl, setRepoUrl] = useState("");
  const [rulesetId, setRulesetId] = useState("serv-02");
  const [declared, setDeclared] = useState<Declared>("unstated");
  const [writeup, setWriteup] = useState("");
  const [custom, setCustom] = useState({ name: "", start: "", end: "", requiredTech: "", patterns: "" });
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [result, setResult] = useState<AuditResult | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const run = useRef(0);

  const busy = phase.name === "running";

  async function check(payload: Payload) {
    const mine = ++run.current;
    setResult(null);
    setPhase({ name: "running", stage: "repo", message: "Reading the repo from GitHub." });
    bringIntoView(".progress");
    try {
      const response = await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "The check could not start.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line || mine !== run.current) continue;
          const event = JSON.parse(line) as { type: "progress"; stage: Progress["stage"]; message: string } | { type: "result"; result: AuditResult } | { type: "error"; message: string };
          if (event.type === "progress" && event.stage !== "done") setPhase({ name: "running", stage: event.stage, message: event.message });
          if (event.type === "result") {
            setResult(event.result);
            setPhase({ name: "done" });
            finished = true;
            bringIntoView(".report");
          }
          if (event.type === "error") throw new Error(event.message);
        }
        if (done) break;
      }
      if (!finished && mine === run.current) throw new Error("The check stopped before it finished. Try again.");
    } catch (error) {
      if (mine === run.current) setPhase({ name: "error", message: error instanceof Error ? error.message : "The check failed." });
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!repoUrl.trim() || busy) return;
    setSample(null);
    const payload: Payload = { repoUrl: repoUrl.trim(), declared, writeup: writeup.trim() || undefined };
    if (rulesetId === "custom") {
      payload.custom = {
        name: custom.name,
        start: custom.start,
        end: custom.end ? `${custom.end}T23:59:59Z` : "",
        requiredTech: custom.requiredTech,
        patterns: custom.patterns.split(/[,\n]/).map((p) => p.trim()).filter(Boolean),
      };
    } else payload.rulesetId = rulesetId;
    void check(payload);
  }

  function showSample(next: Sample) {
    run.current += 1;
    setSample(next);
    setResult(next.recorded);
    setPhase({ name: "done" });
    bringIntoView(".report");
  }

  const stageIndex = phase.name === "running" ? STAGES.findIndex((s) => s.id === phase.stage) : -1;

  return (
    <>
      <form className="panel" onSubmit={submit}>
        <label className="field grow">
          <span>GitHub repo</span>
          <input
            type="text"
            inputMode="url"
            placeholder="github.com/owner/name"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="row">
          <label className="field">
            <span>Hackathon rules</span>
            <select value={rulesetId} onChange={(e) => setRulesetId(e.target.value)}>
              <option value="serv-02">SERV Hackathon, Edition 02</option>
              <option value="serv-01">SERV Hackathon, Edition 01</option>
              <option value="custom">Your own hackathon</option>
            </select>
          </label>
          <label className="field">
            <span>Entered as</span>
            <select value={declared} onChange={(e) => setDeclared(e.target.value as Declared)}>
              <option value="unstated">Not stated</option>
              <option value="new">A new project</option>
              <option value="existing">An existing project with new work</option>
            </select>
          </label>
          <button type="submit" className="go" disabled={busy || !repoUrl.trim()}>
            {busy ? "Checking" : "Check it"}
          </button>
        </div>

        {rulesetId === "custom" && (
          <div className="custom">
            <label className="field">
              <span>Hackathon name</span>
              <input type="text" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Opens (UTC)</span>
              <input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} required />
            </label>
            <label className="field">
              <span>Closes (UTC)</span>
              <input type="date" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} required />
            </label>
            <label className="field">
              <span>Required technology</span>
              <input type="text" placeholder="Acme API" value={custom.requiredTech} onChange={(e) => setCustom({ ...custom, requiredTech: e.target.value })} />
            </label>
            <label className="field wide">
              <span>Strings that prove a call to it, separated by commas</span>
              <input type="text" placeholder="api.acme.dev, acme_sdk" value={custom.patterns} onChange={(e) => setCustom({ ...custom, patterns: e.target.value })} spellCheck={false} />
            </label>
          </div>
        )}

        <details className="writeup">
          <summary>Paste the submission write-up (optional). Without it, the README is read.</summary>
          <textarea
            rows={6}
            maxLength={40000}
            placeholder="The text the entrant put in the submission form."
            value={writeup}
            onChange={(e) => setWriteup(e.target.value)}
          />
        </details>

        <div className="samples">
          <span>Or open a sample:</span>
          {SAMPLES.map((s) => (
            <button key={s.id} type="button" className={`chip ${sample?.id === s.id ? "on" : ""}`} onClick={() => showSample(s)} disabled={busy} title={s.blurb}>
              {s.label}
            </button>
          ))}
        </div>
        {sample && <p className="sample-blurb">{sample.blurb}</p>}
      </form>

      {phase.name === "running" && (
        <section className="progress" aria-live="polite">
          <ol>
            {STAGES.map((stage, i) => (
              <li key={stage.id} className={i < stageIndex ? "done" : i === stageIndex ? "now" : ""}>
                {stage.label}
              </li>
            ))}
          </ol>
          <p>{phase.message}</p>
          <p className="hint">A check takes 20 to 50 seconds.</p>
        </section>
      )}

      {phase.name === "error" && <p className="error">{phase.message}</p>}

      {phase.name === "done" && result && (
        <Report key={`${result.repo.url}-${result.checkedAt}`} result={result} busy={busy} onLive={sample ? () => void check(sample.payload) : undefined} />
      )}
    </>
  );
}
