# Proof of Build

Checks a hackathon submission's claims against its repo. It tells a judge what is true. It does not pick winners.

Built for SERV Hackathon 02 (Open Track) on SERV Reasoning.

## The problem

A hackathon judge reads a hundred write-ups in a few days. Each one says things like "88 passing tests", "live on mainnet", "built from scratch during the hackathon" and "every decision runs through the sponsor's API". Checking those by hand means opening the repo, reading the history, grepping for the API and clicking every link. Most judges cannot do that for every entry, so claims go unchecked and the write-up that says the most wins the most.

Organizers have the same job at the end. Prizes are paid "after verification", and that verification is done by hand.

## What it does

1. A judge pastes a GitHub repo link. The write-up can be pasted too. Without it, the README is read.
2. SERV Reasoning lists every factual claim in the write-up, word for word.
3. Code runs seven rule checks against the hackathon's rules.
4. Code checks each claim against the repo, the commit history and the live links.
5. Each claim comes back as one of three:
   - **Verified**: code found the proof and links to the line.
   - **Could not verify**: no proof was found. That is not the same as false.
   - **Contradicted**: the repo or the link shows otherwise.

The report can be copied as Markdown into a judging sheet.

## The seven rule checks

| Check | What it looks at |
| --- | --- |
| Public repo | Anyone can open it |
| Built in the window | Commit dates against the hackathon dates, and against what the entrant declared: new, or existing with new work |
| Uses the required technology | The lines that call it, in source files. A mention in the README is not a call |
| Demo link or video | Opens each link and reports whether a page answers |
| Write-up covers what was asked | Names its track and says how it uses the required technology |
| No secrets committed | Key-shaped strings and filled `.env` files. Reports where, never the value |
| Written for people, not for an AI judge | Text aimed at an automated reviewer, including text hidden in HTML comments |

The rules for SERV Hackathon Edition 02 and Edition 01 are built in. "Your own hackathon" takes a start date, an end date and the strings that prove a call to the required technology.

## How SERV Reasoning is used

All model calls go through the SERV Reasoning API (`https://inference-api.openserv.ai/v1`, OpenAI SDK). See [`src/lib/serv.ts`](src/lib/serv.ts).

- **Two bounded jobs.** The first call lists the claims. The second compares feature claims with code snippets and points at one line. Both return strict JSON. Neither decides a verdict.
- **`serv_prompt_guard`.** A write-up is text from a stranger who wants to win. The guard is on for the first read. If it blocks the text, the read is repeated without it and the report says so, because a project about prompt injection will quote attacks.
- **`serv_shadow_agent`.** A second pass rejects a draft whose quotes are not copied word for word.
- **The reader cannot add or approve anything.** Code enforces this ([`src/lib/claims.ts`](src/lib/claims.ts)):
  - A claim is thrown out unless its quote is in the write-up.
  - A label that does not fit the claim's own words is corrected. A figure in a table is not a test count.
  - A "supports" answer is thrown out unless the line is in the repo, comes from a snippet shown for that claim, and is code. A comment, a label or a line of page text is not proof.
  - Hidden HTML comments are stripped before the reader sees the write-up. Code reports them instead.
- **Fails closed.** If the reader is down, the seven rule checks still run and only claims that match a pattern (test counts, live links) are listed.

There is a test for a reader that has been talked round by a hidden note: every rule check still fails and nothing becomes verified.

## Try it

Four samples open at once as recorded runs, and each can be run again live.

| Sample | What it shows |
| --- | --- |
| A made-up overclaimer | Not a real entry. Six of nine commits before the window, a dead demo link, a committed key, the required API named but never called, and a hidden note to an AI judge |
| ASSAY | Best overall, Edition 01. 88 commits inside the window, call sites in 8 files, about 502 tests found against 541 claimed |
| SERVPIT | Honorable mention, Edition 01. About 1,696 tests found against 1,724 claimed, and 12 commits after the deadline |
| Resibo Check | Our own repo. One commit, no demo link yet. It does not pass everything |

## Run it

Needs Node 22 or newer.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Put your SERV key in `.env.local` as `SERV_API_KEY`. Without a key the app still runs the code checks and says the reader is off. `GITHUB_TOKEN` is optional and lifts GitHub's limit of 60 requests an hour.

```bash
npm run dev
```

Open http://localhost:3300.

```bash
npm test
```

To run the samples live against GitHub and SERV and record the results (needs the key, costs a few cents):

```bash
POB_LIVE=1 npx vitest run src/lib/live.test.ts
```

## What it cannot do

- It does not judge quality, originality or whether the idea is good.
- It does not run the code. A verified feature means the line exists, not that it works.
- Commit dates come from git and can be set by the author. The repo creation date comes from GitHub and cannot.
- Test cases are counted by pattern. Table-driven tests count once, so a real suite can be larger than the count.
- It reads one public GitHub repo. A second repo, a private backend or a chain is out of its sight.
- The reader's list of claims changes a little from run to run. The verdict for any one claim does not depend on the reader.
- "Could not verify" is the default. It would rather leave a true claim unproven than call a false one proven.

## Privacy and safety

- Only public repos are read. Nothing is stored. Results are cached in memory for 15 minutes.
- The write-up and short code snippets are sent to SERV Reasoning.
- Links are opened only if they are public web addresses. Local and private addresses are refused, and every redirect is checked again.
- Secrets found in a repo are reported by file and line. The value never leaves the scanner.

## Credits

Built by d0t, team Off Hours.

MIT License.
