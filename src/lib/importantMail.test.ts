import { describe, it, expect } from 'vitest';
import type { MailLabels, MailSummary } from './gmail';
import {
  CC_ONLY,
  DEADLINE,
  DIRECT_REQUEST,
  FLOOR,
  FWD_SUBJECT,
  IMPORTANT,
  KNOWN_SENDER,
  QUESTION_SNIPPET,
  QUESTION_SUBJECT,
  RE_SUBJECT,
  REPEAT_SENDER,
  SMALL_GROUP,
  SOLE_RECIPIENT,
  STARRED,
  THREADED,
  TO_DIRECT,
  TOP_N,
  TRANSACTIONAL,
  UNREAD,
  notable,
  rankMail,
  reasonFor,
  scoreMail,
} from './importantMail';

/** Fixed clock, so every score in this file is reproducible. */
const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

/** The signed-in user. */
const SELF = 'you@example.com';

const hoursAgo = (hours: number) => NOW - hours * 3_600_000;

/** The fields a case switches on, on top of the neutral message below. */
type MailOverrides = Partial<Omit<MailSummary, 'labels'>> & { labels?: Partial<MailLabels> };

/**
 * A message on which nothing fires: no ask, no addressing, no automation, and
 * received exactly `NOW` so the recency factor is 1. Each test switches on the
 * single thing it is about, which is what makes `total` readable as the weight.
 */
const mail = (id: string, overrides: MailOverrides = {}): MailSummary => ({
  id,
  from: 'Someone <someone@example.com>',
  subject: 'Notes',
  snippet: 'text',
  receivedAt: NOW,
  unread: false,
  to: [],
  cc: [],
  deliveredTo: [],
  listHeaders: false,
  autoHeaders: false,
  threaded: false,
  ...overrides,
  labels: {
    important: false,
    starred: false,
    updates: false,
    forums: false,
    ...overrides.labels,
  },
});

/** Scores with no context at all, so only the message itself can contribute. */
const scoreWithoutContext = (overrides: MailOverrides) =>
  scoreMail(mail('x', overrides), { self: null }, NOW).total;

/** Scores as the signed-in user, so the addressing signals can fire. */
const scoreAsSelf = (overrides: MailOverrides) =>
  scoreMail(mail('x', overrides), { self: SELF }, NOW).total;

/** The ids of a ranking, in order. */
const pickedIds = (picks: ReturnType<typeof rankMail>) => picks.map((pick) => pick.message.id);

