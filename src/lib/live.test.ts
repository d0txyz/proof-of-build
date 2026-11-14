// Live runs against GitHub and SERV Reasoning. Skipped unless POB_LIVE is set.
// POB_LIVE=1 runs the listed repos and writes each result to src/lib/recorded/<name>.json.
import { existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audit } from "./audit";
import { overclaimerLink, overclaimerSnapshot } from "./fixtures";
import { SERV_01, SERV_02 } from "./rules";
import type { Declared, Ruleset } from "./types";

const live = Boolean(process.env.POB_LIVE);
if (live && existsSync(".env.local")) process.loadEnvFile(".env.local");

const RUNS: [string, string, Ruleset, Declared][] = [
  ["overclaimer", "made-up-entry/brightline-pay", SERV_02, "new"],
  ["resibo-check", "d0txyz/resibo-check", SERV_02, "new"],
  ["assay", "OoJae/assay", SERV_01, "unstated"],
  ["servpit", "iam25th1/servpit", SERV_01, "unstated"],
];
const only = process.env.POB_ONLY?.split(",");

describe.skipIf(!live)("live audits", () => {
  it.each(RUNS.filter(([name]) => !only || only.includes(name)))("%s", { timeout: 180_000 }, async (name, repoUrl, ruleset, declared) => {
    const sample = name === "overclaimer";
    const result = await audit(
      { repoUrl, ruleset, declared },
      sample ? { loadRepo: async () => overclaimerSnapshot(), openLink: overclaimerLink } : {},
    );
    writeFileSync(`src/lib/recorded/${name}.json`, `${JSON.stringify({ ...result, recorded: true }, null, 2)}\n`);
    console.log(
      JSON.stringify({
        name,
        reader: result.reader,
        counts: result.counts,
        stats: result.stats,
        rules: result.rules.map((r) => `${r.id}:${r.status}`),
        claims: result.claims.map((c) => `${c.status} [${c.kind}] ${c.quote.slice(0, 70)} => ${c.note.slice(0, 90)}`),
        notes: result.notes,
      }, null, 1),
    );
    expect(result.rules).toHaveLength(7);
  });
});
