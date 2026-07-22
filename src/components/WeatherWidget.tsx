import { useState, useEffect, useCallback } from 'react';
import Widget from './Widget';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface Place {
  name: string;
  latitude: number;
  longitude: number;
}

interface Weather {
  temp: number;
  feelsLike: number;
  humidity: number;
  wind: number;
  code: number;
  todayMax: number;
  todayMin: number;
  daily: { date: string; code: number; max: number; min: number }[];
}

// WMO weather codes -> emoji + label. https://open-meteo.com/en/docs
const WMO: Record<number, [string, string]> = {
  0: ['☀️', 'Clear sky'],
  1: ['🌤️', 'Mainly clear'],
  2: ['⛅', 'Partly cloudy'],
  3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'],
  48: ['🌫️', 'Rime fog'],
  51: ['🌦️', 'Light drizzle'],
  53: ['🌦️', 'Drizzle'],
  55: ['🌧️', 'Dense drizzle'],
  61: ['🌦️', 'Light rain'],
  63: ['🌧️', 'Rain'],
  65: ['🌧️', 'Heavy rain'],
  66: ['🌧️', 'Freezing rain'],
  67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'],
  73: ['🌨️', 'Snow'],
  75: ['❄️', 'Heavy snow'],
  77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Rain showers'],
  81: ['🌧️', 'Rain showers'],
  82: ['⛈️', 'Violent showers'],
  85: ['🌨️', 'Snow showers'],
  86: ['❄️', 'Snow showers'],
  95: ['⛈️', 'Thunderstorm'],
  96: ['⛈️', 'Thunderstorm + hail'],
  99: ['⛈️', 'Thunderstorm + hail'],
};

/**
 * Resolves a WMO weather code to its `[emoji, label]` pair.
 *
 * @param code - WMO weather interpretation code from the Open-Meteo API.
 * @returns A tuple of emoji and human-readable label; falls back to a generic
 *   thermometer + "Unknown" for unrecognised codes.
 */
const desc = (code: number) => WMO[code] ?? ['🌡️', 'Unknown'];

const DEFAULT_PLACE: Place = {
  name: 'San Diego',
  latitude: 32.7157,
  longitude: -117.1611,
};

/**
 * Live weather widget backed by the free, key-less Open-Meteo API.
 *
 * Features: current conditions + a 4-day forecast, city search via Open-Meteo's
 * geocoding endpoint (debounced), "use my location" through the browser
 * Geolocation API, and an °F/°C unit toggle. The selected place and unit persist
 * in localStorage. All network calls degrade to an error state with a retry.
 */
export default function WeatherWidget() {
  const [place, setPlace] = useLocalStorage<Place>('weather.place', DEFAULT_PLACE);
  const [unit, setUnit] = useLocalStorage<'fahrenheit' | 'celsius'>('weather.unit', 'fahrenheit');
  const [weather, setWeather] = useState<Weather | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);

  const unitSymbol = unit === 'fahrenheit' ? '°F' : '°C';

  const fetchWeather = useCallback(async () => {
    setStatus('loading');
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
        `&temperature_unit=${unit}&wind_speed_unit=mph&timezone=auto&forecast_days=5`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('bad response');
      const d = await res.json();
      setWeather({
        temp: Math.round(d.current.temperature_2m),
        feelsLike: Math.round(d.current.apparent_temperature),
        humidity: d.current.relative_humidity_2m,
        wind: Math.round(d.current.wind_speed_10m),
        code: d.current.weather_code,
        todayMax: Math.round(d.daily.temperature_2m_max[0]),
        todayMin: Math.round(d.daily.temperature_2m_min[0]),
        daily: d.daily.time.map((date: string, i: number) => ({
          date,
          code: d.daily.weather_code[i],
          max: Math.round(d.daily.temperature_2m_max[i]),
          min: Math.round(d.daily.temperature_2m_min[i]),
        })),
      });
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [place, unit]);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  // City search (debounced) via Open-Meteo geocoding.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5`,
        );
        const d = await res.json();
        setResults(
          (d.results ?? []).map((r: { name: string; admin1?: string; country_code?: string; latitude: number; longitude: number }) => ({
            name: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
            latitude: r.latitude,
            longitude: r.longitude,
          })),
        );
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlace({
          name: 'My location',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setQuery('');
        setResults([]);
      },
      () => setStatus('error'),
    );
  };

  const pick = (p: Place) => {
    setPlace(p);
    setQuery('');
    setResults([]);
  };

  return (
    <Widget
      title="Weather"
      action={
        <button
          className="pill"
          onClick={() => setUnit(unit === 'fahrenheit' ? 'celsius' : 'fahrenheit')}
          title="Toggle units"
        >
          {unitSymbol}
        </button>
      }
    >
      <div className="weather__search">
        <input
          type="text"
          placeholder="Search a city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="pill" onClick={useMyLocation} title="Use my location">
          📍
        </button>
      </div>
      {results.length > 0 && (
        <ul className="weather__results">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button onClick={() => pick(r)}>{r.name}</button>
            </li>
          ))}
        </ul>
      )}
      {searching && <p className="muted">Searching…</p>}

      {status === 'loading' && <p className="muted">Loading weather…</p>}
      {status === 'error' && (
        <p className="muted">
          Couldn't load weather.{' '}
          <button className="link" onClick={fetchWeather}>
            Retry
          </button>
        </p>
      )}
      {status === 'ready' && weather && (
        <>
          <div className="weather__now">
            <span className="weather__emoji">{desc(weather.code)[0]}</span>
            <div>
              <div className="weather__temp">
                {weather.temp}
                {unitSymbol}
              </div>
              <div className="muted">{desc(weather.code)[1]}</div>
            </div>
            <div className="weather__place">{place.name}</div>
          </div>
          <div className="weather__meta">
            <span>Feels {weather.feelsLike}{unitSymbol}</span>
            <span>H {weather.todayMax}° / L {weather.todayMin}°</span>
            <span>💧 {weather.humidity}%</span>
            <span>💨 {weather.wind} mph</span>
          </div>
          <ul className="weather__forecast">
            {weather.daily.slice(1).map((d) => (
              <li key={d.date}>
                <span className="weather__day">
                  {new Date(d.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className="weather__demoji">{desc(d.code)[0]}</span>
                <span className="weather__range">
                  {d.max}° <span className="muted">{d.min}°</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Widget>
  );
}
