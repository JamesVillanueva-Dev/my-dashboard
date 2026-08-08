import { test, expect } from './fixtures/test';
import { seed, seedRaw, stored } from './fixtures/seed';
import { gridReady, metrics } from './fixtures/grid';
import { centre, dragMouse, frame, order, panel } from './fixtures/panel';

/**
 * The local-first promise (US-11), end to end.
 *
 * Several unit suites say some version of "the same thing a page reload does"
 * and then unmount and remount a component. That is an assumption about what a
 * reload is, not a check — the app has never once been navigated away from and
 * back in a test. This file navigates.
 */

test('a furnished dashboard comes back exactly as it was left', async ({ page }) => {
  await seed(page, {
    layout: ['notes', 'classes', 'reminders'],
    'widget.sizes': {
      notes: { cols: 1, height: null },
      classes: { cols: 1, height: null },
      reminders: { cols: 1, height: null },
    },
    'tasks.mergedTodos': true,
  });
  await page.goto('/');
  await gridReady(page, 3);

  // ---- Furnish it, the way a person would ----

  // A name, typed into the greeting. The button's accessible name is its
  // content — "friend", the placeholder shown before a name is set — not its
  // `title`, which only names a control that has no text of its own.
  await page.getByRole('button', { name: 'friend' }).click();
  await page.getByPlaceholder('your name').fill('Rowan');
  await page.keyboard.press('Enter');

  // The day's one intention.
  await page.getByRole('button', { name: /Set a focus/ }).click();
  await page.getByPlaceholder('Set your intention').fill('Ship the e2e suite');
  await page.keyboard.press('Enter');

  // A task.
  await page.getByPlaceholder('Add a task…').fill('Water the plants');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Water the plants')).toBeVisible();

  // A reorder, by pointer.
  const grip = centre(await panel(page, 'notes').grip.boundingBox().then(must));
  const target = await panel(page, 'classes').box();
  await dragMouse(page, grip, { x: target.x + target.width * 0.8, y: grip.y });
  await expect.poll(() => order(page)).toEqual(['classes', 'notes', 'reminders']);

  // A resize, by pointer. Wait for the dropped card to stop moving first: the
  // drop is animated even under reduced motion, and a handle measured mid-glide
  // gives coordinates the pointer then presses at the wrong place.
  await expect.poll(() => panel(page, 'notes').transform()).toBe('none');

  const { colWidth, colGap } = await metrics(page);
  const handle = centre(await panel(page, 'notes').handle.boundingBox().then(must));
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + colWidth + colGap, handle.y + 90, { steps: 10 });
  await frame(page);
  await page.mouse.up();
  await expect.poll(() => panel(page, 'notes').cols()).toBe(2);
  const pinnedHeight = (await panel(page, 'notes').cardBox()).height;

  // A palette.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: /Midnight|Purple & blue/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');

  // ---- Reload, and check every one of them ----

  await page.reload();
  await gridReady(page, 3);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rowan');
  await expect(page.getByRole('button', { name: /Edit today’s focus/ })).toHaveText(
    'Ship the e2e suite',
  );
  await expect(page.getByText('Water the plants')).toBeVisible();
  expect(await order(page)).toEqual(['classes', 'notes', 'reminders']);
  expect(await panel(page, 'notes').cols()).toBe(2);
  expect((await panel(page, 'notes').cardBox()).height).toBeCloseTo(pinnedHeight, 0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()))
    .toBe('#0d0b16');
});

