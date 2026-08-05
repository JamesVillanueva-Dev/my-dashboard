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

  it('draws the shapes from the icon file', () => {
    const { container } = render(<Icon name="target" />);
    expect(container.querySelectorAll('svg > circle')).toHaveLength(3);
  });

  it('keeps a glyph that opts out of the shared stroke', () => {
    const { container } = render(<Icon name="grip" />);
    const group = container.querySelector('svg > g')!;
    expect(group).toHaveAttribute('fill', 'currentColor');
    expect(group.querySelectorAll('circle')).toHaveLength(6);
  });

  it('re-parents the drawing instead of nesting the file inside the root', () => {
    const { container } = render(<Icon name="cloud" />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelector('svg > path')).toBeInTheDocument();
  });
});
