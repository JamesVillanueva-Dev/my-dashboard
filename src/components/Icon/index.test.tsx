import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Icon from './index';

describe('Icon', () => {
  it('hides decorative icons from assistive tech', () => {
    const { container } = render(<Icon name="calendar" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('exposes a labelled icon as an image', () => {
    render(<Icon name="sun" label="Clear sky" />);
    expect(screen.getByRole('img', { name: 'Clear sky' })).toBeInTheDocument();
  });

  it('scales with the surrounding font size by default', () => {
    const { container } = render(<Icon name="close" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '1em');
  });
});
