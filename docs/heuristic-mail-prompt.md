# Brief: replace Claude-ranked mail with a heuristic scorer

**Status: shipped.** This brief drove the work now described in
[ADR 0010](adr/0010-heuristic-mail-ranking.md) and `src/lib/importantMail.ts`.
Kept here as a historical record of the brief, not as an outstanding task.

Paste everything below the line into a fresh Claude Code session in this repo.

---

# Mail panel: rank the inbox with heuristics, and remove the model entirely

Read this whole brief before writing any code. It is one deliverable in several
phases — work through them in order and **do not stop between phases to ask whether
to continue**. Stop only when a genuine fork would send the work in materially
different directions, or when you are blocked by something you cannot decide.

## 0. Context you need first

This is a client-only React 19 + TypeScript + Vite dashboard. No backend. State lives
in `localStorage`, with optional Google (GIS token flow) and Clerk integrations, and
the app runs fully with neither configured.

Before writing anything, read:

- `CLAUDE.md` — project conventions. Strict, not suggestions.
- `docs/adr/0009-claude-ranked-mail.md` — the decision you are reversing. Read it
  properly, especially the **Alternatives considered** section, which already names
  heuristic ranking and states exactly why it was rejected. Your job is to build the
  thing that ADR argued against, and to beat the version it had in mind.
- `docs/adr/0001-client-only-dashboard-architecture.md` — client-only, no backend.
- `src/lib/gmail.ts` — the Gmail read, the `format=metadata` privacy boundary, the
  inbox query, and `MailSummary`.
- `src/lib/importantMail.ts` — the module you are replacing.
- `src/components/MailWidget/index.tsx` — the panel, including the API-key form and
  the connect flow.
- `src/lib/anthropicKey.ts` — the key paths you are deleting.
- `src/lib/cache.ts` and `src/hooks/useCachedResource.ts` — the SWR cache, its
  `VERSION` constant, and the fact that its loader runs on mount regardless of key.
- `src/components/LegalModal/index.tsx` and `src/components/Footer/index.tsx` — both
  currently make claims about Anthropic that will stop being true.

## 1. The change

**Rank the inbox locally, with an explainable scoring function, and remove every
trace of the model call.**

The reason is a product decision, not a technical one, and you should not relitigate
it: the panel should work with no API key, cost nothing to refresh, send nothing to a
third party, and be inspectable when it gets something wrong. Accept that as given.

What you must *not* accept is the strawman ADR 0009 rejected. It dismissed
"unread + direct-to-you + sender frequency + recency" on the grounds that it cannot
tell an obligation from a notification. That version deserved rejecting. The version
you build has to be materially better, and it can be, because the current code is
throwing away most of the signal Gmail already hands out for free:

- It requests three headers (`From`, `Subject`, `Date`) and ignores the dozen others
  that say whether a message is bulk, automated, addressed to you personally, or part
  of a conversation you are already in.
- It ignores `labelIds` entirely except for `UNREAD` — including `IMPORTANT`, which is
  Gmail's own priority classifier, already trained on *this specific user's* behaviour,
  free, and personalised in a way no rule you write can be.

Getting those is still `format=metadata`. **Bodies stay unfetched** — that boundary in
`gmail.ts` is not up for negotiation and should end up stated more strongly, not less,
since after this change nothing leaves the browser for a third party at all.

## 2. Design principles, non-negotiable

1. **The scorer is a pure synchronous function.** Signature roughly
   `scoreMail(message, context, now): Score`. No `fetch`, no `Date.now()` inside, no
   React. Everything it needs — the user's own email address, sender statistics —
   arrives in `context`. All I/O stays in `gmail.ts`. This is what makes it testable
   and what makes calibration possible.
2. **Every score is explainable.** The scorer returns the numeric total *and* the list
   of signals that fired, each with its contribution. The panel needs a human reason
   line per pick — that is what the current one shows and it must not regress into a
   bare list of subjects.
