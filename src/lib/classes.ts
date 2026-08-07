/**
 * The class notebook's data model: courses, and whatever the user wants to
 * remember about each one.
 *
 * The shape here is deliberately empty of opinions. There is no `examDate`, no
 * `rubric`, no `officeHours` — a note is a label the user typed and a body the
 * user typed, and that is the whole vocabulary. Fields chosen in advance are a
 * guess about how somebody studies, and every wrong guess is either a box they
 * cannot use or a thing they cannot record. A course with three exam dates and
 * one about a group project neither fit a fixed form; both fit this one.
 *
 * Pure and storage-free, like the rest of `lib/`: every function takes the
 * current state and returns the next, so the component owns persistence and
 * these can be argued with in a test.
 */

/**
 * One thing worth remembering about a course.
 *
 * `label` is the user's own name for the slot — "Midterm 2", "Rubric", "Where
 * the lab is" — and `body` is what they wrote under it.
 */
export interface ClassNote {
  /** Stable id, for React keys and edits. */
  id: string;
  /** The user's name for this note. May be empty while it is being written. */
  label: string;
  /** The note itself. Free text, newlines and all. */
  body: string;
}

/** One course, and everything recorded against it. */
export interface CourseEntry {
  /** Stable id, referenced by the selected-course setting. */
  id: string;
  /** What the user calls it — "CSE 101", "Organic Chemistry". */
  name: string;
  /** The user's notes, in the order they added them. */
  notes: ClassNote[];
}

/** Longest a course name may be, so the tab row stays readable. */
export const NAME_MAX = 40;

/**
 * Mints an id that is unique among ids created in this browser.
 *
 * `Date.now()` alone collides when two notes are added in the same millisecond,
 * which is easy to do by holding the button — the counter is what makes that
 * safe without pulling in a uuid dependency (ADR 0001 keeps this app dependency
 * free).
 */
let counter = 0;
export function newId(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

/**
 * Repairs whatever came out of storage into something renderable.
 *
 * Persisted data outlives the code that wrote it: a hand-edited `localStorage`,
 * a half-finished older shape, or a value from a future version all arrive
 * here. Anything unrecognisable is dropped rather than rendered, so a bad entry
 * costs that entry instead of the panel.
 *
 * @param stored - The raw persisted value, of no trustworthy type.
 * @returns Courses safe to render, each with a usable id.
 */
export function normalizeCourses(stored: unknown): CourseEntry[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const { id, name, notes } = raw as Partial<CourseEntry>;
    if (typeof name !== 'string') return [];
    return [
      {
        id: typeof id === 'string' && id ? id : newId(),
        name: name.slice(0, NAME_MAX),
        notes: Array.isArray(notes) ? notes.flatMap(normalizeNote) : [],
      },
    ];
  });
}

/** One note out of storage, or nothing if it is not one. */
function normalizeNote(raw: unknown): ClassNote[] {
  if (!raw || typeof raw !== 'object') return [];
  const { id, label, body } = raw as Partial<ClassNote>;
  if (typeof label !== 'string' && typeof body !== 'string') return [];
  return [
    {
      id: typeof id === 'string' && id ? id : newId(),
      label: typeof label === 'string' ? label : '',
      body: typeof body === 'string' ? body : '',
    },
  ];
}

/**
 * Adds a course, named as typed.
 *
 * @returns The next list, or the original when `name` is blank — an unnamed
 *   course is a tab nobody can identify, so it is refused rather than created.
 */
export function addCourse(courses: CourseEntry[], name: string): CourseEntry[] {
  const trimmed = name.trim().slice(0, NAME_MAX);
  if (!trimmed) return courses;
  return [...courses, { id: newId(), name: trimmed, notes: [] }];
}

/** Removes a course and everything under it. */
export function removeCourse(courses: CourseEntry[], id: string): CourseEntry[] {
  return courses.filter((course) => course.id !== id);
}

/** Renames a course, ignoring a blank name so a tab cannot lose its label. */
export function renameCourse(courses: CourseEntry[], id: string, name: string): CourseEntry[] {
  const trimmed = name.trim().slice(0, NAME_MAX);
  if (!trimmed) return courses;
  return courses.map((course) => (course.id === id ? { ...course, name: trimmed } : course));
}

/**
 * Adds an empty note to a course, for the user to name and fill.
 *
 * Empty on purpose: the note is created by the same click that starts editing
 * it, so there is nothing to prompt for first.
 */
export function addNote(courses: CourseEntry[], courseId: string): CourseEntry[] {
  return courses.map((course) =>
    course.id === courseId
      ? { ...course, notes: [...course.notes, { id: newId(), label: '', body: '' }] }
      : course,
  );
}

/** Applies an edit to one note, leaving every other course and note alone. */
export function editNote(
  courses: CourseEntry[],
  courseId: string,
  noteId: string,
  patch: Partial<Pick<ClassNote, 'label' | 'body'>>,
): CourseEntry[] {
  return courses.map((course) =>
    course.id === courseId
      ? {
          ...course,
          notes: course.notes.map((note) => (note.id === noteId ? { ...note, ...patch } : note)),
        }
      : course,
  );
}

/** Removes one note from one course. */
export function removeNote(courses: CourseEntry[], courseId: string, noteId: string): CourseEntry[] {
  return courses.map((course) =>
    course.id === courseId
      ? { ...course, notes: course.notes.filter((note) => note.id !== noteId) }
      : course,
  );
}

/**
 * Moves a note one place up or down within its course.
 *
 * The order is the user's — what they consider most worth seeing first — so it
 * is worth being able to change without deleting and retyping. A move off
 * either end is a no-op rather than a wrap.
 */
export function moveNote(
  courses: CourseEntry[],
  courseId: string,
  noteId: string,
  delta: number,
): CourseEntry[] {
  return courses.map((course) => {
    if (course.id !== courseId) return course;
    const from = course.notes.findIndex((note) => note.id === noteId);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= course.notes.length) return course;
    const notes = [...course.notes];
    const [moved] = notes.splice(from, 1);
    notes.splice(to, 0, moved);
    return { ...course, notes };
  });
}

/**
 * True when a note has nothing in it at all.
 *
 * Used to keep a note the user opened and abandoned from being written back as
 * a blank row — the panel drops these rather than rendering an empty card.
 */
export function isBlank(note: ClassNote): boolean {
  return note.label.trim() === '' && note.body.trim() === '';
}

/**
 * The course a saved selection points at, falling back to the first.
 *
 * A stored id can name a course that has since been removed, which would
 * otherwise leave the panel showing nothing with no way back to a course that
 * does exist.
 */
export function selectedCourse(courses: CourseEntry[], id: string): CourseEntry | null {
  return courses.find((course) => course.id === id) ?? courses[0] ?? null;
}