test('removing a widget and resetting the layout both survive a reload', async ({ page }) => {
  await seed(page, { 'tasks.mergedTodos': true });
  await page.goto('/');
  await gridReady(page, 7);

  await page.getByRole('button', { name: 'Remove Weather widget' }).click();
  await expect.poll(() => order(page)).not.toContain('weather');

  await page.reload();
  await gridReady(page, 6);
  expect(await order(page)).not.toContain('weather');

  await page.getByRole('button', { name: 'Manage widgets' }).click();
  await page.getByRole('button', { name: 'Reset layout and sizes' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => order(page)).toContain('weather');

  await page.reload();
  await gridReady(page, 7);
  expect(await order(page)).toEqual([
    'reminders',
    'calendar',
    'weather',
    'classes',
    'news',
    'notes',
    'youtube',
  ]);
  expect(await stored<Record<string, unknown>>(page, 'widget.sizes')).toEqual({});
});

test('corrupt storage still boots a usable dashboard', async ({ page, consoleErrors }) => {
  // US-12. Hand-edited, truncated, or half-written values are what a real
  // `localStorage` eventually contains. `seedRaw` writes them verbatim, with no
  // JSON encoding.
  //
  // Every key here is one the app defends properly, because it runs the stored
  // value through a normalizer of its own — `normalizeFeeds`, `normalizeSize`,
  // `repairSources`, or a `JSON.parse` that simply throws. The keys that have no
  // such normalizer are a different story; see the test below.
  await seedRaw(page, {
    layout: '{"not":"an array"',
    'widget.sizes': '"compact"',
    focus: '[]',
    theme: '"a-theme-that-was-renamed"',
    'news.sources': '42',
    'classes.courses': 'null',
    'notes.text': 'unquoted text that is not JSON',
  });
  await page.goto('/');

  // It came up, with the default layout rather than with nothing.
  await gridReady(page, 7);
  expect(await order(page)).toContain('reminders');
  await expect(page.getByRole('heading', { name: 'Tasks', level: 2 })).toBeVisible();

  // An unrecognised theme falls back to the system palette rather than to an
  // unstyled page.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // And it is usable, not merely rendered.
  await page.getByPlaceholder('Add a task…').fill('Still works');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Still works')).toBeVisible();

  await page.reload();
  await gridReady(page, 7);
  await expect(page.getByText('Still works')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

/** One key, one stored value, and the crash it currently causes. */
const UNGUARDED: [string, string, string][] = [
  ['reminders', 'null', "Cannot read properties of null (reading 'filter')"],
  ['quicklinks', 'null', "Cannot read properties of null (reading 'map')"],
  ['youtube.sources', 'null', "Cannot read properties of null (reading 'some')"],
  ['user.name', '{}', 'Objects are not valid as a React child'],
];

for (const [key, value, crash] of UNGUARDED) {
  test(`a stored ${value} under "${key}" does not blank the dashboard`, async ({ page }) => {
    // KNOWN DEFECT — marked failing so the suite stays green while the bug stays
    // on the record; when it is fixed, Playwright reports the unexpected pass.
    //
    // US-12 says a dashboard with unreadable storage still boots. It does not,
    // for any key whose value is read and used directly rather than run through
    // a normalizer. The whole page goes blank — not the panel, the page, because
    // nothing in the tree is an error boundary.
    //
    // One line explains all four. `useLocalStorage`'s `read` is:
    //
    //     return stored !== null ? JSON.parse(stored) : fallback;
    //
    // `JSON.parse('null')` is `null`, which is a successful parse, so the
    // fallback never runs and `null` reaches a `.filter`/`.map`/`.some`. The
    // same gap passes `{}` to a component expecting a string. A guard on the
    // *parsed* value — rather than only on the raw string being absent — is what
    // is missing.
    test.fail();

    await seedRaw(page, { [key]: value, 'tasks.mergedTodos': 'true' });
    await page.goto('/');
    // A short, explicit timeout rather than `gridReady`: `test.fail()` expects an
    // *assertion* to fail, and a spec that runs out its 30s budget instead is
    // reported as a plain timeout — which would make this a red suite rather
    // than a recorded defect. The page is blank within a frame, so 3s is ample.
    await expect(page.getByRole('heading', { name: 'Tasks', level: 2 }), crash).toBeVisible({
      timeout: 3_000,
    });
  });
}

/** Narrows a `boundingBox()` result, which is `null` only for an unrendered node. */
function must<T>(box: T | null): T {
  if (!box) throw new Error('element has no box');
  return box;
}