3. **No magic numbers.** Every weight is a named exported constant with a comment
   saying what it is worth *relative to the others* and why. `const UNREAD = 8` with
   no rationale is the failure mode here; a reader should be able to argue with your
   weights, which means they have to be able to find and understand them.
4. **Deterministic and stable.** Same inbox plus same `now` gives the same order, every
   time. Ties break on an explicit documented rule, never on array order.
5. **It must be able to say "nothing".** A heuristic always produces a top three, even
   from three newsletters. Enforce a minimum score floor: below it, a message is not
   shown at all, and an inbox with nothing above the floor gets the existing
   "Nothing in the last week needs you" empty state. Showing fewer than three items is
   a correct outcome, not a bug.

## 3. The signals available to you

This is the raw material. Use your judgement on weighting and on which to skip, but
you should have a reason for anything on this list you leave out.

### Bulk and automated (strong negative)

- `List-Unsubscribe`, `List-Id` — the single most reliable "this is a mailing" tell.
- `Precedence: bulk | list | junk`, `Auto-Submitted: auto-generated`.
- `From` address matching `no-?reply`, `donotreply`, `notifications@`, `mailer-daemon`,
  `bounce`.
- Gmail categories still in scope: the query excludes promotions and social, but
  `CATEGORY_UPDATES` and `CATEGORY_FORUMS` messages are present in `labelIds`.

**The trap, and the thing ADR 0009 said you would get wrong:** a failed-payment alert
is bulk *and* automated *and* from `no-reply@`, and it matters more than almost
anything else in the inbox. A blanket demotion of automated mail fails exactly the
case the ADR names. Handle it deliberately — for instance by separating
*transactional* language ("payment failed", "declined", "action required", "expires",
"suspended", "verify", "receipt", "confirm") from *marketing* language ("sale",
"% off", "final hours", "don't miss", "introducing"), and letting the former lift an
automated message back up while the latter does not. Say in a comment how you handled
it; this is the case a reviewer will test first.

### Addressed to you personally (strong positive)

- Your address in `To` beats your address only in `Cc` beats neither (list mail, bcc).
  This needs the user's own address: `GET /users/me/profile` returns `emailAddress`.
  One extra call, cache it hard, and handle its absence by skipping the signal rather
  than throwing.
- Recipient count across `To` + `Cc`. One recipient reads as a personal message;
  twenty reads as an announcement. Watch for `undisclosed-recipients`.
- `Delivered-To` as a secondary check for aliases.

### Part of a conversation (positive)

- `In-Reply-To` / `References` present — someone is replying, likely to you.
- `Subject` beginning `Re:` (and localised variants if cheap; do not overreach).
- `Fwd:` is weaker — a forward is often FYI, not an ask.

### Gmail's own judgement (strong positive)

- The `IMPORTANT` label. Gmail's priority classifier, personalised to this user, free.
  Weight it seriously — it will frequently outperform anything you write — but do not
  let it be the only thing that decides, or the panel is just Priority Inbox.
- `STARRED` — an explicit human signal, stronger than any inference.

### The ask (positive, and the hardest to get right)

- A question mark in the subject or snippet.
- Direct requests and deadlines in the snippet: "can you", "could you", "please
  review", "let me know", "by Friday", "due", "deadline", "RSVP", "sign", "approve",
  "waiting on".
- Keep the keyword lists as named exported constants, not inline regex soup, so they
  can be read and edited without touching the scoring logic. Match case-insensitively
  on word boundaries — substring matching will hit "duetto" for "due".

### Recency and read state (tie-breakers only, per ADR 0009's framing)

- Unread is a modest bonus, not a decider — a read message you have been avoiding all
  week may be exactly the one you owe.
- Recency should decay smoothly (half-life or banded), not as a cliff. Nothing should
  ever be picked *because* it is newest; that is the behaviour the whole panel exists
  to avoid.

### Sender familiarity (Phase 4, optional)

