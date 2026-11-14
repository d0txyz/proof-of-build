import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LinkCheck } from "./types";

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateV4(mapped[1]) : false;
}

/** Refuses anything that is not a public https or http web address. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not a web link");
  if (url.username || url.password) throw new Error("link carries credentials");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("unusual port");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) throw new Error("bare IP address");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) throw new Error("local address");
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0) throw new Error("does not resolve");
  for (const { address, family } of addresses) {
    if (family === 4 ? isPrivateV4(address) : isPrivateV6(address)) throw new Error("private address");
  }
  return url;
}

const DEAD_PAGE = /DEPLOYMENT_NOT_FOUND|404: NOT_FOUND|There isn't a GitHub Pages site here|Application error|Service Suspended|No such app|This site can.t be reached|Not Found - Request ID|<title>404\b/i;

type Fetcher = typeof fetch;

/** Opens a link from a write-up and reports whether a page answers. */
export async function checkLink(raw: string, kind: LinkCheck["kind"], fetcher: Fetcher = fetch, resolve = assertPublicUrl): Promise<LinkCheck> {
  let current = raw;
  try {
    for (let hop = 0; hop < 4; hop += 1) {
      const url = await resolve(current);
      const response = await fetcher(url, {
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (compatible; proof-of-build link check)", accept: "text/html,*/*" },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { url: raw, ok: false, status: response.status, note: "Redirects nowhere.", kind };
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) return { url: raw, ok: false, status: response.status, note: `Answered ${response.status}.`, kind };
      const body = (await response.text()).slice(0, 200_000);
      if (DEAD_PAGE.test(body)) return { url: raw, ok: false, status: response.status, note: "The host answered with its own error page.", kind };
      if (kind !== "video" && body.trim().length < 200) return { url: raw, ok: false, status: response.status, note: "Answered with an almost empty page.", kind };
      return { url: raw, ok: true, status: response.status, note: "A page answered.", kind };
    }
    return { url: raw, ok: false, status: null, note: "Too many redirects.", kind };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "failed";
    const note = /timeout|aborted/i.test(reason) ? "Did not answer within 10 seconds." : /ENOTFOUND|resolve/i.test(reason) ? "The address does not exist." : `Could not be opened (${reason.slice(0, 60)}).`;
    return { url: raw, ok: false, status: null, note, kind };
  }
}
