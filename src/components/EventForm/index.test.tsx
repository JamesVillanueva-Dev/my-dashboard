import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventForm from './index';
import type { CalendarOption } from '../../lib/gcalEvents';
import type { EventDraft } from '../../lib/gcalWrite';

const CALENDARS: CalendarOption[] = [
  { id: 'primary', title: 'Personal', primary: true, canWrite: true },
  { id: 'work', title: 'Work', primary: false, canWrite: true },
  { id: 'holidays', title: 'Holidays in the UK', primary: false, canWrite: false },
];

function draft(over: Partial<EventDraft> = {}): EventDraft {
  return {
    calendarId: 'primary',
    title: 'Standup',
    allDay: false,
    startDate: '2026-08-03',
    startTime: '09:00',
    endDate: '2026-08-03',
    endTime: '10:00',
    location: '',
    description: '',
    ...over,
  };
}

function setup(props: Partial<ComponentProps<typeof EventForm>> = {}) {
  const handlers = { onSave: vi.fn(), onDelete: vi.fn(), onCancel: vi.fn() };
  render(
    <EventForm
      draft={draft()}
      calendars={CALENDARS}
      editing={false}
      recurring={false}
      saving={false}
      error=""
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('EventForm', () => {
  it('shows the draft it was given', () => {
    setup({ draft: draft({ location: 'Room 2', description: 'Bring the deck' }) });

    expect(screen.getByLabelText('Title')).toHaveValue('Standup');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-08-03');
    expect(screen.getByLabelText('Start time')).toHaveValue('09:00');
    expect(screen.getByLabelText('Where')).toHaveValue('Room 2');
    expect(screen.getByLabelText('Notes')).toHaveValue('Bring the deck');
    expect(screen.getByLabelText('Calendar')).toHaveValue('primary');
  });

  it('offers only the calendars the user can write to', () => {
    setup();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Personal', 'Work']);
  });

  it('hides the time fields for an all-day event', async () => {
    const { user } = setup();

    expect(screen.getByLabelText('Start time')).toBeInTheDocument();
    await user.click(screen.getByLabelText('All day'));

    expect(screen.queryByLabelText('Start time')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('End time')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Starts')).toBeInTheDocument();
  });

  it('drags the end date along when the start moves past it', async () => {
    const { user, onSave } = setup();

    await user.clear(screen.getByLabelText('Starts'));
    await user.type(screen.getByLabelText('Starts'), '2026-08-20');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-08-20', endDate: '2026-08-20' }),
    );
  });

  it('hands the edited draft back on save', async () => {
    const { user, onSave } = setup();

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Retro');
    await user.selectOptions(screen.getByLabelText('Calendar'), 'work');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Retro', calendarId: 'work' }),
    );
  });

  it('offers no delete when creating', () => {
    setup({ editing: false });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('takes two clicks to delete', async () => {
    const { user, onDelete } = setup({ editing: true });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this event?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('backs out of a delete on Keep', async () => {
    const { user, onDelete } = setup({ editing: true });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this event?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('surfaces an error without clearing what was typed', () => {
    setup({ error: 'Give the event a title.', draft: draft({ title: 'Half typed' }) });

    expect(screen.getByRole('alert')).toHaveTextContent('Give the event a title.');
    expect(screen.getByLabelText('Title')).toHaveValue('Half typed');
  });

  it('warns that editing a repeating event touches one occurrence', () => {
    setup({ editing: true, recurring: true });
    expect(screen.getByText(/occurrence only/i)).toBeInTheDocument();
  });

  it('locks the controls while saving', () => {
    setup({ editing: true, saving: true });

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('cancels without saving', async () => {
    const { user, onCancel, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