- Whether the user has ever emailed this sender is a strong signal of a real
  relationship. Cheaply approximated with one list-only query per unique candidate
  sender: `GET /messages?q=in:sent to:<addr>&maxResults=1` and read
  `resultSizeEstimate`. No per-message fetches. ~10–20 list calls per refresh for a
  25-message inbox, and cacheable per sender for days.
- Sender frequency within the candidate set is free and worth a little: five messages
  from the same address this week is usually a system, not a person.

## 4. Phase-by-phase work

### Phase 0 — Design the scoring model on paper

Read the files in section 0. Then propose, in prose plus a table:

- Every signal you will implement, its weight, and whether it is additive,
  multiplicative, or a gate.
- How the automated-but-urgent case resolves, with a worked example: score a failing
  payment notice from `no-reply@stripe.com` and a promotional newsletter from a named
  human at a startup, and show the arithmetic for both.
- The score floor, and roughly what fraction of a typical inbox you expect above it.
- Which extra headers you will request and what each buys you.

Show me this before writing scorer code. I would much rather argue about weights on
paper than after they are wired in. Once I respond, continue through the remaining
phases without further check-ins unless something genuinely forks.

**Acceptance:** a model I can react to, with the two worked examples.

### Phase 1 — Widen the metadata

In `src/lib/gmail.ts`:

- Extend `metadataHeaders` to everything the model needs. Keep the list explicit — the
  point of naming headers is that it is visible what is being read.
- Extend `MailSummary` with the new fields. Parse addresses properly: header values are
  comma-separated lists with quoted display names that can themselves contain commas.
  A naive `split(',')` is wrong on `"Smith, Alice" <a@x.com>, bob@y.com` — write a real
  splitter and test it on that exact string.
- Carry `labelIds` through in a usable form (at minimum `important`, `starred`, and the
  categories) rather than leaking raw Gmail label strings into the scorer.
- Add `fetchProfileEmail()` for the signed-in address, cached, failing soft.
- Update the header comment: `format=metadata` remains the boundary, and after this
  change nothing at all is forwarded to a third party. Say that plainly.
- Consider whether `CANDIDATES` should rise above 25 now that ranking is free. It costs
  one round trip per message, so this is a latency trade, not a token trade — pick a
  number and justify it in a comment.

**Acceptance:** `gmail.test.ts` covers the address-list parser including quoted commas,
missing headers, and malformed values; nothing in the fetch path requests a body.

### Phase 2 — The scorer

Replace the contents of `src/lib/importantMail.ts`. Keep the filename and the exported
`rankMail` / `TOP_N` names so callers and docs stay coherent, but the function becomes
**synchronous and pure**, taking `(messages, context, now)`.

- One scoring function per signal group, composed by a top-level `scoreMail`. Small
  named functions beat one 200-line switch.
- Return `{ total, signals }` where each signal carries a key, its contribution, and a
  short human phrase.
- Build the panel's reason line from the dominant signals — "Asks you directly, due
  Friday" rather than "unread + recent". Keep it under ~90 characters, matching what
  the panel renders today. Derive it from the top one or two signals rather than
  concatenating everything that fired.
- Apply the score floor, sort, tie-break explicitly, slice to `TOP_N`.

**Acceptance:** `importantMail.test.ts` covers each signal in isolation (one message,
one signal, assert the contribution), several combinations, the floor rejecting a
weak inbox entirely, deterministic tie-breaking, and — as its centrepiece — a realistic
fixture inbox of ~15 messages mixing newsletters, a payment failure, a direct question
from a colleague, a thread reply, a calendar invite, and a promotional blast, asserting
the exact expected top three and *why*. That fixture is the real test of this feature;
write it first if it helps.

### Phase 3 — Rewire the panel

In `src/components/MailWidget/index.tsx`:

- Delete the API-key form, `keyDraft` / `keyError` / `keyEpoch` state, the forget-key
  action, and the `keySource` chrome.
- The panel now needs only a Google client id and a Gmail connection. Simplify the
  gating states down to: not configured → connect → loading → error → ranked.