describe('scoreMail, one signal at a time', () => {
  it('scores a star above anything it can infer', () => {
    expect(scoreWithoutContext({ labels: { starred: true } })).toBe(STARRED);
  });

  it('scores Gmail’s own importance flag', () => {
    expect(scoreWithoutContext({ labels: { important: true } })).toBe(IMPORTANT);
  });

  it('scores being in To, without the small-group bonus on a wide send', () => {
    const wideSend = [SELF, 'a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'];

    expect(scoreAsSelf({ to: wideSend })).toBe(TO_DIRECT);
  });

  it('scores being copied lower than being addressed', () => {
    const others = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'];

    expect(scoreAsSelf({ to: others, cc: [SELF] })).toBe(CC_ONLY);
    expect(CC_ONLY).toBeLessThan(TO_DIRECT);
  });

  it('adds the sole-recipient bonus to a one-to-one message', () => {
    expect(scoreAsSelf({ to: [SELF] })).toBe(TO_DIRECT + SOLE_RECIPIENT);
  });

  it('adds a smaller bonus to a small group', () => {
    expect(scoreAsSelf({ to: [SELF, 'a@x.com', 'b@x.com'] })).toBe(TO_DIRECT + SMALL_GROUP);
  });

  it('skips addressing entirely when the user’s address is unknown', () => {
    // The profile lookup fails soft; it should cost this signal, not the panel.
    expect(scoreWithoutContext({ to: [SELF] })).toBe(0);
  });

  it('falls back to Delivered-To when the profile address is missing', () => {
    const toAnAlias = { to: ['alias@example.com'], deliveredTo: ['alias@example.com'] };

    expect(scoreWithoutContext(toAnAlias)).toBe(TO_DIRECT + SOLE_RECIPIENT);
  });

  it('scores a threaded reply', () => {
    expect(scoreWithoutContext({ threaded: true })).toBe(THREADED);
  });

  it('scores a Re: subject on its own, for clients that drop the header', () => {
    expect(scoreWithoutContext({ subject: 'Re: hello' })).toBe(RE_SUBJECT);
  });

  it('scores a forward lower than a reply', () => {
    expect(scoreWithoutContext({ subject: 'Fwd: hello' })).toBe(FWD_SUBJECT);
    expect(FWD_SUBJECT).toBeLessThan(RE_SUBJECT);
  });

  it('scores transactional language', () => {
    expect(scoreWithoutContext({ subject: 'Action required' })).toBe(TRANSACTIONAL);
  });

  it('scores a direct request', () => {
    expect(scoreWithoutContext({ snippet: 'can you look at this' })).toBe(DIRECT_REQUEST);
  });

  it('scores a question in the subject above one in the preview', () => {
    expect(scoreWithoutContext({ subject: 'ready to ship?' })).toBe(QUESTION_SUBJECT);
    expect(scoreWithoutContext({ snippet: 'ready to ship?' })).toBe(QUESTION_SNIPPET);
  });

  it('scores a deadline', () => {
    expect(scoreWithoutContext({ snippet: 'the report is due by noon' })).toBe(DEADLINE);
  });

  it('does not read "due" inside another word', () => {
    // A substring match would score "duetto" as a deadline.
    expect(scoreWithoutContext({ snippet: 'we listened to a duetto' })).toBe(0);
  });

  it('scores unread modestly', () => {
    expect(scoreWithoutContext({ unread: true })).toBe(UNREAD);
    expect(UNREAD).toBeLessThan(TO_DIRECT);
  });

  it('scores a sender the user has written to before', () => {
    const knownSenders = new Set(['someone@example.com']);

    const scored = scoreMail(mail('x'), { self: null, knownSenders }, NOW);

    expect(scored.total).toBe(KNOWN_SENDER);
  });

  it('penalises a sender that fills the candidate set', () => {
    const senderCounts = new Map([['someone@example.com', 4]]);

    const scored = scoreMail(mail('x'), { self: null, senderCounts }, NOW);

    expect(scored.total).toBe(REPEAT_SENDER);
  });
});

describe('scoreMail and the bulk gate', () => {
  it('quarters a mailing', () => {
    expect(scoreWithoutContext({ listHeaders: true, unread: true })).toBeCloseTo(UNREAD * 0.25, 5);
  });

  it('recognises a mailing from either list header, automation, or the sender', () => {
    const bulkTells: MailOverrides[] = [
      { listHeaders: true },
      { autoHeaders: true },
      { labels: { updates: true } },
      { labels: { forums: true } },
      { from: 'Alerts <no-reply@x.com>' },
      { from: 'GitHub <notifications@github.com>' },
    ];

    for (const tell of bulkTells) {
      expect(scoreWithoutContext({ ...tell, unread: true })).toBeLessThan(UNREAD);
    }
  });

  it('halves rather than quarters a machine relaying a conversation', () => {
    // A pull-request comment is automated *and* a reply. Treating it like a
    // newsletter is what buries the one that actually asks you something.
    const relayed = scoreWithoutContext({ listHeaders: true, threaded: true });

    expect(relayed).toBeCloseTo(THREADED * 0.5, 5);
  });

  it('lets transactional language cancel the gate outright', () => {
    // The case a blanket demotion of automated mail gets wrong.
    const paymentFailed = { from: 'Stripe <no-reply@stripe.com>', subject: 'Action required' };

    expect(scoreWithoutContext(paymentFailed)).toBe(TRANSACTIONAL);
  });

  it('does not let marketing urgency buy that rescue', () => {
    // "Your trial expires Friday — 30% off to renew" is a sales tactic wearing
    // a consequence's clothes. Marketing vetoes the transactional cancel.
    const salesUrgency = { listHeaders: true, subject: 'Your trial expires — 30% off' };

    expect(scoreWithoutContext(salesUrgency)).toBeCloseTo(TRANSACTIONAL * 0.25 * 0.5, 5);
  });

  it('scales marketing language down even from a human', () => {
    const marketing = { subject: 'introducing our new thing', unread: true };

    expect(scoreWithoutContext(marketing)).toBeCloseTo(UNREAD * 0.5, 5);
  });
});

