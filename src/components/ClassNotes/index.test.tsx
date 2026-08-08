import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClassNotes from './index';

/** Adds a class through the header button and the field it reveals. */
async function addClass(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Add a class' }));
  await user.type(screen.getByLabelText('Class name'), name);
  await user.click(screen.getByRole('button', { name: 'Add' }));
}

/** Adds a note to the open class, titled `label` and bodied `body`. */
async function addNote(user: ReturnType<typeof userEvent.setup>, label: string, body: string) {
  await user.click(screen.getByRole('button', { name: /Note/ }));
  await user.type(screen.getByLabelText('Note title'), label);
  if (body) await user.type(screen.getByLabelText('Note'), body);
  await user.click(screen.getByRole('button', { name: 'Done' }));
}

/** What is in storage right now. */
const storedCourses = () => JSON.parse(window.localStorage.getItem('classes.courses') ?? '[]');

/** The note titles stored for the first class, in order. */
const storedNoteLabels = () =>
  storedCourses()[0].notes.map((note: { label: string }) => note.label);

describe('ClassNotes before anything is added', () => {
  it('says what it is for, without inventing what goes in it', () => {
    render(<ClassNotes />);

    expect(screen.getByText(/no classes yet/i)).toBeInTheDocument();
    // The panel prescribes no fields, so there is nothing to fill in until the
    // user says what they want to keep.
    expect(screen.queryByLabelText('Note title')).not.toBeInTheDocument();
  });

  it('survives junk in storage instead of taking the dashboard down with it', () => {
    window.localStorage.setItem('classes.courses', JSON.stringify(['nonsense', null, 42]));

    render(<ClassNotes />);

    expect(screen.getByText(/no classes yet/i)).toBeInTheDocument();
  });
});

describe('ClassNotes classes', () => {
  it('adds a class and opens it', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);

    await addClass(user, 'CSE 101');

    expect(screen.getByRole('tab', { name: 'CSE 101' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('refuses a class with no name rather than making an unlabelled tab', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);

    await addClass(user, '   ');

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('renames a class from its heading', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');

    await user.click(screen.getByRole('button', { name: 'Rename CSE 101' }));
    const nameField = screen.getByLabelText('Class name');
    await user.clear(nameField);
    await user.type(nameField, 'Data Structures{Enter}');

    expect(screen.getByRole('tab', { name: 'Data Structures' })).toBeInTheDocument();
  });

  it('removes a class and falls back to one that still exists', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');
    await addClass(user, 'MATH 20C');

    await user.click(screen.getByRole('button', { name: 'Remove MATH 20C' }));

    expect(screen.queryByRole('tab', { name: 'MATH 20C' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'CSE 101' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps each class’s notes to itself', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');
    await addNote(user, 'Midterm', 'Nov 14');

    await addClass(user, 'MATH 20C');

    // The new class is selected and empty; switching back brings the note home.
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'CSE 101' }));
    expect(screen.getByText('Midterm')).toBeInTheDocument();
  });
});

describe('ClassNotes notes', () => {
  it('keeps a note under whatever title the user gives it', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');

    await addNote(user, 'Midterm 2', 'Nov 14, 9am, Peterson 108');

    // Read back as text, not as a form: the title the user chose is the only
    // structure the panel has.
    expect(screen.getByText('Midterm 2')).toBeInTheDocument();
    expect(screen.getByText('Nov 14, 9am, Peterson 108')).toBeInTheDocument();
    await waitFor(() => expect(storedNoteLabels()).toEqual(['Midterm 2']));
  });

  it('reopens a note for editing on a click', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');
    await addNote(user, 'Rubric', '40% final');

    await user.click(screen.getByRole('button', { name: 'Edit Rubric' }));

    expect(screen.getByLabelText('Note title')).toHaveValue('Rubric');
    expect(screen.getByLabelText('Note')).toHaveValue('40% final');
  });

  it('drops a note opened and abandoned, leaving no blank card behind', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');

    await user.click(screen.getByRole('button', { name: /Note/ }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
    await waitFor(() => expect(storedCourses()[0].notes).toEqual([]));
  });

  it('reorders notes, since the order is the only priority the panel has', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');
    await addNote(user, 'First', 'a');
    await addNote(user, 'Second', 'b');

    await user.click(screen.getByRole('button', { name: 'Edit Second' }));
    await user.click(screen.getByRole('button', { name: 'Move Second up' }));

    await waitFor(() => expect(storedNoteLabels()).toEqual(['Second', 'First']));
  });

  it('deletes a note', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');
    await addNote(user, 'Rubric', '40% final');

    await user.click(screen.getByRole('button', { name: 'Edit Rubric' }));
    await user.click(screen.getByRole('button', { name: 'Delete Rubric' }));

    expect(screen.queryByText('Rubric')).not.toBeInTheDocument();
  });
});

describe('ClassNotes across sessions and views', () => {
  it('still has everything after the dashboard is closed and reopened', async () => {
    const user = userEvent.setup();
    const view = render(<ClassNotes />);
    await addClass(user, 'CSE 101');
    await addNote(user, 'Final', 'Dec 12');
    await waitFor(() => expect(storedCourses()[0].notes).toHaveLength(1));

    view.unmount();
    render(<ClassNotes />);

    expect(screen.getByRole('tab', { name: 'CSE 101' })).toBeInTheDocument();
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.getByText('Dec 12')).toBeInTheDocument();
  });

  it('opens full screen, where the notes get the room', async () => {
    const user = userEvent.setup();
    render(<ClassNotes />);
    await addClass(user, 'CSE 101');
    await addNote(user, 'Final', 'Dec 12');

    await user.click(screen.getByRole('button', { name: 'Show Classes full screen' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Final')).toBeInTheDocument();
  });
});
