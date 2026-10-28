import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Droplets, Sun, ThermometerSun, Wind } from "lucide-react";
import type { ReactNode } from "react";
import { localizedWeatherDescription, weatherCopy } from "./weatherPresentation";

export type CityWeatherSnapshot = {
  provider: "openweather";
  conditionCode: number;
  conditionGroup: string;
  description: string;
  iconCode: string;
  temperatureC: number;
  feelsLikeC: number;
  minimumC: number;
  maximumC: number;
  humidityPercent: number;
  windSpeedMps: number | null;
  observedAt: string;
  forecastDate: string;
  fetchedAt: string;
  staleAfter: string;
  isStale: boolean;
  attribution: "OpenWeather";
};

function weatherIcon(code: number): ReactNode {
  if (code >= 200 && code < 300) return <CloudLightning aria-hidden="true" />;
  if (code >= 300 && code < 400) return <CloudDrizzle aria-hidden="true" />;
  if (code >= 500 && code < 600) return <CloudRain aria-hidden="true" />;
  if (code >= 600 && code < 700) return <CloudSnow aria-hidden="true" />;
  if (code >= 700 && code < 800) return <CloudFog aria-hidden="true" />;
  if (code === 800) return <Sun aria-hidden="true" />;
  return <Cloud aria-hidden="true" />;
}

function degree(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}°`;
}

export function CityWeatherCard({ cityName, locale, weather }: { cityName: string; locale: string; weather: CityWeatherSnapshot }) {
  const copy = weatherCopy(locale);
  const description = localizedWeatherDescription(weather.conditionCode, weather.conditionGroup, locale);
  return (
    <article className="detail-weather-card">
      <div className="detail-weather-primary">
        <div className="detail-weather-icon">{weatherIcon(weather.conditionCode)}</div>
        <div>
          <p className="detail-eyebrow">{weather.isStale ? copy.stale : copy.cityTitle}</p>
          <h3>{cityName}</h3>
          <p className="detail-weather-condition">{description}</p>
        </div>
        <strong className="detail-weather-temperature">{degree(weather.temperatureC, locale)}</strong>
      </div>
      <dl className="detail-weather-metrics">
        <div><dt><ThermometerSun aria-hidden="true" />{copy.feels}</dt><dd>{degree(weather.feelsLikeC, locale)}</dd></div>
        <div><dt><Sun aria-hidden="true" />{copy.range}</dt><dd>{degree(weather.minimumC, locale)} / {degree(weather.maximumC, locale)}</dd></div>
        <div><dt><Droplets aria-hidden="true" />{copy.humidity}</dt><dd>%{weather.humidityPercent}</dd></div>
        {weather.windSpeedMps !== null && <div><dt><Wind aria-hidden="true" />{copy.wind}</dt><dd>{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(weather.windSpeedMps)} m/s</dd></div>}
      </dl>
      <footer>{copy.source}: <a href="https://openweathermap.org/" target="_blank" rel="noopener noreferrer">{weather.attribution}</a></footer>
    </article>
  );
}
