# Project conventions

## Folder-as-component

Every component lives in its own folder. The main file is always `index.tsx` and
the stylesheet is always `styles.module.css`, co-located beside it. Tests are
co-located too, as `index.test.tsx`.

```
src/components/EventsCard/
├── index.tsx
├── index.test.tsx
└── styles.module.css
```

Create new components with the scaffold rather than by hand:

```bash
npm run create:component
```

## Where things go

There is exactly **one** components folder: `src/components/`. Every component
goes there — no nesting by feature, no second components directory.

Non-component code sits alongside it:

- `src/hooks/` — all hooks
- `src/lib/` — the widget registry and non-React logic (API clients, sync, auth)
- `src/styles.css` — the only global stylesheet
- `src/styles/controls.module.css` — shared style primitives

A module used by exactly one component may live inside that component's folder
(see `src/components/Widget/chrome.ts`, the grid↔widget contract).

## CSS Modules only

All styles use CSS Modules. No global CSS, no inline styles, no utility class
libraries. The only exceptions are the global resets and CSS custom properties in
`src/styles.css`.

```tsx
import styles from './styles.module.css';
```

### `.container` is always the root

The outermost element of every component uses `styles.container`:

```tsx
return <div className={styles.container}>...</div>;
```

Widgets render through the shared `<Widget>` shell, which has no outer element of
their own to attach to — they pass their root class to it instead, which puts it
on the card element:

```tsx
<Widget title="Weather" className={styles.container}>
```

### Prefer descendant selectors over per-element classNames

Keep `.tsx` files clean. If an element can be targeted with a descendant
selector, do that in CSS rather than adding a `className`.

```css
/* preferred */
.container h1 { font-size: 1.5rem; }
.container p  { color: var(--text-muted); }
```

```tsx
/* preferred — no className on inner elements */
<div className={styles.container}>
  <h1>Title</h1>
  <p>Body</p>
</div>
```

Only add a `className` to an element when:

- the descendant selector would be ambiguous or fragile, or
- the element needs its own isolated style that cannot be expressed cleanly as a
  descendant rule.

Note that `composes` only works on a class selector, so an element that needs a
shared primitive does take a `className` (e.g. `.add { composes: btn ... }`).

### Sharing styles

`src/styles/controls.module.css` holds the few primitives used across many
widgets (`pill`, `btn`, `link`, `muted`, `small`, `empty`). Pull them in with
`composes`, which puts both class names on the element:

```css
.add {
  composes: btn from '../../styles/controls.module.css';
}
```

Keep that file small — anything used by one component belongs in that component's
`styles.module.css`.

### State classes

Use camelCase `is*` modifiers alongside the base class:

```tsx
className={`${styles.tab}${active ? ` ${styles.isActive}` : ''}`}
```

```css
.tab.isActive { border-color: var(--accent); }
```

Because module class names are hashed at build time, tests must not assert on
literal strings — import the stylesheet and assert on `styles.isActive`.

## Checks

`npm run lint`, `npx tsc -b`, and `npm run test:run` should all pass before a
change is considered done.