- Fix the cache key, which currently encodes whether a key exists.
- **Lower `TTL_MS`.** Fifteen minutes existed because refreshes cost money. They now
  cost a Gmail quota unit and nothing else. Pick something appropriate for a panel that
  is free to refresh, and rewrite the comment explaining it — leaving the old rationale
  in place would be a lie in a file that is otherwise honest.
- Update the refresh button's `title` (currently "uses your Anthropic credit") and the
  footer hint ("Ranked by Claude from sender, subject and preview").
- Consider surfacing the full signal breakdown on hover via `title`, so a wrong pick is
  debuggable by the person looking at it. Cheap, and it is the main advantage this
  design has over the model.
- Bump `VERSION` in `src/lib/cache.ts` — the cached payload shape changes, and a stale
  entry from the old build must not be handed to the new renderer.
- Decide whether the panel stays `defaultOff` in `src/lib/registry.tsx`. It no longer
  needs an API key, but `gmail.readonly` is still a Google restricted scope. My lean is
  that it stays off by default; if you disagree, argue it and update the comment, which
  currently cites the Anthropic key as half the reason.

**Acceptance:** `MailWidget/index.test.tsx` updated — no key mocking anywhere, states
covered, and a test asserting the panel makes no request before the user connects.

### Phase 4 — Sender familiarity (optional, must degrade gracefully)

Add the "have I emailed this person" signal using list-only queries as described in
section 3. Cache per sender address with a long TTL. If the queries fail or are slow,
the panel must still rank without them — this signal improves the result, it does not
gate it. Batch and deduplicate; do not fire one per message.

If you judge the latency not worth it, skip this phase and say so in your final report
with the reasoning. That is an acceptable outcome; a half-wired version is not.

**Acceptance:** ranking works identically when the familiarity lookup throws.

### Phase 5 — Remove the model completely

This is a deletion phase. Be thorough; a half-removed integration is worse than either
end state.

- Delete `src/lib/anthropicKey.ts` and its test.
- Remove `@anthropic-ai/sdk` from `package.json` and refresh the lockfile. Note the
  bundle win in your report — it was a ~47KB gzipped dynamic import.
- Remove `VITE_ANTHROPIC_API_KEY` from `.env.example` and `src/vite-env.d.ts`, and the
  long warning block that goes with it.
- `README.md` — rewrite the Mail section. It currently spends a dozen lines on key
  handling, `dangerouslyAllowBrowser`, and why the key must not be a repo secret. All
  of that goes. Replace it with what the panel now does and how the ranking works;
  a user should be able to read it and predict what the panel will pick. Also fix the
  file tree, which describes `importantMail.ts` as "asks Claude which three messages
  matter" and lists `anthropicKey.ts`.
- `src/components/LegalModal/index.tsx` — remove the Anthropic third-party entry and
  the API-key paragraph, and fix the summary line claiming the panel "sends message
  headers to Claude". Keep the Gmail entry; it is still accurate and still the most
  invasive thing the app does.
- `src/components/Footer/index.tsx` — read the comment above the badge. It was changed
  from "Everything stays in this browser" to "No analytics, no ads, no tracking"
  *because* of the Anthropic call. That call is gone. Decide whether the stronger claim
  is now honest again — Gmail data comes *in* and nothing goes *out* — and if you
  restore it, update the comment's reasoning. If you think it is still overclaiming,
  leave it and say why. Do not change it silently either way.
- Grep for `anthropic`, `Claude`, and `ADR 0009` across the repo and handle every hit.
  Several live in comment prose in `gmail.ts`, `googleAuth.ts`, `profileSync.ts`, and
  `registry.tsx`.

**Acceptance:** `grep -ri anthropic src/ docs/ *.md .env.example` returns only the
historical ADR record, and `npm run build` shows the SDK gone from the output.

### Phase 6 — Calibrate against a real inbox

Weights chosen on paper are a hypothesis. Before declaring done, run the app against a
real inbox (`npm run dev`, Gmail connected) and look at the top three with the signal
breakdown visible. Then:

