@AGENTS.md

# Proof of Build

Entry for SERV Hackathon 02 (OpenServ), Open Track. Checks a hackathon submission's claims against its GitHub repo, for judges and organizers.

- Never use em dashes anywhere (code, comments, UI copy, docs, commits).
- Public credit is "d0t", team "Off Hours". Never the full name, never an AI tool credit.
- Never print or commit `.env.local`. The SERV key lives there as `SERV_API_KEY`.
- Verdicts are computed in code. The reader lists claims and points at lines. It cannot add a claim, approve one, or contradict one. Keep the tests in `src/lib/accuracy.test.ts` passing: each pins a mistake seen in a live run.
- A wrong "Verified" or "Contradicted" is the worst failure. When unsure, the answer is "Could not verify".
- It never scores quality and never ranks entries.
- The made-up sample lives in `src/lib/fixtures.ts`. It must stay clearly labelled as made up and must not describe a real project.
- Recorded sample runs are in `src/lib/recorded/`. Re-record with `POB_LIVE=1 npx vitest run src/lib/live.test.ts` after changing the pipeline.
- Do not edit source through shell heredocs: the shell eats backslashes and breaks regexes. Use the editor tools.
- Checks before done: `npm test`, `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- Dev server: `proof-of-build` entry in `../handoff/.claude/launch.json`, port 3300.
- Do not commit, push, deploy, post or submit without the owner's (d0t) explicit OK.
