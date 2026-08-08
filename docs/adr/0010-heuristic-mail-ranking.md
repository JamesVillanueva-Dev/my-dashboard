# ADR 0010: Mail is ranked by an explainable heuristic in the browser, with no API key

- **Status:** Accepted
- **Date:** August 5, 2026
- **Deciders:** Project owner
- **Supersedes:** [ADR 0009](0009-claude-ranked-mail.md)

## Context

ADR 0009 shipped a Mail panel that asked `claude-opus-5` which three messages
deserved attention. It worked, and its reasoning about the *problem* still holds:
the inbox is where most obligations arrive, and "which three of these deserve me
right now" is a judgement rather than a sort.

What changed is not the problem but the requirements placed on the answer. The
panel is now wanted to:

- work with **no API key at all** — the deployed copy could never use the
  env-var path, so it demanded a pasted key every session, and ADR 0009 called
  that friction "the point". Reconsidered, it is friction with no payoff for a
  single-user dashboard;
- **cost nothing to refresh**, so the panel can track the inbox instead of
  re-ranking on a fifteen-minute timer chosen to bound a bill;
- **send nothing to a third party**, which is a stronger privacy position than
  "bodies are never fetched"; and
- be **inspectable when it is wrong**. A model's misfire is a shrug. This is the
  requirement that most changes the design, and the one a model cannot satisfy.

ADR 0009 considered heuristic ranking and rejected it, correctly, in the form it
imagined: "unread + direct-to-you + sender frequency + recency", which "cannot
tell an obligation from a notification". That version deserved rejecting. But it
was not the best heuristic available — it was the one reachable from the three
headers the code happened to request.

The existing implementation asked Gmail for `From`, `Subject`, and `Date`, and
read exactly one label (`UNREAD`). It was throwing away, for free and within the
same `format=metadata` boundary:

- `List-Unsubscribe` and `List-Id` — the most reliable "this is a mailing, not a
  message" signal that exists;
- `To`, `Cc`, and `Delivered-To` — whether a human addressed *you*, and how many
  others were on it;
- `In-Reply-To` and `References` — whether it continues a conversation;
- and Gmail's own `IMPORTANT` label: a priority classifier already trained on
  this user's behaviour, personalised in a way no rule we write can be, free,
  and sitting unread in a field the code already had in hand.

## Decision

**Score every candidate in the browser with an explainable additive-plus-gates
model, show only what clears a floor, and delete the model integration
entirely.**

1. **`Σ points × Π factors`.** Points are what a message has going for it — a
   star (+25), Gmail's `IMPORTANT` (+18), being in `To` (+14) as the sole
   recipient (+8), a thread reply (+10), and what it asks: action required
   (+12), a direct request (+10), a question in the subject (+8), a deadline
   (+8). Unread is worth +6, a tie-breaker rather than a decider, because a read
   message you have been avoiding all week may be exactly the one you owe.

   Factors are gates no amount of points can out-add: a mailing or automated
   message scales to ×0.25, marketing language to ×0.5, and age decays gently
   from ×1.0 to ×0.6 across the query window. Multipliers rather than large
   negative points, because bulk mail is *always* addressed to you as the sole
   recipient and therefore collects the same +22 a personal note does — a
   subtraction big enough to cancel that would flatten everything else too.

