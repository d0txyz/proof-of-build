import { Auditor } from "./auditor";

const RULES: [string, string][] = [
  ["Public repo", "Anyone can open it."],
  ["Built in the window", "Commit dates against the hackathon dates, and against what the entrant declared: new, or existing with new work."],
  ["Uses the required technology", "Finds the lines that call it, in source files. A mention in the README is not a call."],
  ["Demo link or video", "Opens each link and reports whether a page answers."],
  ["Write-up covers what was asked", "Names its track and says how it uses the required technology."],
  ["No secrets committed", "Looks for key-shaped strings and filled .env files. Reports where, never the value."],
  ["Written for people", "Flags text aimed at an automated reviewer, including text hidden in HTML comments."],
];

const CLAIMS: [string, string][] = [
  ["“88 passing tests”", "Counts test cases in the repo by pattern and compares."],
  ["“Live at this address”", "Opens the link. A missing page contradicts the claim. A slow or locked one does not."],
  ["“Built during the hackathon”", "Compares with the commit history."],
  ["“Uses this API”, “does this thing”", "The reader points at one line of code. Code confirms that line is in the repo and is code, then links you to it."],
  ["“97% accuracy”, a transaction", "Marked as not checkable from a repo, with what to ask for instead."],
];

export default function Home() {
  return (
    <>
      <header className="top">
        <a className="mark" href="#top">
          <span className="mark-box" aria-hidden="true" />
          Proof of Build
        </a>
        <nav>
          <a href="#how">How it checks</a>
          <a href="#limits">What it cannot do</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <p className="eyebrow">For hackathon judges and organizers</p>
          <h1>Check the claims before you score the entry.</h1>
          <p className="lede">
            Paste a submission&apos;s repo. Proof of Build lists every claim in the write-up word for word, then checks each one against the code, the commit
            history and the live links. It does not pick winners. It tells you what is true.
          </p>
        </section>

        <Auditor />

        <section id="how" className="explain">
          <h2>How it checks</h2>
          <p className="section-lede">
            SERV Reasoning reads the write-up and lists its claims. It decides nothing. Every verdict is computed in code, and a claim only counts if its quote
            is in the write-up word for word.
          </p>
          <div className="explain-grid">
            <div>
              <h3>Seven rule checks</h3>
              <ol className="plain-list">
                {RULES.map(([name, text]) => (
                  <li key={name}>
                    <strong>{name}</strong>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3>Then each claim</h3>
              <ul className="plain-list">
                {CLAIMS.map(([name, text]) => (
                  <li key={name}>
                    <strong>{name}</strong>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
              <div className="three">
                <p>
                  <b className="pill verified">Verified</b> Code found the proof and links to it.
                </p>
                <p>
                  <b className="pill unverified">Could not verify</b> No proof was found. That is not the same as false.
                </p>
                <p>
                  <b className="pill contradicted">Contradicted</b> The repo or the link shows otherwise.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="limits" className="explain">
          <h2>What it cannot do</h2>
          <ul className="limits">
            <li>It does not judge quality, originality or whether the idea is good. That is the judge&apos;s job.</li>
            <li>It does not run the code. A verified feature means the line exists, not that it works.</li>
            <li>Commit dates come from git and can be set by the author. The repo creation date comes from GitHub and cannot.</li>
            <li>Test cases are counted by pattern. Table-driven tests count once, so a real suite can be larger than the count.</li>
            <li>It reads one public GitHub repo. Work in a second repo, a private backend or a chain is out of its sight.</li>
            <li>&quot;Could not verify&quot; is the default. It would rather leave a true claim unproven than call a false one proven.</li>
          </ul>
        </section>
      </main>

      <footer className="foot">
        <p>Built by d0t, Off Hours, for SERV Hackathon 02.</p>
        <p>Claims are read by SERV Reasoning. Verdicts are computed in code.</p>
      </footer>
    </>
  );
}
