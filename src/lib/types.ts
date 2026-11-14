/** A hackathon's rules, reduced to what code can check. */
export type Ruleset = {
  id: string;
  name: string;
  /** ISO instants. Work counts as "in the window" between these. */
  start: string;
  end: string;
  /** Short name of the technology every entry must use. */
  requiredTech: string;
  /** Strings that prove a call site when found in source code. */
  strongPatterns: string[];
  /** Strings that only show the tech is mentioned or configured. */
  weakPatterns: string[];
  tracks: string[];
  /** The rule sentences, quoted from the organizer, shown next to each check. */
  quotes: Partial<Record<RuleId, string>>;
};

export type Declared = "new" | "existing" | "unstated";

export type RepoFile = { path: string; text: string; size: number };

export type CommitInfo = { sha: string; date: string; message: string };

/** Everything the audit knows about a repo at one commit. */
export type RepoSnapshot = {
  owner: string;
  repo: string;
  url: string;
  isPublic: boolean;
  description: string | null;
  homepage: string | null;
  license: string | null;
  defaultBranch: string;
  /** Set by GitHub's servers. Cannot be backdated. */
  createdAt: string;
  pushedAt: string;
  headSha: string;
  commits: CommitInfo[];
  /** True when the history was longer than what was fetched. */
  commitsTruncated: boolean;
  files: RepoFile[];
  /** Files skipped for size or type, for the notes. */
  skipped: number;
  /** Why the code could not be read, when it could not. */
  codeNote?: string;
};

export type Status = "pass" | "warn" | "fail" | "unknown";

export type Evidence = { label: string; url?: string; detail?: string };

export type RuleId = "public" | "window" | "tech" | "demo" | "writeup" | "secrets" | "reviewer";

export type RuleCheck = {
  id: RuleId;
  label: string;
  status: Status;
  note: string;
  rule?: string;
  evidence: Evidence[];
};

export type ClaimKind =
  | "test_count"
  | "uses_tech"
  | "live_link"
  | "built_in_window"
  | "onchain"
  | "number"
  | "feature"
  | "other";

export type Claim = {
  id: string;
  /** Copied word for word from the write-up. */
  quote: string;
  kind: ClaimKind;
  number: number | null;
  subject: string | null;
  url: string | null;
  searchTerms: string[];
};

export type ClaimStatus = "verified" | "unverified" | "contradicted";

export type ClaimResult = Claim & {
  status: ClaimStatus;
  note: string;
  evidence: Evidence[];
  /** Who decided: code alone, or code after the reader pointed at a line. */
  by: "code" | "reader+code";
};

export type ReaderStatus = "ok" | "off" | "refused" | "invalid" | "error";

export type ReaderInfo = {
  status: ReaderStatus;
  model?: string;
  ms?: number;
  detail?: string;
  /** True when the prompt guard blocked the first attempt. */
  guardTripped?: boolean;
};

export type LinkCheck = { url: string; ok: boolean; status: number | null; note: string; kind: "demo" | "video" | "other" };

export type AuditResult = {
  repo: { owner: string; repo: string; url: string; headSha: string; description: string | null };
  ruleset: { id: string; name: string; start: string; end: string };
  declared: Declared;
  checkedAt: string;
  rules: RuleCheck[];
  claims: ClaimResult[];
  counts: { verified: number; unverified: number; contradicted: number };
  stats: {
    commits: number;
    commitsInWindow: number;
    commitsBefore: number;
    commitsAfter: number;
    firstCommit: string | null;
    lastCommit: string | null;
    files: number;
    testFiles: number;
    testCases: number;
  };
  reader: ReaderInfo;
  notes: string[];
  /** Set on recorded sample runs. */
  recorded?: boolean;
};

export type Progress = { stage: "repo" | "code" | "links" | "claims" | "evidence" | "done"; message: string };
