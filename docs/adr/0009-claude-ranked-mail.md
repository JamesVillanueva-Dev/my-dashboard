# ADR 0009: Claude ranks the inbox, on metadata only, with a key that is never bundled

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Project owner

## Context

The dashboard answers "what is happening next" from the calendar and "what do I
owe" from tasks. Mail is the obvious gap: the inbox is where most obligations
actually arrive, and it is the one surface where the useful question — *which
three of these deserve me right now* — is a judgement call rather than a sort.
Unread-plus-recency is a heuristic anyone can write and nobody trusts; a
newsletter from a person still looks like a person, and a failing-payment alert
from a robot still matters.

That judgement is what a model is for. Wiring one in raises three problems that
this dashboard's existing decisions do not answer.

**An API key cannot be kept secret in a browser.** Anything `VITE_`-prefixed is
inlined into the bundle — the same fact ADR 0006 leans on when it chooses PKCE
over a Spotify client secret — and this app deploys to a public GitHub Pages
URL. The existing `VITE_` values are not counter-examples: a Clerk *publishable*
key and a Google *client id* are public by design, protected by domain
allowlists and user consent. An Anthropic key is a bearer credential — whoever
holds it spends money, with no allowlist, no consent, and no scope.
`deploy.yml` even greps the built JavaScript to confirm those two keys landed in
it, which is a working demonstration that a third would be readable too.

**Reading mail is the most invasive thing this app could do.** `gmail.readonly`
is a Google *restricted* scope; and the panel's whole purpose involves handing
message content to a third party, in an app whose footer claimed everything
stayed in the browser.

**Model calls cost money on a timer.** Every other panel refreshes freely
because a weather fetch is free. A panel that re-ranks on every mount is a
recurring charge for a dashboard left open on a second monitor.

## Decision

**Ship a Mail panel that ranks with `claude-opus-5` over message metadata, keyed
by a credential that never enters the bundle.**

1. **Metadata only, enforced at the Gmail API.** `gmail.ts` requests
   `format=metadata`, so Gmail returns headers and its own ~100-character
   `snippet` and *does not include a body*. This is deliberately not a filter in
   our own code that a later refactor could quietly widen: bodies are not
   withheld, they are never fetched. Sender, subject, snippet, age, and read
   state are what ranking sees, and therefore all that can reach Anthropic.

2. **Two key paths, neither of them the deploy pipeline.**
   `VITE_ANTHROPIC_API_KEY` may sit in `.env.local` — gitignored, and pointedly
   *not* added to `deploy.yml`, so it reaches a local `npm run dev` and nothing
   else. Otherwise the panel takes a pasted key into `sessionStorage`: dropped
   when the tab closes (ADR 0006's reasoning for the Spotify token), and never
   written through `useLocalStorage`, which would sweep it into the
   account-synced snapshot and publish the credential to Clerk (ADR 0008).
   `dangerouslyAllowBrowser` is passed, and the name is treated as accurate
   rather than as a formality: the key is reachable by anything running on the
   page, and the mitigation is keeping it out of the bundle and out of synced
   storage, not pretending otherwise.

3. **A separate OAuth client per scope.** `googleAuth.ts` now keys its token
   cache and its GIS client by scope. One client covering both would mean
   connecting a calendar also demanded a user's mail — a worse consent prompt
   for more access than the feature needs.

4. **Structured outputs, not "reply with JSON".** The ranking comes back against
   a JSON schema. Assistant prefill — the old way to force a shape — is rejected
   on Claude Opus 5, and a schema converts a parse failure from a runtime
   surprise into something the API guarantees against. Picks naming an id that
   was never sent are dropped rather than rendered as empty rows.

5. **Opus, at low effort, behind a 15-minute cache.** The judgement *is* the
   feature, so the model is not downgraded to save money; spend is bounded
   instead by how little is sent, by `effort: 'low'`, and by refreshing on a
   timer with an explicit manual refresh. The panel also refuses to fetch or rank
   until the user has connected — the cached-resource hook runs its loader on
   mount regardless of its key, so without that guard the panel would read a
   user's mail and spend their credit before they asked.

6. **Off by default, and disclosed.** `defaultOff: true`, like Spotify. The
   Privacy Policy now names Gmail and Anthropic, and the footer badge claiming
   "Everything stays in this browser" is replaced with "No analytics, no ads, no
   tracking" — which is still true.

## Consequences

**Positive**

- The one inbox question worth asking gets an answer with reasoning attached,
  not a re-sorted list.
- Message bodies genuinely cannot leak, because they are never retrieved.
- The zero-setup path is untouched: no key, no panel, no requests.

**Negative**

- **The key is exposed to the page.** Both paths accept this; neither fixes it.
  Only a server-side proxy would, and that ends ADR 0001. A key used here should
  be scoped and rotatable, and treated as compromised if the machine is.
- **The deployed copy can't use the env-var path**, by design — on GitHub Pages
  the panel needs a pasted key each session, which is friction that is the point.
- **`gmail.readonly` blocks publishing.** Fine for a project in testing mode with
  its own listed users; a public launch would need Google's verification and a
  third-party security assessment.
- **Ranking costs money and can be wrong.** A missed important email is a
  failure mode heuristics don't have, and the panel is a summary of the inbox,
  not a replacement for it.
- **One more thing that can be down.** Anthropic outages surface as a panel-level
  error, not a broken dashboard.

## Alternatives considered

- **Heuristic ranking** (unread + direct-to-you + sender frequency + recency).
  No key, no cost, nothing leaves. Rejected as the primary design because it
  cannot tell an obligation from a notification — but it remains the honest
  fallback if the key path proves too awkward, and needs no new consent.
- **Full message bodies.** Better on mail whose subject misleads. Rejected: it
  multiplies both the token bill and the amount of the user's life sent to a
  third party, for a gain that headline-level triage mostly does not need.
- **A serverless proxy holding the key.** The only design that actually protects
  the credential, and the right answer for anything multi-user. Rejected here
  because it ends "nothing to deploy" (ADR 0001) for a single-user dashboard.
- **A cheaper model.** Rejected: ranking is the entire product surface, and the
  cost is already bounded by payload size, effort, and cache.
