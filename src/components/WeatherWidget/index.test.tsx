import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WeatherWidget from './WeatherWidget';

/** A minimal Open-Meteo forecast payload the widget knows how to read. */
const FORECAST = {
  current: {
    temperature_2m: 72.4,
    apparent_temperature: 70.1,
    relative_humidity_2m: 55,
    weather_code: 0,
    wind_speed_10m: 6.2,
  },
  daily: {
    time: ['2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'],
    weather_code: [0, 2, 61, 3, 0],
    temperature_2m_max: [78, 80, 75, 77, 79],
    temperature_2m_min: [61, 62, 60, 59, 63],
  },
};

function stubForecast() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(FORECAST) })),
  );
}

describe('WeatherWidget', () => {
  it('renders current conditions once the forecast loads', async () => {
    stubForecast();
    render(<WeatherWidget />);

    expect(await screen.findByText('72°F')).toBeInTheDocument();
    expect(screen.getByText('Clear sky')).toBeInTheDocument();
    expect(screen.getByText('San Diego')).toBeInTheDocument();
    // The 4-day forecast (days after today) renders.
    expect(screen.getByText('💧 55%')).toBeInTheDocument();
  });

  it('shows an error state with a retry when the network fails', async () => {
    // The default test fetch rejects, so this is the offline path.
    render(<WeatherWidget />);
    expect(await screen.findByText(/Couldn't load weather/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('toggles the unit and persists the choice', async () => {
    stubForecast();
    const user = userEvent.setup();
    render(<WeatherWidget />);
    await screen.findByText('72°F');

    await user.click(screen.getByTitle('Toggle units'));

    await waitFor(() => expect(screen.getByText('72°C')).toBeInTheDocument());
    expect(localStorage.getItem('weather.unit')).toBe(JSON.stringify('celsius'));
  });
});