- Adjust weights where the result is obviously wrong, and record what you changed and
  why — that record is the interesting part of this phase.
- If a signal turns out to contribute nothing in practice, delete it rather than
  keeping dead weight in the model.

Note the standing caveat in the repo memory: Clerk blocks headless browsing, so blank
`VITE_CLERK_PUBLISHABLE_KEY` to reach the dashboard UI if you drive a browser.

If you cannot get real inbox access, say so plainly and calibrate against the fixture
instead — but do not claim the model is tuned when it has only ever seen test data.

### Phase 7 — ADR, tests, self-review

- Write `docs/adr/0010-heuristic-mail-ranking.md` in the format of the existing ADRs.
  It must engage honestly with 0009 rather than pretending it never happened: state
  what changed in the requirements, concede what is genuinely lost (an obligation the
  keywords miss is now a permanent miss, not a model error), and record what is gained
  (no key, no cost, no third party, an explainable and fixable ranking, a smaller
  bundle). The **Alternatives considered** section should include keeping the model as
  an opt-in path and say why you did not.
- Mark ADR 0009 as **Superseded by 0010** in its status line. Do not edit its body —
  a superseded ADR is a record, not a wrong file.
- Full test pass. No test may assert on hashed CSS class name strings; import the
  stylesheet and compare against `styles.whatever`.
- Re-read your own diff before declaring done: dead imports, orphaned constants,
  comments describing behaviour that no longer exists.

## 5. Hard constraints

- **Client-only.** No backend, no new runtime dependencies (you are removing one, not
  adding one), no CDN assets, no external fonts or images. Icons are inline SVG in
  `src/components/Icon/`.
- **Metadata only, still.** No `format=full`, no bodies, no matter how much better the
  keyword matching would get. If you find yourself wanting bodies, note it in the ADR's
  consequences as a rejected option and move on.
- **CSS Modules only**, `.container` as the root, descendant selectors over per-element
  `className`s, shared primitives via `composes`. See `CLAUDE.md`.
- **Do not break the optional-integration model.** The app must still run correctly with
  no `VITE_GOOGLE_CLIENT_ID` and no `VITE_CLERK_PUBLISHABLE_KEY`. Test that path.
- **Preserve existing user data.** `localStorage` keys for notes, tasks, links, layout,
  and theme must not change. `mail.connected` should keep working — a user who has
  already connected Gmail must not be asked to reconnect.

## 6. Non-goals

Do not add new integrations. Do not add a settings UI for tuning weights — the weights
are code, and the ADR explains them. Do not add mail actions (archive, reply, mark
read); the panel stays read-only and links out to Gmail. Do not touch the calendar,
tasks, or Today zone. Do not restyle the panel beyond what removing the key form
requires.

## 7. How to work

Make routine judgement calls yourself and keep moving. Ask only when two readings would
produce materially different work.

Report progress as you finish each phase — a line or two, not an essay. Run
`npm run lint`, `npx tsc -b`, and `npm run test:run` as you go, not only at the end.

If a phase turns out to be blocked or a bad idea, finish every other phase in full and
tell me plainly what you skipped and why. Scaling the work down is my call, not yours.

## 8. Definition of done

- `npm run lint`, `npx tsc -b`, and `npm run test:run` all pass.
- The Mail panel works end to end with **no Anthropic key anywhere**, and no code path
  can ask for one.
- The scorer is pure, synchronous, fully unit-tested, and every weight is a named
  constant with a documented rationale.
- The fixture-inbox test asserts a specific, defensible top three.
- A weak inbox produces fewer than three picks, or none.
- `@anthropic-ai/sdk` is gone from `package.json`, the lockfile, and the build output.
- README, `.env.example`, the Privacy Policy, and the footer badge are all true.
- ADR 0010 exists; ADR 0009 is marked superseded.
- A final report: what you built, the weights you landed on and what calibration
  changed, what you deliberately did not do, and anything you found but left alone.
