import { untarGz } from "./tar";
import type { CommitInfo, RepoFile, RepoSnapshot } from "./types";

const API = "https://api.github.com";
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const MAX_FILE_BYTES = 400 * 1024;
const MAX_FILES = 4000;
const MAX_COMMIT_PAGES = 5;

const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|out|\.next|vendor|target|coverage|__pycache__|\.venv|venv|\.turbo|\.cache)\//;
const SKIP_FILES = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum|\.min\.(js|css)|\.map)$/i;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|svg|pdf|zip|gz|tgz|tar|7z|mp4|mov|webm|mp3|wav|ogg|woff2?|ttf|otf|eot|wasm|bin|exe|dll|so|dylib|traineddata|pt|onnx|parquet|sqlite|db)$/i;

export class RepoError extends Error {
  constructor(
    message: string,
    public code: "bad_url" | "not_found" | "rate_limited" | "too_large" | "failed",
  ) {
    super(message);
  }
}

export function parseRepoUrl(input: string): { owner: string; repo: string } {
  const trimmed = input.trim();
  const match =
    trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:[/?#].*)?$/) ??
    trimmed.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  if (!match) throw new RepoError("That is not a GitHub repo link. Use github.com/owner/name.", "bad_url");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

type Fetcher = typeof fetch;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "proof-of-build",
    "x-github-api-version": "2022-11-28",
  };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function api<T>(path: string, token: string | undefined, fetcher: Fetcher): Promise<T> {
  const response = await fetcher(`${API}${path}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) throw new RepoError("GitHub has no public repo at that address.", "not_found");
  if (response.status === 403 || response.status === 429) {
    throw new RepoError("GitHub's rate limit was reached. Try again in a few minutes.", "rate_limited");
  }
  if (!response.ok) throw new RepoError(`GitHub answered ${response.status}.`, "failed");
  return (await response.json()) as T;
}

type ApiRepo = {
  private: boolean;
  description: string | null;
  homepage: string | null;
  license: { spdx_id: string | null; name: string } | null;
  default_branch: string;
  created_at: string;
  pushed_at: string;
  size: number;
  html_url: string;
};

type ApiCommit = { sha: string; commit: { message: string; committer: { date: string } | null; author: { date: string } | null } };

function keepFile(path: string, size: number): boolean {
  if (size > MAX_FILE_BYTES) return false;
  if (SKIP_DIRS.test(`/${path}`) || SKIP_FILES.test(path) || BINARY_EXT.test(path)) return false;
  return true;
}

export type FetchOptions = { token?: string; fetcher?: Fetcher };

/** Reads a public repo: facts from the API, history, and the source at the head commit. */
export async function fetchRepo(input: string, options: FetchOptions = {}): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(input);
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const fetcher = options.fetcher ?? fetch;

  const meta = await api<ApiRepo>(`/repos/${owner}/${repo}`, token, fetcher);

  const commits: CommitInfo[] = [];
  let commitsTruncated = false;
  for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
    const batch = await api<ApiCommit[]>(`/repos/${owner}/${repo}/commits?per_page=100&page=${page}`, token, fetcher).catch((error) => {
      // An empty repo answers 409. Treat it as no commits.
      if (error instanceof RepoError && error.code === "failed") return [] as ApiCommit[];
      throw error;
    });
    for (const c of batch) {
      const date = c.commit.committer?.date ?? c.commit.author?.date;
      if (date) commits.push({ sha: c.sha, date, message: c.commit.message.split("\n")[0].slice(0, 120) });
    }
    if (batch.length < 100) break;
    if (page === MAX_COMMIT_PAGES) commitsTruncated = true;
  }

  const headSha = commits[0]?.sha ?? meta.default_branch;
  let files: RepoFile[] = [];
  let skipped = 0;
  let codeNote: string | undefined;

  if (meta.size * 1024 > MAX_ARCHIVE_BYTES * 4) {
    codeNote = "The repo is too large to read here, so the code checks were skipped.";
  } else if (commits.length > 0) {
    try {
      const archive = await fetcher(`https://codeload.github.com/${owner}/${repo}/tar.gz/${headSha}`, {
        headers: { "user-agent": "proof-of-build" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!archive.ok) throw new Error(`archive answered ${archive.status}`);
      const bytes = Buffer.from(await archive.arrayBuffer());
      if (bytes.length > MAX_ARCHIVE_BYTES) throw new RepoError("too large", "too_large");
      const result = untarGz(bytes, keepFile);
      skipped = result.skipped;
      for (const entry of result.entries.slice(0, MAX_FILES)) {
        if (entry.data.includes(0)) {
          skipped += 1;
          continue;
        }
        files.push({ path: entry.path, text: entry.data.toString("utf8"), size: entry.data.length });
      }
      if (result.entries.length > MAX_FILES) skipped += result.entries.length - MAX_FILES;
    } catch (error) {
      files = [];
      codeNote =
        error instanceof RepoError && error.code === "too_large"
          ? "The repo is too large to read here, so the code checks were skipped."
          : "The source could not be downloaded, so the code checks were skipped.";
    }
  }

  return {
    owner,
    repo,
    url: meta.html_url,
    isPublic: !meta.private,
    description: meta.description,
    homepage: meta.homepage || null,
    license: meta.license?.spdx_id && meta.license.spdx_id !== "NOASSERTION" ? meta.license.spdx_id : (meta.license?.name ?? null),
    defaultBranch: meta.default_branch,
    createdAt: meta.created_at,
    pushedAt: meta.pushed_at,
    headSha,
    commits,
    commitsTruncated,
    files,
    skipped,
    codeNote,
  };
}

export function permalink(snapshot: Pick<RepoSnapshot, "url" | "headSha">, path: string, line?: number): string {
  // The made-up sample has no repo on GitHub, so it gets no links.
  if (!snapshot.url) return "";
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${snapshot.url}/blob/${snapshot.headSha}/${encoded}${line ? `#L${line}` : ""}`;
}
