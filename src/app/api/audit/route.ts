import { createHash } from "node:crypto";
import { z } from "zod";
import { audit, type AuditDeps } from "@/lib/audit";
import { OVERCLAIMER_ID, overclaimerLink, overclaimerSnapshot } from "@/lib/fixtures";
import { parseRepoUrl, RepoError } from "@/lib/github";
import { customRuleset, findRuleset, SERV_02 } from "@/lib/rules";
import type { AuditResult, Ruleset } from "@/lib/types";

export const maxDuration = 120;

const Body = z.object({
  repoUrl: z.string().max(300).optional(),
  sample: z.string().max(40).optional(),
  writeup: z.string().max(40_000).optional(),
  rulesetId: z.string().max(40).optional(),
  declared: z.enum(["new", "existing", "unstated"]).default("unstated"),
  custom: z
    .object({
      name: z.string().max(80),
      start: z.string().max(40),
      end: z.string().max(40),
      requiredTech: z.string().max(60),
      patterns: z.array(z.string().max(80)).max(12),
    })
    .optional(),
});

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 8;
const hits = new Map<string, number[]>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; result: AuditResult }>();

function json(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return json(400, "The request was not understood.");
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowed(ip)) return json(429, "Too many checks from this address. Try again in a few minutes.");

  const isSample = body.sample === OVERCLAIMER_ID;
  let ruleset: Ruleset;
  try {
    ruleset = isSample ? SERV_02 : body.custom ? customRuleset(body.custom) : (findRuleset(body.rulesetId) ?? SERV_02);
  } catch (error) {
    return json(400, error instanceof Error ? error.message : "The rules could not be read.");
  }

  let repoUrl = "made-up-entry/brightline-pay";
  if (!isSample) {
    try {
      const { owner, repo } = parseRepoUrl(body.repoUrl ?? "");
      repoUrl = `${owner}/${repo}`;
    } catch (error) {
      return json(400, error instanceof Error ? error.message : "That is not a GitHub repo link.");
    }
  }

  const declared = isSample ? "new" : body.declared;
  const key = createHash("sha256")
    .update(JSON.stringify([repoUrl.toLowerCase(), ruleset, declared, body.writeup ?? ""]))
    .digest("hex");
  const cached = cache.get(key);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        if (cached && Date.now() - cached.at < CACHE_MS) {
          send({ type: "result", result: cached.result });
        } else {
          const deps: AuditDeps = { onProgress: (progress) => send({ type: "progress", ...progress }) };
          if (isSample) {
            deps.loadRepo = async () => overclaimerSnapshot();
            deps.openLink = overclaimerLink;
          }
          const result = await audit({ repoUrl, writeup: body.writeup, ruleset, declared }, deps);
          cache.set(key, { at: Date.now(), result });
          if (cache.size > 200) cache.delete(cache.keys().next().value!);
          send({ type: "result", result });
        }
      } catch (error) {
        const message = error instanceof RepoError ? error.message : "The check failed. Try again.";
        if (!(error instanceof RepoError)) console.error("audit failed", error);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
