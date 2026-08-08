import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import Header from './index';
import { DashboardDataProvider } from '../../hooks/DashboardDataProvider';

/** Renders the header with the shared data provider its settings menu reads. */
function renderHeader(actions?: ReactNode) {
  return render(
    <DashboardDataProvider>
      <Header actions={actions} />
    </DashboardDataProvider>,
  );
}

describe('Header', () => {
  it('shows the current time', () => {
    renderHeader();

    expect(screen.getByLabelText('Current time')).toHaveTextContent(/^\d{1,2}:\d{2}:\d{2}/);
  });

  it('renders extra actions passed in', () => {
    renderHeader(<button>Menu</button>);

    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });
});