describe('scoreMail and recency', () => {
  /** A starred message of the given age, so only recency varies. */
  const scoreAtAge = (hours: number) =>
    scoreMail(
      mail('x', { labels: { starred: true }, receivedAt: hoursAgo(hours) }),
      { self: null },
      NOW,
    ).total;

  it('lowers the score of an older message', () => {
    expect(scoreAtAge(168)).toBeLessThan(scoreAtAge(0));
  });

  it('is worth less than any real signal, so nothing wins on being newest', () => {
    // The whole curve spans 1.0 → 0.6; it orders comparable messages and
    // nothing more.
    expect(scoreAtAge(168)).toBeGreaterThan(scoreAtAge(0) * 0.6);
  });

  it('decays smoothly rather than at a cliff', () => {
    const scoresByAge = [0, 12, 24, 48, 96, 168].map(scoreAtAge);

    for (let step = 1; step < scoresByAge.length; step++) {
      expect(scoresByAge[step]).toBeLessThan(scoresByAge[step - 1]);
    }
  });

  it('does not blow up on a message with an unreadable date', () => {
    expect(Number.isFinite(scoreWithoutContext({ receivedAt: 0 }))).toBe(true);
  });

  it('leaves merit alone, so age cannot push a message under the floor', () => {
    const old = scoreMail(mail('x', { labels: { starred: true }, receivedAt: hoursAgo(168) }), { self: null }, NOW);
    const fresh = scoreMail(mail('x', { labels: { starred: true }, receivedAt: NOW }), { self: null }, NOW);

    expect(old.total).toBeLessThan(fresh.total);
    expect(old.merit).toBe(fresh.merit);
  });
});

describe('reasonFor', () => {
  it('leads with what the message asks, not with metadata', () => {
    const { signals } = scoreMail(
      mail('x', {
        subject: 'Action required: your payment failed',
        to: [SELF],
        unread: true,
        labels: { important: true },
      }),
      { self: SELF },
      NOW,
    );

    // Gmail's flag contributes the most points and says the least.
    expect(reasonFor(signals)).toBe('Flags action required, addressed to you alone');
  });

  it('does not say the same thing twice', () => {
    const { signals } = scoreMail(mail('x', { to: [SELF] }), { self: SELF }, NOW);

    expect(reasonFor(signals)).toBe('Addressed to you alone');
  });

  it('stays within the line the panel renders', () => {
    const { signals } = scoreMail(
      mail('x', {
        subject: 'Re: can you approve this by Friday?',
        snippet: 'waiting on your sign off — please confirm?',
        to: [SELF],
        threaded: true,
        unread: true,
        labels: { important: true, starred: true },
      }),
      { self: SELF },
      NOW,
    );

    expect(reasonFor(signals).length).toBeLessThanOrEqual(90);
  });

  it('never speaks for a gate', () => {
    const { signals } = scoreMail(
      mail('x', { listHeaders: true, unread: true }),
      { self: null },
      NOW,
    );

    expect(reasonFor(signals)).toBe('Unread');
  });
});