2. **Transactional language cancels the automation penalty; marketing vetoes the
   cancel.** This is the case ADR 0009 named as the heuristic's failure: a
   failed-payment alert is bulk, automated, and from `no-reply@`, and matters
   more than almost anything else in the inbox. So consequence words ("payment
   failed", "action required", "suspended") restore it to ×1.0 — *unless*
   marketing words are also present, which is how "your trial expires Friday —
   30% off to renew" stays buried. Urgency arriving next to a discount is a
   sales tactic, not a consequence.

3. **A machine relaying a conversation is ×0.5, not ×0.25.** GitHub, Jira,
   Linear, document comments: automated envelope, human content, `In-Reply-To`
   present. Treating them like newsletters is the other place a naive bulk gate
   goes wrong — it buries the pull-request comment that actually asks you
   something.

4. **A floor, so the panel can say "nothing".** A heuristic always produces a top
   three, even from three newsletters. Messages below 20 are not shown, and an
   inbox with nothing above it gets the empty state. Returning fewer than three
   picks is a correct outcome, not a degraded one.

   The floor judges a message's *merit* — its score before the recency factor.
   Applying recency first made age disqualifying rather than ordering: a plain
   unread note scores 28, so the curve's ×0.71 dropped it under the floor at
   about two and a half days, and a read one lasted half a day. The ranking was
   then only ever a day of mail deep, so dismissing a pick had nothing behind it
   to promote. Recency orders the list; it does not shorten it.

5. **The scorer is pure and explains itself.** `scoreMail(message, context, now)`
   — no `fetch`, no `Date.now()`, no React; `now` is injected so the same inbox
   always scores the same. Every score carries the `Signal`s that produced it,
   each with its points or factor. The panel builds its one-line reason from the
   top signals by *narrative* rank rather than by weight (sorting by points would
   make almost every reason read "Gmail flags it important"), and puts the full
   arithmetic in a `title` tooltip.

6. **Metadata only, still — and now nothing leaves.** `gmail.ts` still requests
   `format=metadata`; the header list grew from 3 to 12 and is written out
   explicitly, because that list *is* the answer to "what does this app read from
   my mail". Bodies remain unfetched. Since ranking is local, none of it is
   forwarded anywhere.

7. **Everything Anthropic is deleted.** `anthropicKey.ts`, the
   `@anthropic-ai/sdk` dependency, `VITE_ANTHROPIC_API_KEY`, the key form, the
   Privacy Policy's Anthropic entry, the Terms' "API keys you supply" section,
   and the footer's Claude attribution. The panel stays `defaultOff` — not for
   the key, which is gone, but because `gmail.readonly` is a Google *restricted*
   scope and reading someone's inbox is still the most invasive thing this app
   can do.

## Consequences

**Positive**

- **No credential exists to expose.** ADR 0009's central negative — "the key is
  exposed to the page", fixable only by a server-side proxy that would end
  ADR 0001 — is not mitigated but removed.
- **Refreshing is free**, so the TTL dropped from 15 minutes to 5 and the manual
  refresh no longer spends anything.
- **A wrong pick is debuggable.** Hover it, read the arithmetic, edit a weight.
  Every constant sits at the top of `importantMail.ts` with a comment on what it
  is worth relative to the others.
- **The bundle lost ~157 KB of JavaScript** — the `sdk-*.js` chunk and its three
  Node-shim chunks. The build went from five JS chunks to one.
- **It is testable.** A pure function over a fixture inbox pins behaviour that
  was previously an API call returning prose.
- **The zero-setup path is untouched**, and the setup path is now one env var
  rather than two plus a paste.

**Negative**

- **A missed obligation is now permanent, not stochastic.** If an important
  message uses none of the vocabulary and carries none of the structural
  signals — a colleague writing "thoughts?" with no question mark, in a fresh
  thread, from an address you have never written to — nothing will surface it.
  The model could read intent; this reads correlates of intent. This is the real
  cost of the decision and it is not recoverable by tuning.
- **The keyword lists are English-only and will age.** They are data at the top
  of the module for exactly that reason, but they are still a maintenance
  surface a model did not have.
- **Gmail's `IMPORTANT` label is a dependency we cannot inspect.** It is
  weighted heavily because it is genuinely good, and it is the one input that
  cannot be explained when it is wrong. Capping it below the sum of direct
  addressing and a direct ask is what stops the panel becoming a re-skinned
  Priority Inbox.
- **Calendar invitations score low** and will usually be buried. Judged
  acceptable — the dashboard has a Calendar panel and a Today zone, and mail is
  not where you should be learning about meetings — but it is a real behaviour
  change from a model that would have surfaced them.
- **More Gmail requests per refresh.** Candidates rose 25 → 35, plus one profile
  call and one list-only query per unique sender for the familiarity signal. All
  fail soft, and none fetches a message.
- **The weights are tuned against a fixture, not a real inbox.** See below.

## Validation

The scorer is exercised by 45 unit tests: every signal in isolation, the gates,
the recency curve, the reason-line construction, tie-breaking, and a 15-message
fixture inbox asserting an exact top three.

On that fixture the distribution is:

```
93.2 priya (colleague's threaded question)   ─┐
56.6 stripe (failed payment, no-reply@)       │ above floor
37.0 lease (starred, "please sign")           │
32.6 security (real alert, no-reply@)         │
27.1 sam (personal note, no ask)              │
26.3 github (PR comment asking something)    ─┘
──────────────────── FLOOR = 20 ────────────────────
 9.0 list · 6.7 calendar · 6.4 morning · 6.0 ops
 5.4/5.3/5.2 monitor ×3 · 4.2 dana · 3.4 shoes
```

40% above the floor, with a 17-point empty band around it — the threshold is not
cutting through a dense cluster, which is what makes it stable against small
weight changes.

**This has not been calibrated against a real inbox.** Doing so requires
completing Google's OAuth consent interactively, which was not available during
implementation. The weights are therefore a well-tested hypothesis, not a tuned
model, and the first real inbox should be expected to move some of them.

## Alternatives considered

- **Keeping the model as an opt-in path**, heuristic by default. Rejected: it
  keeps every cost of ADR 0009 — the key handling, the SDK, the Anthropic
  disclosure in the Privacy Policy, the "this panel can be down" failure mode —
  in exchange for a fallback most users would never switch on. Two ranking
  systems is also two things to keep correct, and the honest comparison between
  them is the one nobody would run.
- **A cheaper model.** Rejected for the same reason ADR 0009 rejected it, plus
  the new one: it does not remove the key, which is now the point.
- **Full message bodies.** Would materially improve the ask detection, which is
  the weakest part of this design. Rejected: it multiplies the amount of the
  user's life this app touches for a gain headline-level triage mostly does not
  need, and it would replace a boundary enforced by the Gmail API with a promise
  enforced by our own code.
- **Learning weights from user behaviour** (which picks get clicked). Rejected as
  premature: it needs storage, a feedback loop, and a cold-start story, and it
  would make the ranking un-inspectable again — trading away the property this
  ADR exists to gain.
- **Leaning entirely on Gmail's `IMPORTANT` label.** Free, personalised, and
  nearly as good on its own. Rejected because it cannot explain itself, cannot
  be tuned, and would make the panel a list of what Priority Inbox already shows.
