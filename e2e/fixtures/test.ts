import { test as base, expect } from '@playwright/test';
import { pinClock } from './clock';
import { stubNetwork, type NetworkStub } from './network';

/**
 * The `test` every spec imports.
 *
 * Three things are wired in for all of them rather than left to be remembered:
 * the network is stubbed and anything unrouted fails the test, the clock is
 * pinned, and console output is collected. Both are automatic — a spec that
 * forgets the routing is a spec that reaches the real internet, and that is the
 * failure mode this suite is least able to diagnose later.
 */

/** Extra fixtures available to every spec. */
interface Fixtures {
  /** Canned external responses, and the switches for making one fail. */
  network: NetworkStub;
  /** Console errors and unhandled rejections, in arrival order. */
  consoleErrors: string[];
  /** Applies {@link Options.motion}. Automatic; nothing needs to request it. */
  media: void;
}

/** Per-spec options, set with `test.use({ … })`. */
interface Options {
  /**
   * Whether the page asks for reduced motion. Rule 4: animations are off by
   * default, so a spec never measures a card mid-glide — `flip.spec.ts` is the
   * one that turns them back on, because they are what it is about.
   *
   * Deliberately *not* Playwright's own `reducedMotion` context option, which as
   * of 1.62.1 never reaches `contextOptions` and so quietly does nothing: the
   * page still reported `prefers-reduced-motion: no-preference` with it set
   * every way the docs allow. `emulateMedia` does work, so the option is applied
   * by hand below.
   */
  motion: 'reduce' | 'no-preference';
}

/**
 * Console output that is noise rather than a defect.
 *
 * Kept deliberately short — the value of the console check is that it is
 * absolute, and every entry here is a hole in it.
 */
const IGNORED = [
  /**
   * Fired when a `ResizeObserver` callback changes layout and the browser has to
   * defer the resulting notifications to the next frame. It reaches
   * `window.onerror`, so it looks like an exception, but nothing is thrown and
   * nothing is lost — the observation is simply delivered late.
   *
   * The dashboard raises it on almost every load: `useWidgetLayout` observes
   * each card and writes a row span in response, which is a layout change made
   * from inside an observation, by design. Left unfiltered it would land in
   * whichever spec happened to be running and read as a random failure.
   */
  /ResizeObserver loop completed with undelivered notifications/,
];

export const test = base.extend<Fixtures & Options>({
  motion: ['reduce', { option: true }],

  media: [
    async ({ page, motion }, use) => {
      await page.emulateMedia({ reducedMotion: motion });
      await use();
    },
    { auto: true },
  ],

  network: [
    async ({ page }, use) => {
      const stub = await stubNetwork(page);
      await pinClock(page);
      await use(stub);
      // Rule 5's sibling: prove the spec never left the stub, rather than assume it.
      expect(
        stub.unstubbed,
        'the spec made external requests with no rule in `network.ts`',
      ).toEqual([]);
    },
    { auto: true },
  ],

  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const keep = (text: string) => !IGNORED.some((pattern) => pattern.test(text));

      page.on('console', (message) => {
        if (message.type() === 'error' && keep(message.text())) errors.push(message.text());
      });
      page.on('pageerror', (error) => {
        if (keep(error.message)) errors.push(`uncaught: ${error.message}`);
      });
      await use(errors);
    },
    { auto: true },
  ],
});

export { expect };
