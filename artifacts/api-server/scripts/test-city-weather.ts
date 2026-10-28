import assert from "node:assert/strict";
import test from "node:test";
import { __setSafeOutboundRequestOverrideForTests } from "../src/lib/safeOutboundRequest";
import { cityWeatherOutboundEnabled, cityWeatherSyncEnabled, fetchOpenWeatherCurrent, nextCityWeatherAutomaticRun, parseOpenWeatherCurrent, publicCityWeatherRuntime } from "../src/lib/cityWeather";

const response = {
  coord: { lat: 41.0082, lon: 28.9784 },
  dt: 1_791_000_000,
  timezone: 10_800,
  weather: [{ id: 801, main: "Clouds", description: "few clouds", icon: "02d" }],
  main: { temp: 18.4, feels_like: 17.8, temp_min: 16.2, temp_max: 20.1, humidity: 64 },
  wind: { speed: 3.7 },
};

test("OpenWeather payload is bounded and converted to a 24-hour snapshot", () => {
  const now = new Date("2026-10-19T09:00:00.000Z");
  const result = parseOpenWeatherCurrent(response, now);
  assert.equal(result.provider, "openweather");
  assert.equal(result.temperatureC, 18.4);
  assert.equal(result.feelsLikeC, 17.8);
  assert.equal(result.humidityPercent, 64);
  assert.equal(new Date(result.staleAfter).getTime() - now.getTime(), 24 * 60 * 60 * 1_000);
});

test("invalid provider measurements fail closed", () => {
  assert.throws(() => parseOpenWeatherCurrent({ ...response, main: { ...response.main, humidity: 101 } }), /weather_payload_humidity_invalid/);
  assert.throws(() => parseOpenWeatherCurrent({ ...response, weather: [] }), /weather_payload_invalid/);
});

test("automatic synchronization requires all three explicit gates", () => {
  assert.equal(cityWeatherSyncEnabled({ ALLOW_LIVE_INTEGRATIONS: "true", CITY_WEATHER_SYNC_ENABLED: "true", OPENWEATHER_API_KEY: "key" }), true);
  assert.equal(cityWeatherSyncEnabled({ ALLOW_OPENWEATHER_INTEGRATION: "true", CITY_WEATHER_SYNC_ENABLED: "true", OPENWEATHER_API_KEY: "key" }), true);
  assert.equal(cityWeatherSyncEnabled({ ALLOW_LIVE_INTEGRATIONS: "false", CITY_WEATHER_SYNC_ENABLED: "true", OPENWEATHER_API_KEY: "key" }), false);
  assert.equal(cityWeatherSyncEnabled({ ALLOW_LIVE_INTEGRATIONS: "true", CITY_WEATHER_SYNC_ENABLED: "false", OPENWEATHER_API_KEY: "key" }), false);
  assert.equal(cityWeatherSyncEnabled({ ALLOW_LIVE_INTEGRATIONS: "true", CITY_WEATHER_SYNC_ENABLED: "true" }), false);
});

test("provider-specific outbound permission does not require the global integration gate", () => {
  assert.equal(cityWeatherOutboundEnabled({ ALLOW_OPENWEATHER_INTEGRATION: "true", ALLOW_LIVE_INTEGRATIONS: "false" }), true);
  assert.equal(cityWeatherOutboundEnabled({ ALLOW_OPENWEATHER_INTEGRATION: "false", ALLOW_LIVE_INTEGRATIONS: "false" }), false);
});

test("admin runtime projection never exposes the provider credential", () => {
  const projected = publicCityWeatherRuntime({
    provider: "openweather",
    source: "database",
    keyConfigured: true,
    integrationEnabled: true,
    liveIntegrationsAllowed: true,
    automaticSyncRequested: true,
    automaticSyncEnabled: true,
    batchSize: 25,
    refreshIntervalHours: 24,
    automaticSyncTimeZone: "Europe/Istanbul",
    automaticSyncLocalTime: "00:05",
    automaticSyncMaxBatches: 4,
    hourlyCallLimit: 50,
    apiKey: "must-never-leave-the-server",
  });
  assert.equal("apiKey" in projected, false);
  assert.equal(JSON.stringify(projected).includes("must-never-leave-the-server"), false);
});

test("automatic synchronization starts at 00:05 Istanbul time without an API-startup sweep", () => {
  assert.equal(nextCityWeatherAutomaticRun(new Date("2026-10-19T20:59:00.000Z")).toISOString(), "2026-10-19T21:05:00.000Z");
  assert.equal(nextCityWeatherAutomaticRun(new Date("2026-10-19T21:02:00.000Z")).toISOString(), "2026-10-19T21:05:00.000Z");
  assert.equal(nextCityWeatherAutomaticRun(new Date("2026-10-19T21:06:00.000Z")).toISOString(), "2026-10-20T21:05:00.000Z");
});

test("provider request is pinned, bounded and returns only normalized data", async () => {
  let requested = "";
  __setSafeOutboundRequestOverrideForTests(async (url, options) => {
    requested = url;
    assert.deepEqual(options.allowedHostnames, ["api.openweathermap.org"]);
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.maxBytes, 32 * 1_024);
    return { ok: true, status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(response)), url };
  });
  try {
    const result = await fetchOpenWeatherCurrent(41.0082, 28.9784, {
      ALLOW_LIVE_INTEGRATIONS: "true",
      OPENWEATHER_API_KEY: "test-secret",
    }, new Date("2026-10-19T09:00:00.000Z"));
    const parsedUrl = new URL(requested);
    assert.equal(parsedUrl.hostname, "api.openweathermap.org");
    assert.equal(parsedUrl.searchParams.get("lat"), "41.0082");
    assert.equal(parsedUrl.searchParams.get("lon"), "28.9784");
    assert.equal(parsedUrl.searchParams.get("appid"), "test-secret");
    assert.equal(JSON.stringify(result).includes("test-secret"), false);
  } finally {
    __setSafeOutboundRequestOverrideForTests(null);
  }
});
test("manual provider request also fails closed without outbound authorization", async () => {
  await assert.rejects(
    fetchOpenWeatherCurrent(41, 29, { ALLOW_LIVE_INTEGRATIONS: "false", OPENWEATHER_API_KEY: "test-secret" }),
    /weather_live_integrations_disabled/,
  );
});

test("manual provider request accepts the provider-specific outbound gate", async () => {
  __setSafeOutboundRequestOverrideForTests(async (url) => ({
    ok: true,
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(response)),
    url,
  }));
  try {
    const result = await fetchOpenWeatherCurrent(41, 29, {
      ALLOW_OPENWEATHER_INTEGRATION: "true",
      ALLOW_LIVE_INTEGRATIONS: "false",
      OPENWEATHER_API_KEY: "test-secret",
    });
    assert.equal(result.provider, "openweather");
  } finally {
    __setSafeOutboundRequestOverrideForTests(null);
  }
});
