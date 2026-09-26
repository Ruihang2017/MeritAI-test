# Official-source research (as built)

Australian employment law and compliance questions are answered from official government websites, with source URLs and a retrieval date.

## 1 Flow

```
user conversation (no web access)
  └─ model calls search_official_sources("<general question, no personal data>")
       ├─ client: rejects questions that contain personal data (findPii)
       ├─ client: runs an ephemeral thread with web search ON, results restricted to OFFICIAL_DOMAINS;
       │          it sees only the question, not the conversation
       ├─ client: keeps only source URLs on the allowlist; flags off-domain activity
       └─ returns the answer + sources to the conversation; the model cites only those URLs
```

Code: `src/research/officialSources.ts`. The domain allowlist (`OFFICIAL_DOMAINS`) is defined only there.

## 2 Why it is isolated

Verified on 2026-09-24 with codex 0.154.0:

- Codex's `tools.web_search.allowed_domains` filters **search results** only. The search tool can still **open any URL**; in testing, Wikipedia was opened and quoted.
- Hosted web search runs on OpenAI's side, so the client learns about a page open only after it has happened and cannot block it.
- Recruitment conversations contain candidate data and pasted documents. A document with hidden instructions ("open https://attacker/?data=...") could therefore exfiltrate data if the conversation itself could browse.

As a result, user conversations have `web_search = "disabled"` (`codex_home/config.toml`). Web search is enabled only per thread for the isolated researcher, through the `config` override on `thread/start`. The researcher never holds conversation data, so injected instructions on a web page have nothing to exfiltrate.

## 3 Rules for the model

These live in `prompts/developer.md` and `prompts/base.md`:

- Call the tool before answering anything that depends on current rules, rates or thresholds (pay, awards, NES, leave, notice, visas, privacy, discrimination, WHS).
- Ask general questions with no personal details.
- Do not search for company facts; use company knowledge.
- Never write a URL, including a search link the model builds itself, unless a tool returned it.
- If the official sources don't confirm something, say so. For decisions with legal risk, recommend Legal or ER.

**Client guard (deterministic):** the engine records every URL that tools return in the session. After each reply, any URL not in that set produces an `unverified_links` event, and the CLI prints a warning. One exception: when the URL is a tool URL with the end of its last segment cut off at a hyphen (the model wrote `.../when-a-worker-leaves` for the ATO page `.../when-a-worker-leaves-your-business`, a dead link, in 8 of the 13 flags of the first evaluation rounds), and exactly one tool URL fits, the engine sends `links_corrected` instead (`correctUrl()` in `appServer.ts`): the CLI prints the correction, a UI replaces the link in the shown reply, and the evaluation scores the corrected reply. A parent page, a site root or a changed ending is never rewritten; those stay flagged. The prompt rule is soft (in testing the model once built reddit and wikipedia search links); the guard makes such links visible either way.

## 4 Cost

A legal question takes about 15-25 s (conversation turn → research thread with search → final answer), against 2-5 s for a normal reply. The CLI shows "searching official sources..." while it runs.

## 5 Tests

`npm run test:research` covers:

- allowlist unit checks (subdomains, lookalike domains, non-http schemes)
- PII in the question blocked
- minimum wage and NES notice answered with official URLs only
- a request for Reddit/Wikipedia links returns no non-official URLs, and any that slip through are flagged by the guard
- a request for "links to resources": every URL is tool-returned and official, or flagged
- a company-fact question does not search
- a prompt-injection resume does not trigger research or leak an attacker URL
