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

/** Switches between Fahrenheit and Celsius. */
const toggleUnits = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByTitle('Toggle units'));

describe('WeatherWidget once the forecast loads', () => {
  it('renders the current temperature and conditions', async () => {
    stubForecast();

    render(<WeatherWidget />);

    expect(await screen.findByText('72°F')).toBeInTheDocument();
    expect(screen.getByText('Clear sky')).toBeInTheDocument();
  });

  it('names the place and reads out the humidity', async () => {
    stubForecast();

    render(<WeatherWidget />);
    await screen.findByText('72°F');

    expect(screen.getByText('San Diego')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
  });
});

describe('WeatherWidget when the network fails', () => {
  it('shows an error state with a retry', async () => {
    // The default test fetch rejects, so this is the offline path.
    render(<WeatherWidget />);

    expect(await screen.findByText(/Couldn't load weather/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('WeatherWidget units', () => {
  it('switches the reading to the other unit', async () => {
    stubForecast();
    const user = userEvent.setup();
    render(<WeatherWidget />);
    await screen.findByText('72°F');

    await toggleUnits(user);

    await waitFor(() => expect(screen.getByText('72°C')).toBeInTheDocument());
  });

  it('persists the choice', async () => {
    stubForecast();
    const user = userEvent.setup();
    render(<WeatherWidget />);
    await screen.findByText('72°F');

    await toggleUnits(user);
    await screen.findByText('72°C');

    expect(localStorage.getItem('weather.unit')).toBe(JSON.stringify('celsius'));
  });
});

describe('WeatherWidget caching', () => {
  it('paints a re-mounted panel from cache, with no loading flash', async () => {
    stubForecast();
    const { unmount } = render(<WeatherWidget />);
    await screen.findByText('72°F');

    unmount();
    render(<WeatherWidget />);

    // The forecast is there on the first render.
    expect(screen.getByText('72°F')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading weather/i })).not.toBeInTheDocument();
  });

  it('does not fetch again for a re-mounted panel', async () => {
    stubForecast();
    const { unmount } = render(<WeatherWidget />);
    await screen.findByText('72°F');
    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();
    render(<WeatherWidget />);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches each unit separately, so switching back is instant', async () => {
    stubForecast();
    const user = userEvent.setup();
    render(<WeatherWidget />);
    await screen.findByText('72°F');
    await toggleUnits(user);
    await screen.findByText('72°C');
    expect(fetch).toHaveBeenCalledTimes(2); // °C is a different request

    await toggleUnits(user);

    expect(screen.getByText('72°F')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
