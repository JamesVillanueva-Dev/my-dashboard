import { useState, useEffect } from 'react';
import Widget from '../Widget';
import Icon, { type IconName } from '../Icon';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useCachedResource } from '../../hooks/useCachedResource';
import styles from './styles.module.css';

/** A saved location, as returned by Open-Meteo's geocoding search. */
interface Place {
  /** What the search matched, shown as the widget's subtitle. */
  name: string;
  /** Degrees north. */
  latitude: number;
  /** Degrees east. */
  longitude: number;
}

/** One place's forecast, reduced to the figures the widget renders. */
interface Weather {
  /** Current temperature, °C. */
  temp: number;
  /** Apparent temperature, °C — what it feels like with wind and humidity. */
  feelsLike: number;
  /** Relative humidity, %. */
  humidity: number;
  /** Wind speed, km/h. */
  wind: number;
  /** Current conditions as a WMO code; resolve it through {@link desc}. */
  code: number;
  /** Today's high, °C. */
  todayMax: number;
  /** Today's low, °C. */
  todayMin: number;
  /** The multi-day strip: `YYYY-MM-DD`, conditions, and that day's range. */
  daily: { date: string; code: number; max: number; min: number }[];
}

// WMO weather codes -> icon + label. https://open-meteo.com/en/docs
const WMO: Record<number, [IconName, string]> = {
  0: ['sun', 'Clear sky'],
  1: ['cloudSun', 'Mainly clear'],
  2: ['cloudSun', 'Partly cloudy'],
  3: ['cloud', 'Overcast'],
  45: ['cloudFog', 'Fog'],
  48: ['cloudFog', 'Rime fog'],
  51: ['cloudDrizzle', 'Light drizzle'],
  53: ['cloudDrizzle', 'Drizzle'],
  55: ['cloudRain', 'Dense drizzle'],
  61: ['cloudDrizzle', 'Light rain'],
  63: ['cloudRain', 'Rain'],
  65: ['cloudRain', 'Heavy rain'],
  66: ['cloudRain', 'Freezing rain'],
  67: ['cloudRain', 'Freezing rain'],
  71: ['cloudSnow', 'Light snow'],
  73: ['cloudSnow', 'Snow'],
  75: ['cloudSnow', 'Heavy snow'],
  77: ['cloudSnow', 'Snow grains'],
  80: ['cloudDrizzle', 'Rain showers'],
  81: ['cloudRain', 'Rain showers'],
  82: ['cloudLightning', 'Violent showers'],
  85: ['cloudSnow', 'Snow showers'],
  86: ['cloudSnow', 'Snow showers'],
  95: ['cloudLightning', 'Thunderstorm'],
  96: ['cloudLightning', 'Thunderstorm + hail'],
  99: ['cloudLightning', 'Thunderstorm + hail'],
};

/**
 * Resolves a WMO weather code to its `[icon, label]` pair.
 *
 * @param code - WMO weather interpretation code from the Open-Meteo API.
 * @returns A tuple of icon name and human-readable label; falls back to a generic
 *   thermometer + "Unknown" for unrecognised codes.
 */
const desc = (code: number): [IconName, string] => WMO[code] ?? ['thermometer', 'Unknown'];

/** Where the widget points before anyone has searched for somewhere else. */
const DEFAULT_PLACE: Place = {
  name: 'San Diego',
  latitude: 32.7157,
  longitude: -117.1611,
};

/** A forecast this old is refreshed in the background. Conditions and the
 *  hourly-derived "current" figures do not move faster than this. */
const TTL = 10 * 60_000;

/**
 * Live weather widget backed by the free, key-less Open-Meteo API.
 *
 * Features: current conditions + a 4-day forecast, city search via Open-Meteo's
 * geocoding endpoint (debounced), "use my location" through the browser
 * Geolocation API, and an °F/°C unit toggle. The selected place and unit persist
 * in localStorage. All network calls degrade to an error state with a retry.
 *
 * The forecast is read through {@link useCachedResource}, keyed by place and
 * unit: re-mounting the panel, reloading the page, or toggling back to a unit
 * you were just looking at all paint from cache and refresh quietly behind it.
 */
export default function WeatherWidget() {
  const [place, setPlace] = useLocalStorage<Place>('weather.place', DEFAULT_PLACE);
  const [unit, setUnit] = useLocalStorage<'fahrenheit' | 'celsius'>('weather.unit', 'fahrenheit');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [geoError, setGeoError] = useState(false);

  const unitSymbol = unit === 'fahrenheit' ? '°F' : '°C';

  const fetchWeather = async (): Promise<Weather> => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=${unit}&wind_speed_unit=mph&timezone=auto&forecast_days=5`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('bad response');
    const d = await res.json();
    return {
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
    };
  };

  const {
    data: weather,
    status,
    refresh,
  } = useCachedResource<Weather>(
    `weather:${place.latitude},${place.longitude}:${unit}`,
    TTL,
    fetchWeather,
  );

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
        setGeoError(false);
      },
      () => setGeoError(true),
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
      className={styles.container}
      action={
        <button
          className={styles.unit}
          onClick={() => setUnit(unit === 'fahrenheit' ? 'celsius' : 'fahrenheit')}
          title="Toggle units"
        >
          {unitSymbol}
        </button>
      }
    >
      <div className={styles.search}>
        <input
          type="text"
          placeholder="Search a city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className={styles.locate}
          onClick={useMyLocation}
          title="Use my location"
          aria-label="Use my location"
        >
          <Icon name="pin" />
        </button>
      </div>
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button onClick={() => pick(r)}>{r.name}</button>
            </li>
          ))}
        </ul>
      )}
      {searching && <p>Searching…</p>}
      {geoError && <p>Couldn't get your location.</p>}

      {status === 'loading' && <p>Loading weather…</p>}
      {status === 'error' && (
        <p>
          Couldn't load weather.{' '}
          <button className={styles.retry} onClick={refresh}>
            Retry
          </button>
        </p>
      )}
      {status === 'ready' && weather && (
        <>
          <div className={styles.now}>
            <Icon name={desc(weather.code)[0]} label={desc(weather.code)[1]} />
            <div>
              <div className={styles.temp}>
                {weather.temp}
                {unitSymbol}
              </div>
              <div className={styles.desc}>{desc(weather.code)[1]}</div>
            </div>
            <div className={styles.place}>{place.name}</div>
          </div>
          <div className={styles.meta}>
            <span>Feels {weather.feelsLike}{unitSymbol}</span>
            <span>H {weather.todayMax}° / L {weather.todayMin}°</span>
            <span>
              <Icon name="droplet" /> {weather.humidity}%
            </span>
            <span>
              <Icon name="wind" /> {weather.wind} mph
            </span>
          </div>
          <ul className={styles.forecast}>
            {weather.daily.slice(1).map((d) => (
              <li key={d.date}>
                <span>
                  {new Date(d.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <Icon name={desc(d.code)[0]} label={desc(d.code)[1]} />
                <span>
                  {d.max}° <span>{d.min}°</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Widget>
  );
}