describe('rankMail', () => {
  it('returns nothing for an empty inbox', () => {
    expect(rankMail([], { self: SELF }, NOW)).toEqual([]);
  });

  it('calls nothing important rather than the best of a bad inbox', () => {
    // A heuristic always produces a top three. The floor is what lets the panel
    // decline to. The junk is still ranked — full screen fills its window from
    // the tail — but none of it is claimed to matter.
    const junk = [
      mail('a', { listHeaders: true, unread: true, to: [SELF], subject: '50% off everything' }),
      mail('b', { listHeaders: true, unread: true, to: [SELF], subject: 'Our weekly newsletter' }),
      mail('c', { autoHeaders: true, unread: true, to: [SELF], subject: 'Deploy succeeded' }),
    ];

    const picks = rankMail(junk, { self: SELF }, NOW);

    expect(notable(picks)).toEqual([]);
    expect(picks).toHaveLength(junk.length);
  });

  it('finds only one notable when only one clears the floor', () => {
    const picks = rankMail(
      [
        mail('good', { to: [SELF], unread: true, subject: 'can you review this?' }),
        mail('junk', { listHeaders: true, subject: 'Newsletter' }),
      ],
      { self: SELF },
      NOW,
    );

    expect(pickedIds(notable(picks))).toEqual(['good']);
  });

  it('sorts everything under the floor below everything over it', () => {
    // What lets the full-screen view fill its ten rows with a plain `slice`, and
    // what stops a high-scoring newsletter displacing a real message that only
    // just cleared the bar.
    const picks = rankMail(
      [
        mail('junk', { listHeaders: true, unread: true, to: [SELF], subject: 'Newsletter' }),
        mail('bare', { to: [SELF], unread: true }),
        mail('ask', { to: [SELF], unread: true, subject: 'can you review this?' }),
      ],
      { self: SELF },
      NOW,
    );

    expect(pickedIds(picks)).toEqual(['ask', 'bare', 'junk']);
    expect(picks.map((pick) => pick.merit >= FLOOR)).toEqual([true, true, false]);
  });

  it('ranks past what the panel shows, so a dismissal has something to promote', () => {
    const allStrong = [...'abcde'].map((id) =>
      mail(id, { to: [SELF], unread: true, subject: 'can you review this?' }),
    );

    // Every one of them clears the floor, and every one is returned. Cutting to
    // three here would leave the panel nothing to reach for when a pick is
    // waved away — the window belongs to the caller.
    expect(rankMail(allStrong, { self: SELF }, NOW)).toHaveLength(allStrong.length);
    expect(allStrong.length).toBeGreaterThan(TOP_N);
  });

  it('keeps ordinary mail in the ranking as it ages, rather than dropping it', () => {
    // Recency orders this list; it must not empty it. Applied before the floor,
    // the ×0.6 tail would delete every plain message over ~2 days old — leaving
    // the panel three picks and nothing behind them to promote on a dismissal.
    const week = [1, 24, 60, 100, 168].map((hours) =>
      mail(`h${hours}`, { to: [SELF], unread: true, receivedAt: hoursAgo(hours) }),
    );

    const picks = rankMail(week, { self: SELF }, NOW);

    expect(pickedIds(picks)).toEqual(['h1', 'h24', 'h60', 'h100', 'h168']);
  });

  it('breaks a tie on recency', () => {
    const tied = (id: string, hours: number) =>
      mail(id, {
        to: [SELF],
        unread: true,
        subject: 'can you review?',
        receivedAt: hoursAgo(hours),
      });

    const picks = rankMail([tied('b', 5), tied('a', 1)], { self: SELF }, NOW);

    expect(pickedIds(picks)).toEqual(['a', 'b']);
  });

  it('breaks a tie of the same age on id, never on Gmail’s order', () => {
    const sameAge = (id: string) =>
      mail(id, { to: [SELF], unread: true, subject: 'can you review?', receivedAt: hoursAgo(3) });

    const picks = rankMail([sameAge('z'), sameAge('y')], { self: SELF }, NOW);

    expect(pickedIds(picks)).toEqual(['y', 'z']);
  });

  it('derives the repeat-sender penalty across the whole candidate set', () => {
    // The count is a property of the inbox, not of a message, so `rankMail`
    // works it out rather than taking it on trust from the caller.
    const ask = { to: [SELF], unread: true, subject: 'can you review?' };

    const alone = rankMail([mail('a', ask)], { self: SELF }, NOW);
    const crowd = rankMail(
      [1, 2, 3].map((index) => mail(`s${index}`, { ...ask, from: 'Bot <bot@x.com>' })),
      { self: SELF },
      NOW,
    );

    expect(crowd[0].score).toBe(alone[0].score + REPEAT_SENDER);
  });

  it('carries the breakdown that produced each pick', () => {
    const [pick] = rankMail(
      [mail('a', { to: [SELF], subject: 'can you review?' })],
      { self: SELF },
      NOW,
    );

    expect(pick.score).toBeGreaterThanOrEqual(FLOOR);
    expect(pick.signals.map((signal) => signal.key)).toContain('request');
    expect(
      pick.signals.every(
        (signal) => typeof signal.points === 'number' && typeof signal.factor === 'number',
      ),
    ).toBe(true);
  });
});

