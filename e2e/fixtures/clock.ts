import type { Page } from '@playwright/test';

/**
 * The instant every spec runs at.
 *
 * A Tuesday morning, late enough that "today" is unambiguous in any timezone the
 * runner might be in. `TodayPanel` counts what falls on *today* and the daily
 * focus expires against the local date, so a floating clock makes those specs
 * fail near midnight — the same trap `TodayPanel/index.test.tsx` documents.
 */
export const FIXED_NOW = '2026-03-17T09:30:00.000Z';

/**
 * Freezes the page's clock.
 *
 * Deliberately `setFixedTime` rather than `install()`: the latter also fakes
 * timers, which would stop `requestAnimationFrame` and take the drag path with
 * it. This pins `Date` alone and leaves the event loop real.
 *
 * @param page - The page to pin. Call before `page.goto`.
 * @param iso - The instant to freeze at. Defaults to {@link FIXED_NOW}.
 */
export async function pinClock(page: Page, iso: string = FIXED_NOW): Promise<void> {
  await page.clock.setFixedTime(new Date(iso));
}
