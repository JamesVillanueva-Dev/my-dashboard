#!/usr/bin/env node
/**
 * Scaffolds a component in the folder-as-component layout this project uses.
 * Every component lives in one flat directory, `src/components/<Name>/`:
 *
 *   src/components/<Name>/
 *   ├── index.tsx           the component, root element gets styles.container
 *   ├── index.test.tsx      a starter render test
 *   └── styles.module.css   its stylesheet
 *
 * Usage:
 *   npm run create:component
 *   npm run create:component -- EventsCard
 *   npm run create:component -- EventsCard --no-test
 *
 * With no arguments it prompts for the name.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { join, relative, sep } from 'node:path';
import { stdin, stdout, argv, exit } from 'node:process';

/** The one components folder. Everything is created flat inside it. */
const COMPONENTS = join('src', 'components');

/** Parses `argv` into `{ name, test }`. */
function parseArgs(args) {
  const opts = { name: '', test: true };
  for (const arg of args) {
    if (arg === '--no-test') opts.test = false;
    else if (!arg.startsWith('-')) opts.name = arg;
  }
  return opts;
}

/** True when `path` already exists. */
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Fails with a message rather than writing something the conventions reject. */
function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  exit(1);
}

/** `EventsCard` -> `events-card`, used for the CSS comment header. */
function toKebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * The component itself. Carries the conventions a new file is expected to keep:
 * a documented props interface, a docblock on the component, and `.container` on
 * the root element.
 *
 * @param name - PascalCase component name.
 * @returns Contents for `index.tsx`.
 */
const indexTsx = (name) => `import styles from './styles.module.css';

/** Props for {@link ${name}}. */
interface ${name}Props {
  /** Replace with the component's real props. */
  title: string;
}

/**
 * TODO: describe what ${name} renders and what it owns.
 *
 * @param props - See {@link ${name}Props}.
 */
export default function ${name}({ title }: ${name}Props) {
  return (
    <div className={styles.container}>
      <h2>{title}</h2>
    </div>
  );
}
`;

/**
 * The stylesheet, opening with `.container` so the root class exists from the
 * start and the descendant-selector convention is stated where it applies.
 *
 * @param name - PascalCase component name.
 * @returns Contents for `styles.module.css`.
 */
const stylesCss = (name) => `/* ${toKebab(name)}
   \`.container\` is the root. Prefer descendant selectors (\`.container h2\`)
   over adding a className to every inner element. */
.container {
  display: flex;
  flex-direction: column;
}
`;

/**
 * A starter render test, so a new component arrives with a passing test rather
 * than a gap someone has to notice.
 *
 * @param name - PascalCase component name.
 * @returns Contents for `index.test.tsx`.
 */
const testTsx = (name) => `import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ${name} from './index';

describe('${name}', () => {
  it('renders its title', () => {
    render(<${name} title="Hello" />);
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
  });
});
`;

// ---------------------------------------------------------------------------
// Run: resolve a name, refuse anything the conventions reject, then write.
// ---------------------------------------------------------------------------

const opts = parseArgs(argv.slice(2));

// Prompt for the name if it wasn't supplied on the command line.
if (!opts.name) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    opts.name = (await rl.question('Component name (PascalCase, e.g. EventsCard): ')).trim();
  } finally {
    rl.close();
  }
}

if (!/^[A-Z][A-Za-z0-9]*$/.test(opts.name)) {
  fail(`Component name must be PascalCase, got "${opts.name}".`);
}

const dir = join(COMPONENTS, opts.name);

if (await exists(dir)) fail(`${dir} already exists.`);

await mkdir(dir, { recursive: true });

// `[filename, contents]` pairs, written together so a half-scaffolded folder is
// not left behind if one of them fails.
const files = [
  ['index.tsx', indexTsx(opts.name)],
  ['styles.module.css', stylesCss(opts.name)],
];
if (opts.test) files.push(['index.test.tsx', testTsx(opts.name)]);

await Promise.all(files.map(([file, body]) => writeFile(join(dir, file), body, 'utf8')));

console.log(`\n  ✓ Created ${opts.name}\n`);
for (const [file] of files) console.log(`      ${relative('.', join(dir, file)).split(sep).join('/')}`);
console.log('');