/**
 * The real test of this feature: a week of ordinary mail, ranked whole.
 *
 * Every message here is a shape that turns up in a real inbox, and the top
 * three are the ones a person would pick reading it themselves.
 */
describe('rankMail on a realistic inbox', () => {
  const inbox: MailSummary[] = [
    mail('priya', {
      from: 'Priya Raman <priya@work.com>',
      subject: 'Re: Q3 deck — can you review by Thursday?',
      snippet: 'Left comments on slides 4-7. Can you take a look before the sync?',
      to: [SELF, 'sam@work.com'],
      threaded: true,
      unread: true,
      labels: { important: true },
      receivedAt: hoursAgo(5),
    }),
    mail('stripe', {
      from: 'Stripe <no-reply@stripe.com>',
      subject: 'Action required: your payment failed',
      snippet: 'We were unable to charge your card ending 4242.',
      to: [SELF],
      autoHeaders: true,
      unread: true,
      labels: { important: true },
      receivedAt: hoursAgo(3),
    }),
    mail('lease', {
      from: 'Landlord <lease@property.com>',
      subject: 'Lease renewal documents',
      snippet: 'Please review and sign the attached lease.',
      to: [SELF],
      labels: { starred: true },
      receivedAt: hoursAgo(100),
    }),
    mail('security', {
      from: 'Google <no-reply@accounts.google.com>',
      subject: 'Security alert',
      snippet: 'A new sign-in on Windows.',
      to: [SELF],
      autoHeaders: true,
      unread: true,
      receivedAt: hoursAgo(30),
    }),
    mail('sam', {
      from: 'Sam Ortiz <sam@work.com>',
      subject: 'Files from yesterday',
      snippet: 'Attaching the exports we talked about.',
      to: [SELF],
      unread: true,
      receivedAt: hoursAgo(4),
    }),
    mail('github', {
      from: 'GitHub <notifications@github.com>',
      subject: 'Re: [acme/web] Fix the sync race (#42)',
      snippet: 'sam commented: can you confirm this matches the ADR?',
      to: [SELF],
      threaded: true,
      listHeaders: true,
      unread: true,
      labels: { updates: true },
      receivedAt: hoursAgo(8),
    }),
    mail('calendar', {
      from: 'Google Calendar <calendar-notification@google.com>',
      subject: 'Invitation: Design review @ Thu Aug 6, 2pm',
      snippet: 'You have been invited to Design review.',
      to: [SELF],
      autoHeaders: true,
      unread: true,
      receivedAt: hoursAgo(6),
    }),
    mail('ops', {
      from: 'Ops <ops@work.com>',
      subject: 'Office closed Monday',
      snippet: 'The building will be closed for maintenance.',
      to: ['all@work.com'],
      cc: [SELF],
      receivedAt: hoursAgo(20),
    }),
    mail('list', {
      from: 'Design Systems <list@groups.io>',
      subject: 'Re: tokens naming',
      snippet: 'I think the prefix should stay.',
      to: ['list@groups.io'],
      listHeaders: true,
      threaded: true,
      unread: true,
      labels: { forums: true },
      receivedAt: hoursAgo(14),
    }),
    mail('dana', {
      from: 'Dana Reeves <dana@growthco.com>',
      subject: 'Introducing our Series B — and 30% off through Friday',
      snippet: 'We are thrilled to announce our raise. Don’t miss our biggest sale of the year.',
      to: [SELF],
      listHeaders: true,
      unread: true,
      receivedAt: hoursAgo(10),
    }),
    mail('morning', {
      from: 'The Morning <hello@themorning.com>',
      subject: 'Tuesday: three things to know',
      snippet: 'Markets, weather, and one good story.',
      to: [SELF],
      listHeaders: true,
      unread: true,
      receivedAt: hoursAgo(12),
    }),
    mail('shoes', {
      from: 'Shoes <deals@shoes.com>',
      subject: 'Final hours: 40% off everything',
      snippet: 'Shop now before the sale ends.',
      to: [SELF],
      listHeaders: true,
      unread: true,
      receivedAt: hoursAgo(2),
    }),
    ...[1, 2, 3].map((index) =>
      mail(`monitor-${index}`, {
        from: 'Monitor <alerts@monitor.io>',
        subject: 'Deploy succeeded',
        snippet: 'Build 41 shipped to production.',
        to: [SELF],
        autoHeaders: true,
        unread: true,
        receivedAt: hoursAgo(index * 2),
      }),
    ),
  ];

  const context = { self: SELF, knownSenders: new Set(['priya@work.com']) };
  const picks = rankMail(inbox, context, NOW);

  /** What the panel actually shows: the top of the ranking it windows. */
  const shown = picks.slice(0, TOP_N);

  /** One message's score in the context of this whole inbox. */
  const scoreOf = (id: string) => scoreMail(inbox.find((each) => each.id === id)!, context, NOW).total;

  it('picks the colleague’s question, the failed payment, and the lease', () => {
    expect(pickedIds(shown)).toEqual(['priya', 'stripe', 'lease']);
  });

  it('explains each pick in the panel’s words', () => {
    expect(shown.map((pick) => pick.reason)).toEqual([
      'Makes a direct request, asks a direct question',
      'Flags action required, addressed to you alone',
      // The star is what lifted the lease into the list, but "please review and
      // sign" is what the reader needs to know — the ask leads, by design.
      'Makes a direct request, addressed to you alone',
    ]);
  });

  it('picks the lease over newer mail, because nothing wins on being newest', () => {
    // 100 hours old, read, and still third — a star and "please sign" outrank
    // four fresher messages.
    const lease = picks[2];

    const fresher = inbox.filter((each) => each.receivedAt > lease.message.receivedAt);

    expect(fresher.length).toBeGreaterThan(4);
  });

  it('buries every newsletter and promotion', () => {
    for (const id of ['dana', 'morning', 'shoes', 'list']) {
      expect(scoreOf(id)).toBeLessThan(FLOOR);
    }
  });

  it('keeps a real alert from a no-reply address well above the floor', () => {
    expect(scoreOf('security')).toBeGreaterThan(FLOOR);
  });

  it('keeps the sender that filled the inbox with three of the same out of it', () => {
    expect(pickedIds(notable(picks)).some((id) => id.startsWith('monitor'))).toBe(false);
  });
});
