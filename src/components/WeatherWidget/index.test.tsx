import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WeatherWidget from './index';

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
    // Humidity and wind read out beside their icons.
    expect(screen.getByText('55%')).toBeInTheDocument();
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

  it('paints a re-mounted panel from cache without fetching again', async () => {
    stubForecast();
    const { unmount } = render(<WeatherWidget />);
    await screen.findByText('72°F');
    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();
    render(<WeatherWidget />);

    // No placeholder flash: the forecast is there on the first render.
    expect(screen.getByText('72°F')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading weather/i })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches each unit separately and switches back instantly', async () => {
    stubForecast();
    const user = userEvent.setup();
    render(<WeatherWidget />);
    await screen.findByText('72°F');

    await user.click(screen.getByTitle('Toggle units'));
    await screen.findByText('72°C');
    expect(fetch).toHaveBeenCalledTimes(2); // °C is a different request

    await user.click(screen.getByTitle('Toggle units'));

    expect(screen.getByText('72°F')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
