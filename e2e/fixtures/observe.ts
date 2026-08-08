import type { Page } from '@playwright/test';

/**
 * Answering "was this ever on screen?" rather than "is it on screen now?".
 *
 * Loading states are the thing this suite is least able to catch by looking:
 * against a stubbed response they can come and go inside a single frame, so an
 * assertion that samples after the fact finds nothing and cannot tell "it
 * flashed and passed" from "it never rendered". Both questions matter here —
 * a skeleton *should* appear on a cold load and *should not* on a cached one —
 * and both need the whole render observed, not one moment of it.
 *
 * Installed as an init script so it is watching before React mounts.
 *
 * @param page - The page to watch. Call before the navigation being observed.
 * @param selector - What to look for.
 * @returns A reader for whether it was ever present.
 */
export async function watchFor(
  page: Page,
  selector: string,
): Promise<{ everSeen(): Promise<boolean> }> {
  const key = `__seen_${Math.random().toString(36).slice(2)}`;

  await page.addInitScript(
    ([flagKey, target]) => {
      const state = { seen: false };
      (window as unknown as Record<string, { seen: boolean }>)[flagKey] = state;
      const look = () => {
        if (document.querySelector(target)) state.seen = true;
      };
      look();
      // `document`, not `document.documentElement`. An init script runs at
      // document-start, before the HTML is parsed, so `documentElement` can
      // still be null — and `observe(null)` throws, which would leave the
      // watcher silently uninstalled and every "was it seen" answer a
      // confident, meaningless `false`.
      new MutationObserver(look).observe(document, { childList: true, subtree: true });
    },
    [key, selector] as const,
  );

  return {
    everSeen: () =>
      page.evaluate(
        (flagKey) =>
          (window as unknown as Record<string, { seen: boolean } | undefined>)[flagKey]?.seen ??
          false,
        key,
      ),
  };
}
