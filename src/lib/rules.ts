import type { Ruleset } from "./types";

export const SERV_02: Ruleset = {
  id: "serv-02",
  name: "SERV Hackathon, Edition 02",
  start: "2026-11-02T00:00:00Z",
  end: "2026-11-15T23:59:59Z",
  requiredTech: "SERV Reasoning",
  strongPatterns: ["inference-api.openserv.ai", "serv_prompt_guard", "serv_shadow_agent", "serv_disable_content_filter", "-serv-kronos"],
  weakPatterns: ["SERV_API_KEY", "SERV_BASE_URL", "OPENSERV_API_KEY", "SERV Reasoning"],
  tracks: ["Dolphin", "Kite", "Reppo", "Open"],
  quotes: {
    public: "Submit a public code repository, a demo link or video, and a short write-up.",
    window: "November 2 to 15, 2026. The form asks: a new project, or an existing project with new work.",
    tech: "Every track needs to use SERV Reasoning.",
    demo: "A demo link or video.",
    writeup: "A short write-up: what it does, how it uses SERV Reasoning, which track you entered.",
  },
};

export const SERV_01: Ruleset = {
  id: "serv-01",
  name: "SERV Hackathon, Edition 01",
  start: "2026-09-14T00:00:00Z",
  end: "2026-09-28T23:59:59Z",
  requiredTech: "SERV Reasoning",
  strongPatterns: ["inference-api.openserv.ai", "serv_prompt_guard", "serv_shadow_agent", "serv_disable_content_filter", "-serv-kronos"],
  weakPatterns: ["SERV_API_KEY", "SERV_BASE_URL", "OPENSERV_API_KEY", "SERV Reasoning", "openserv"],
  tracks: ["Mainnet & MCP", "AgentKit", "RWA Vaults", "Open"],
  quotes: {
    window: "September 14 to 28, 2026.",
    tech: "Built on SERV Reasoning.",
  },
};

export const RULESETS: Ruleset[] = [SERV_02, SERV_01];

export function findRuleset(id: string | undefined): Ruleset | undefined {
  return RULESETS.find((r) => r.id === id);
}

export type CustomRulesInput = {
  name: string;
  start: string;
  end: string;
  requiredTech: string;
  patterns: string[];
  tracks?: string[];
};

/** Builds a ruleset from an organizer's own dates and required strings. */
export function customRuleset(input: CustomRulesInput): Ruleset {
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("The window needs a start date and a later end date.");
  }
  const patterns = input.patterns.map((p) => p.trim()).filter((p) => p.length >= 3).slice(0, 12);
  return {
    id: "custom",
    name: input.name.trim().slice(0, 80) || "Your hackathon",
    start: start.toISOString(),
    end: end.toISOString(),
    requiredTech: input.requiredTech.trim().slice(0, 60) || "the required technology",
    strongPatterns: patterns,
    weakPatterns: [],
    tracks: (input.tracks ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
    quotes: {},
  };
}
