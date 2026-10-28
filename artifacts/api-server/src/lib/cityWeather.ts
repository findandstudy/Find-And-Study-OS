import {
  citiesTable,
  cityWeatherSnapshotsTable,
  countriesTable,
  db,
  integrationsTable,
  weatherProviderCallsTable,
  weatherSyncRunsTable,
} from "@workspace/db";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { safeOutboundRequest } from "./safeOutboundRequest";
import { publicCatalogInvalidationBus } from "./publicCatalogInvalidationBus";
import { countryMatches } from "./websiteCatalogFilters";
import { decryptConfig } from "./encryption";

const OPENWEATHER_HOST = "api.openweathermap.org";
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 45;
const OPENWEATHER_HOURLY_CALL_LIMIT = 50;
const OPENWEATHER_QUOTA_WINDOW_MINUTES = 60;
const OPENWEATHER_QUOTA_LOCK = "findandstudy:openweather:hourly-quota:v1";
const AUTOMATIC_SYNC_TIME_ZONE = "Europe/Istanbul";
const AUTOMATIC_SYNC_LOCAL_HOUR = 0;
const AUTOMATIC_SYNC_LOCAL_MINUTE = 5;
const AUTOMATIC_SYNC_FOLLOW_UP_MS = 61 * 60 * 1_000;
const AUTOMATIC_SYNC_MAX_BATCHES = 4;
const ISTANBUL_UTC_OFFSET_MS = 3 * 60 * 60 * 1_000;

type WeatherEnvironment = NodeJS.ProcessEnv | Record<string, string | undefined>;

type OpenWeatherResponse = {
  coord?: { lat?: number; lon?: number };
  dt: number;
  timezone?: number;
  weather: Array<{ id: number; main: string; description: string; icon: string }>;
  main: { temp: number; feels_like: number; temp_min: number; temp_max: number; humidity: number };
  wind?: { speed?: number };
};

export type PublicCityWeatherSnapshot = {
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

export type CityWeatherRuntime = {
  provider: "openweather";
  source: "database" | "environment" | "none";
  keyConfigured: boolean;
  integrationEnabled: boolean;
  liveIntegrationsAllowed: boolean;
  automaticSyncRequested: boolean;
  automaticSyncEnabled: boolean;
  batchSize: number;
  refreshIntervalHours: 24;
  automaticSyncTimeZone: "Europe/Istanbul";
  automaticSyncLocalTime: "00:05";
  automaticSyncMaxBatches: 4;
  hourlyCallLimit: 50;
  apiKey: string | null;
};

export type CityWeatherQuotaStatus = {
  limit: number;
  used: number;
  remaining: number;
  windowMinutes: number;
  resetsAt: string | null;
  fullyResetsAt: string | null;
};

export function cityWeatherOutboundEnabled(env: WeatherEnvironment = process.env): boolean {
  return env.ALLOW_OPENWEATHER_INTEGRATION === "true" || env.ALLOW_LIVE_INTEGRATIONS === "true";
}

export function cityWeatherSyncEnabled(env: WeatherEnvironment = process.env): boolean {
  return cityWeatherOutboundEnabled(env)
    && env.CITY_WEATHER_SYNC_ENABLED === "true"
    && Boolean(env.OPENWEATHER_API_KEY?.trim());
}

function normalizedBatchSize(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 45)) : DEFAULT_BATCH_SIZE;
}

function environmentRuntime(env: WeatherEnvironment): CityWeatherRuntime {
  const apiKey = env.OPENWEATHER_API_KEY?.trim() || null;
  const liveIntegrationsAllowed = cityWeatherOutboundEnabled(env);
  const automaticSyncRequested = env.CITY_WEATHER_SYNC_ENABLED === "true";
  return {
    provider: "openweather",
    source: apiKey ? "environment" : "none",
    keyConfigured: Boolean(apiKey),
    integrationEnabled: Boolean(apiKey),
    liveIntegrationsAllowed,
    automaticSyncRequested,
    automaticSyncEnabled: liveIntegrationsAllowed && automaticSyncRequested && Boolean(apiKey),
    batchSize: normalizedBatchSize(env.CITY_WEATHER_SYNC_BATCH_SIZE),
    refreshIntervalHours: 24,
    automaticSyncTimeZone: AUTOMATIC_SYNC_TIME_ZONE,
    automaticSyncLocalTime: "00:05",
    automaticSyncMaxBatches: AUTOMATIC_SYNC_MAX_BATCHES,
    hourlyCallLimit: OPENWEATHER_HOURLY_CALL_LIMIT,
    apiKey,
  };
}

/**
 * Resolve the provider credential without ever projecting it to an HTTP response.
 * Once a database-managed integration exists it is authoritative; disabling it
 * cannot accidentally fall back to a stale deployment secret.
 */
export async function resolveCityWeatherRuntime(env: WeatherEnvironment = process.env): Promise<CityWeatherRuntime> {
  const fallback = environmentRuntime(env);
  const [integration] = await db.select({
    isEnabled: integrationsTable.isEnabled,
    config: integrationsTable.config,
  }).from(integrationsTable).where(eq(integrationsTable.key, "openweather")).limit(1);
  if (!integration) return fallback;

  const config = decryptConfig((integration.config || {}) as Record<string, unknown>);
  const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() || null : null;
  const liveIntegrationsAllowed = cityWeatherOutboundEnabled(env);
  const automaticSyncRequested = config.automaticSyncEnabled === true;
  return {
    provider: "openweather",
    source: "database",
    keyConfigured: Boolean(apiKey),
    integrationEnabled: integration.isEnabled,
    liveIntegrationsAllowed,
    automaticSyncRequested,
    automaticSyncEnabled: liveIntegrationsAllowed && integration.isEnabled && automaticSyncRequested && Boolean(apiKey),
    batchSize: normalizedBatchSize(config.batchSize),
    refreshIntervalHours: 24,
    automaticSyncTimeZone: AUTOMATIC_SYNC_TIME_ZONE,
    automaticSyncLocalTime: "00:05",
    automaticSyncMaxBatches: AUTOMATIC_SYNC_MAX_BATCHES,
    hourlyCallLimit: OPENWEATHER_HOURLY_CALL_LIMIT,
    apiKey,
  };
}

export function publicCityWeatherRuntime(runtime: CityWeatherRuntime): Omit<CityWeatherRuntime, "apiKey"> {
  const { apiKey: _apiKey, ...publicRuntime } = runtime;
  return publicRuntime;
}

function requiredApiKey(env: WeatherEnvironment): string {
  if (!cityWeatherOutboundEnabled(env)) throw new Error("weather_live_integrations_disabled");
  const key = env.OPENWEATHER_API_KEY?.trim();
  if (!key) throw new Error("weather_api_key_missing");
  return key;
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`weather_payload_${label}_invalid`);
  }
  return parsed;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum) throw new Error(`weather_payload_${label}_invalid`);
  return text;
}

export function parseOpenWeatherCurrent(payload: unknown, fetchedAt = new Date()): Omit<PublicCityWeatherSnapshot, "isStale" | "attribution"> {
  if (!payload || typeof payload !== "object") throw new Error("weather_payload_invalid");
  const input = payload as Partial<OpenWeatherResponse>;
  const condition = Array.isArray(input.weather) ? input.weather[0] : undefined;
  if (!condition || !input.main || typeof input.main !== "object") throw new Error("weather_payload_invalid");
  const observedSeconds = finite(input.dt, "observed_at", 1, 4_102_444_800);
  const timezoneSeconds = input.timezone === undefined ? 0 : finite(input.timezone, "timezone", -50_400, 50_400);
  const observedAt = new Date(observedSeconds * 1_000);
  const localDate = new Date((observedSeconds + timezoneSeconds) * 1_000).toISOString().slice(0, 10);
  return {
    provider: "openweather",
    conditionCode: Math.trunc(finite(condition.id, "condition_code", 100, 999)),
    conditionGroup: boundedText(condition.main, "condition_group", 80),
    description: boundedText(condition.description, "description", 200),
    iconCode: boundedText(condition.icon, "icon", 8),
    temperatureC: finite(input.main.temp, "temperature", -100, 100),
    feelsLikeC: finite(input.main.feels_like, "feels_like", -120, 120),
    minimumC: finite(input.main.temp_min, "minimum", -120, 120),
    maximumC: finite(input.main.temp_max, "maximum", -120, 120),
    humidityPercent: Math.round(finite(input.main.humidity, "humidity", 0, 100)),
    windSpeedMps: input.wind?.speed === undefined ? null : finite(input.wind.speed, "wind_speed", 0, 150),
    observedAt: observedAt.toISOString(),
    forecastDate: localDate,
    fetchedAt: fetchedAt.toISOString(),
    staleAfter: new Date(fetchedAt.getTime() + DEFAULT_STALE_MS).toISOString(),
  };
}

export async function fetchOpenWeatherCurrent(
  latitude: number,
  longitude: number,
  env: WeatherEnvironment = process.env,
  now = new Date(),
): Promise<Omit<PublicCityWeatherSnapshot, "isStale" | "attribution">> {
  finite(latitude, "latitude", -90, 90);
  finite(longitude, "longitude", -180, 180);
  const key = requiredApiKey(env);
  const url = new URL(`https://${OPENWEATHER_HOST}/data/2.5/weather`);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("appid", key);
  url.searchParams.set("units", "metric");
  url.searchParams.set("lang", "en");
  const response = await safeOutboundRequest(url.toString(), {
    method: "GET",
    allowedHostnames: [OPENWEATHER_HOST],
    allowedPorts: [443],
    allowedProtocols: ["https:"],
    maxRedirects: 0,
    maxBytes: 32 * 1_024,
    timeoutMs: 10_000,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`weather_provider_http_${response.status}`);
  let payload: unknown;
  try { payload = JSON.parse(response.body.toString("utf8")); }
  catch { throw new Error("weather_provider_json_invalid"); }
  return parseOpenWeatherCurrent(payload, now);
}

async function fetchOpenWeatherCurrentWithKey(
  latitude: number,
  longitude: number,
  apiKey: string,
  now = new Date(),
) {
  return fetchOpenWeatherCurrent(latitude, longitude, {
    ALLOW_LIVE_INTEGRATIONS: "true",
    OPENWEATHER_API_KEY: apiKey,
  }, now);
}

async function fetchOpenWeatherCurrentByCityWithKey(
  cityName: string,
  countryCode: string,
  apiKey: string,
  now = new Date(),
): Promise<{
  latitude: number;
  longitude: number;
  snapshot: Omit<PublicCityWeatherSnapshot, "isStale" | "attribution">;
}> {
  const url = new URL(`https://${OPENWEATHER_HOST}/data/2.5/weather`);
  url.searchParams.set("q", `${cityName},${countryCode}`);
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "metric");
  url.searchParams.set("lang", "en");
  const response = await safeOutboundRequest(url.toString(), {
    method: "GET",
    allowedHostnames: [OPENWEATHER_HOST],
    allowedPorts: [443],
    allowedProtocols: ["https:"],
    maxRedirects: 0,
    maxBytes: 32 * 1_024,
    timeoutMs: 10_000,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`weather_provider_http_${response.status}`);
  let payload: unknown;
  try { payload = JSON.parse(response.body.toString("utf8")); }
  catch { throw new Error("weather_provider_json_invalid"); }
  if (!payload || typeof payload !== "object") throw new Error("weather_payload_invalid");
  const coord = (payload as Partial<OpenWeatherResponse>).coord;
  return {
    latitude: finite(coord?.lat, "latitude", -90, 90),
    longitude: finite(coord?.lon, "longitude", -180, 180),
    snapshot: parseOpenWeatherCurrent(payload, now),
  };
}

type WeatherCallKind = "city_refresh" | "city_geocode" | "connection_test";

/**
 * Atomically reserves one call in a rolling 60-minute window. The advisory
 * transaction lock makes the budget shared by every API/worker process using
 * this database; it is not merely a per-process counter.
 */
async function reserveWeatherProviderCall(callKind: WeatherCallKind, cityId: number | null): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OPENWEATHER_QUOTA_LOCK}))`);
    const [usage] = await tx.select({ count: sql<number>`cast(count(*) as integer)` })
      .from(weatherProviderCallsTable)
      .where(and(
        eq(weatherProviderCallsTable.provider, "openweather"),
        sql`${weatherProviderCallsTable.reservedAt} > now() - interval '60 minutes'`,
      ));
    if (Number(usage?.count || 0) >= OPENWEATHER_HOURLY_CALL_LIMIT) {
      throw new Error("weather_hourly_quota_exhausted");
    }
    const [reservation] = await tx.insert(weatherProviderCallsTable).values({
      provider: "openweather",
      callKind,
      cityId,
      outcome: "reserved",
    }).returning({ id: weatherProviderCallsTable.id });
    return reservation.id;
  });
}

async function finishWeatherProviderCall(reservationId: number, error?: unknown): Promise<void> {
  await db.update(weatherProviderCallsTable).set({
    outcome: error ? "failed" : "success",
    errorCode: error ? safeErrorCode(error) : null,
    finishedAt: new Date(),
  }).where(eq(weatherProviderCallsTable.id, reservationId));
}

export async function readCityWeatherQuotaStatus(): Promise<CityWeatherQuotaStatus> {
  const [usage] = await db.select({
    count: sql<number>`cast(count(*) as integer)`,
    firstReservedAt: sql<Date | null>`min(${weatherProviderCallsTable.reservedAt})`,
    lastReservedAt: sql<Date | null>`max(${weatherProviderCallsTable.reservedAt})`,
  }).from(weatherProviderCallsTable).where(and(
    eq(weatherProviderCallsTable.provider, "openweather"),
    sql`${weatherProviderCallsTable.reservedAt} > now() - interval '60 minutes'`,
  ));
  const used = Number(usage?.count || 0);
  const firstReservedAt = usage?.firstReservedAt ? new Date(usage.firstReservedAt) : null;
  const lastReservedAt = usage?.lastReservedAt ? new Date(usage.lastReservedAt) : null;
  return {
    limit: OPENWEATHER_HOURLY_CALL_LIMIT,
    used,
    remaining: Math.max(0, OPENWEATHER_HOURLY_CALL_LIMIT - used),
    windowMinutes: OPENWEATHER_QUOTA_WINDOW_MINUTES,
    resetsAt: firstReservedAt
      ? new Date(firstReservedAt.getTime() + OPENWEATHER_QUOTA_WINDOW_MINUTES * 60 * 1_000).toISOString()
      : null,
    fullyResetsAt: lastReservedAt
      ? new Date(lastReservedAt.getTime() + OPENWEATHER_QUOTA_WINDOW_MINUTES * 60 * 1_000).toISOString()
      : null,
  };
}

export async function testOpenWeatherConnection(apiKey: string): Promise<void> {
  const reservationId = await reserveWeatherProviderCall("connection_test", null);
  try {
    await fetchOpenWeatherCurrentWithKey(41.0082, 28.9784, apiKey);
    await finishWeatherProviderCall(reservationId);
  } catch (error) {
    await finishWeatherProviderCall(reservationId, error);
    throw error;
  }
}

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "weather_sync_failed";
  return /^weather_[a-z0-9_]+$/i.test(value) ? value.slice(0, 120) : "weather_sync_failed";
}

function projectSnapshot(row: typeof cityWeatherSnapshotsTable.$inferSelect | undefined, now = new Date()): PublicCityWeatherSnapshot | null {
  if (!row?.fetchedAt || !row.observedAt || !row.forecastDate || !row.staleAfter
      || row.conditionCode === null || !row.conditionGroup || !row.description || !row.iconCode
      || row.temperatureC === null || row.feelsLikeC === null || row.minimumC === null
      || row.maximumC === null || row.humidityPercent === null) return null;
  return {
    provider: "openweather",
    conditionCode: row.conditionCode,
    conditionGroup: row.conditionGroup,
    description: row.description,
    iconCode: row.iconCode,
    temperatureC: row.temperatureC,
    feelsLikeC: row.feelsLikeC,
    minimumC: row.minimumC,
    maximumC: row.maximumC,
    humidityPercent: row.humidityPercent,
    windSpeedMps: row.windSpeedMps,
    observedAt: row.observedAt.toISOString(),
    forecastDate: row.forecastDate,
    fetchedAt: row.fetchedAt.toISOString(),
    staleAfter: row.staleAfter.toISOString(),
    isStale: row.staleAfter.getTime() <= now.getTime(),
    attribution: "OpenWeather",
  };
}

export async function readCityWeatherSnapshot(cityId: number, now = new Date()): Promise<PublicCityWeatherSnapshot | null> {
  const [row] = await db.select().from(cityWeatherSnapshotsTable)
    .where(eq(cityWeatherSnapshotsTable.cityId, cityId)).limit(1);
  return projectSnapshot(row, now);
}

export async function readCityWeatherSnapshotByLocation(
  cityName: string | null,
  countryName: string,
  now = new Date(),
): Promise<PublicCityWeatherSnapshot | null> {
  if (!cityName?.trim()) return null;
  const rows = await db.select({ weather: cityWeatherSnapshotsTable, countryName: countriesTable.name, countryCode: countriesTable.code })
    .from(citiesTable)
    .innerJoin(cityWeatherSnapshotsTable, eq(cityWeatherSnapshotsTable.cityId, citiesTable.id))
    .innerJoin(countriesTable, eq(countriesTable.id, citiesTable.countryId))
    .where(and(
      sql`lower(trim(${citiesTable.name})) = lower(trim(${cityName}))`,
      eq(citiesTable.isActive, true),
    ))
    .limit(10);
  const row = rows.find(candidate => countryMatches(countryName, { name: candidate.countryName, code: candidate.countryCode }));
  return projectSnapshot(row?.weather, now);
}

async function recordFailure(city: { id: number; latitude: number; longitude: number }, error: unknown, now: Date): Promise<void> {
  const errorCode = safeErrorCode(error);
  await db.insert(cityWeatherSnapshotsTable).values({
    cityId: city.id, provider: "openweather", latitude: city.latitude, longitude: city.longitude,
    lastAttemptAt: now, lastErrorCode: errorCode, consecutiveFailures: 1, updatedAt: now,
  }).onConflictDoUpdate({
    target: cityWeatherSnapshotsTable.cityId,
    set: {
      latitude: city.latitude,
      longitude: city.longitude,
      lastAttemptAt: now,
      lastErrorCode: errorCode,
      consecutiveFailures: sql`${cityWeatherSnapshotsTable.consecutiveFailures} + 1`,
      updatedAt: now,
    },
  });
}

async function refreshCityWeatherWithRuntime(
  cityId: number,
  runtime: CityWeatherRuntime,
  now = new Date(),
): Promise<PublicCityWeatherSnapshot> {
  if (!runtime.liveIntegrationsAllowed) throw new Error("weather_live_integrations_disabled");
  if (!runtime.integrationEnabled) throw new Error("weather_integration_disabled");
  if (!runtime.apiKey) throw new Error("weather_api_key_missing");
  const [city] = await db.select({
    id: citiesTable.id,
    name: citiesTable.name,
    countryCode: countriesTable.code,
    latitude: citiesTable.latitude,
    longitude: citiesTable.longitude,
    sourceMetadata: citiesTable.sourceMetadata,
  }).from(citiesTable)
    .innerJoin(countriesTable, eq(countriesTable.id, citiesTable.countryId))
    .where(eq(citiesTable.id, cityId)).limit(1);
  if (!city) throw new Error("weather_city_not_found");
  const reservationId = await reserveWeatherProviderCall("city_refresh", city.id);
  try {
    let latitude = city.latitude;
    let longitude = city.longitude;
    let snapshot: Omit<PublicCityWeatherSnapshot, "isStale" | "attribution">;
    if (latitude === null || longitude === null) {
      const located = await fetchOpenWeatherCurrentByCityWithKey(city.name, city.countryCode, runtime.apiKey, now);
      latitude = located.latitude;
      longitude = located.longitude;
      snapshot = located.snapshot;
      const verifiedAt = new Date().toISOString();
      await db.update(citiesTable).set({
        latitude,
        longitude,
        sourceMetadata: {
          ...(city.sourceMetadata || {}),
          latitude: { sourceName: "OpenWeather Current Weather", sourceUrl: "https://openweathermap.org/current", verifiedAt },
          longitude: { sourceName: "OpenWeather Current Weather", sourceUrl: "https://openweathermap.org/current", verifiedAt },
        },
      }).where(eq(citiesTable.id, city.id));
    } else {
      snapshot = await fetchOpenWeatherCurrentWithKey(latitude, longitude, runtime.apiKey, now);
    }
    await finishWeatherProviderCall(reservationId);
    const target = { id: city.id, latitude, longitude };
    const value = {
      cityId: target.id,
      provider: snapshot.provider,
      latitude: target.latitude,
      longitude: target.longitude,
      conditionCode: snapshot.conditionCode,
      conditionGroup: snapshot.conditionGroup,
      description: snapshot.description,
      iconCode: snapshot.iconCode,
      temperatureC: snapshot.temperatureC,
      feelsLikeC: snapshot.feelsLikeC,
      minimumC: snapshot.minimumC,
      maximumC: snapshot.maximumC,
      humidityPercent: snapshot.humidityPercent,
      windSpeedMps: snapshot.windSpeedMps,
      observedAt: new Date(snapshot.observedAt),
      forecastDate: snapshot.forecastDate,
      fetchedAt: new Date(snapshot.fetchedAt),
      staleAfter: new Date(snapshot.staleAfter),
      lastAttemptAt: now,
      lastErrorCode: null,
      consecutiveFailures: 0,
      updatedAt: now,
    };
    const { cityId: _cityId, ...updateValue } = value;
    const [row] = await db.insert(cityWeatherSnapshotsTable).values(value)
      .onConflictDoUpdate({ target: cityWeatherSnapshotsTable.cityId, set: updateValue }).returning();
    publicCatalogInvalidationBus.publish({ entityType: "catalog" });
    return projectSnapshot(row, now)!;
  } catch (error) {
    await finishWeatherProviderCall(reservationId, error);
    if (city.latitude !== null && city.longitude !== null) {
      await recordFailure({ id: city.id, latitude: city.latitude, longitude: city.longitude }, error, now);
    }
    throw error;
  }
}

export async function refreshCityWeather(cityId: number, env: WeatherEnvironment = process.env, now = new Date()): Promise<PublicCityWeatherSnapshot> {
  const runtime = env === process.env ? await resolveCityWeatherRuntime(env) : environmentRuntime(env);
  return refreshCityWeatherWithRuntime(cityId, runtime, now);
}

export async function syncDueCityWeather(
  env: WeatherEnvironment = process.env,
  now = new Date(),
  options: { manual?: boolean } = {},
) {
  const runtime = env === process.env ? await resolveCityWeatherRuntime(env) : environmentRuntime(env);
  const available = runtime.liveIntegrationsAllowed && runtime.integrationEnabled && runtime.keyConfigured;
  if (!available || (!options.manual && !runtime.automaticSyncEnabled)) {
    return { status: "disabled" as const, requested: 0, refreshed: 0, failed: 0, skipped: 0 };
  }
  // Do not select more work than the provider budget can currently execute.
  // This keeps bulk/automatic runs honest (no artificial "skipped" tail) and
  // avoids replacing the last useful run with an empty quota-exhausted run.
  const quota = await readCityWeatherQuotaStatus();
  if (quota.remaining <= 0) {
    return { status: "quota_exhausted" as const, requested: 0, refreshed: 0, failed: 0, skipped: 0 };
  }
  const limit = Math.min(runtime.batchSize, quota.remaining);
  const due = await db.select({
    id: citiesTable.id,
    latitude: citiesTable.latitude,
    longitude: citiesTable.longitude,
    cachedLatitude: cityWeatherSnapshotsTable.latitude,
    cachedLongitude: cityWeatherSnapshotsTable.longitude,
  }).from(citiesTable)
    .leftJoin(cityWeatherSnapshotsTable, eq(cityWeatherSnapshotsTable.cityId, citiesTable.id))
    .where(and(
      eq(citiesTable.isActive, true),
      or(
        isNull(citiesTable.latitude),
        isNull(citiesTable.longitude),
        isNull(cityWeatherSnapshotsTable.staleAfter),
        lte(cityWeatherSnapshotsTable.staleAfter, now),
        sql`${cityWeatherSnapshotsTable.latitude} IS DISTINCT FROM ${citiesTable.latitude}`,
        sql`${cityWeatherSnapshotsTable.longitude} IS DISTINCT FROM ${citiesTable.longitude}`,
      ),
    ))
    .orderBy(asc(cityWeatherSnapshotsTable.staleAfter), asc(citiesTable.id))
    .limit(limit);
  const [run] = await db.insert(weatherSyncRunsTable).values({
    provider: "openweather", status: "running", requestedCount: due.length, startedAt: now,
  }).returning({ id: weatherSyncRunsTable.id });
  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  for (let index = 0; index < due.length; index += 1) {
    const city = due[index];
    try {
      await refreshCityWeatherWithRuntime(city.id, runtime, new Date());
      refreshed += 1;
    } catch (error) {
      if (safeErrorCode(error) === "weather_hourly_quota_exhausted") {
        skipped = due.length - index;
        break;
      }
      failed += 1;
    }
  }
  const status = skipped > 0
    ? refreshed > 0 || failed > 0
      ? "partial"
      : "quota_exhausted"
    : failed === 0
      ? "completed"
      : refreshed > 0
        ? "partial"
        : "failed";
  await db.update(weatherSyncRunsTable).set({
    status,
    refreshedCount: refreshed,
    failedCount: failed,
    skippedCount: skipped,
    finishedAt: new Date(),
  }).where(eq(weatherSyncRunsTable.id, run.id));
  return { status, requested: due.length, refreshed, failed, skipped };
}

export async function readCityWeatherAdminStatus(env: WeatherEnvironment = process.env, now = new Date()) {
  const runtime = await resolveCityWeatherRuntime(env);
  const quota = await readCityWeatherQuotaStatus();
  const [counts] = await db.select({
    eligible: sql<number>`count(*) filter (where ${citiesTable.isActive} = true)`,
    coordinatesReady: sql<number>`count(*) filter (where ${citiesTable.isActive} = true and ${citiesTable.latitude} is not null and ${citiesTable.longitude} is not null)`,
    fresh: sql<number>`count(*) filter (where ${citiesTable.isActive} = true and ${citiesTable.latitude} is not null and ${citiesTable.longitude} is not null and ${cityWeatherSnapshotsTable.staleAfter} > ${now} and ${cityWeatherSnapshotsTable.latitude} is not distinct from ${citiesTable.latitude} and ${cityWeatherSnapshotsTable.longitude} is not distinct from ${citiesTable.longitude})`,
    failed: sql<number>`count(*) filter (where ${cityWeatherSnapshotsTable.lastErrorCode} is not null)`,
  }).from(citiesTable).leftJoin(cityWeatherSnapshotsTable, eq(cityWeatherSnapshotsTable.cityId, citiesTable.id));
  const [latestRun] = await db.select({
    status: weatherSyncRunsTable.status,
    requested: weatherSyncRunsTable.requestedCount,
    refreshed: weatherSyncRunsTable.refreshedCount,
    failed: weatherSyncRunsTable.failedCount,
    startedAt: weatherSyncRunsTable.startedAt,
    finishedAt: weatherSyncRunsTable.finishedAt,
  }).from(weatherSyncRunsTable).orderBy(sql`${weatherSyncRunsTable.startedAt} desc`).limit(1);
  const eligible = Number(counts?.eligible || 0);
  const fresh = Number(counts?.fresh || 0);
  return {
    integration: publicCityWeatherRuntime(runtime),
    nextAutomaticRunAt: runtime.automaticSyncEnabled ? nextCityWeatherAutomaticRun(now).toISOString() : null,
    continuationNextRunAt: manualContinuationNextRunAt,
    quota,
    inventory: {
      eligible,
      coordinatesReady: Number(counts?.coordinatesReady || 0),
      missingCoordinates: Math.max(0, eligible - Number(counts?.coordinatesReady || 0)),
      fresh,
      due: Math.max(0, eligible - fresh),
      failed: Number(counts?.failed || 0),
    },
    latestRun: latestRun ? {
      ...latestRun,
      startedAt: latestRun.startedAt.toISOString(),
      finishedAt: latestRun.finishedAt?.toISOString() || null,
    } : null,
  };
}

let weatherTimer: ReturnType<typeof setTimeout> | null = null;
let manualContinuationTimer: ReturnType<typeof setTimeout> | null = null;
let manualContinuationNextRunAt: string | null = null;
let weatherInFlight: Promise<unknown> | null = null;
let automaticBatchNumber = 0;
let weatherWorkerStopping = false;

function clearManualContinuation(): void {
  if (manualContinuationTimer) clearTimeout(manualContinuationTimer);
  manualContinuationTimer = null;
  manualContinuationNextRunAt = null;
}

/**
 * A manager-triggered first batch is allowed to finish the same bounded cycle.
 * Follow-ups wait for the rolling quota to fully reopen and never exceed the
 * same four-batch ceiling used by the nightly worker.
 */
export async function scheduleCityWeatherContinuationAfterManualRun(
  initialResult: { requested: number },
): Promise<{ scheduled: boolean; nextRunAt: string | null }> {
  clearManualContinuation();
  const runtime = await resolveCityWeatherRuntime();
  if (!runtime.automaticSyncEnabled || initialResult.requested <= 0) {
    return { scheduled: false, nextRunAt: null };
  }
  const status = await readCityWeatherAdminStatus();
  if (status.inventory.due <= 0) return { scheduled: false, nextRunAt: null };

  let batchesRemaining = AUTOMATIC_SYNC_MAX_BATCHES - 1;
  const scheduleNext = async (): Promise<string | null> => {
    if (weatherWorkerStopping || batchesRemaining <= 0) return null;
    const quota = await readCityWeatherQuotaStatus();
    const quotaReadyAt = quota.fullyResetsAt ? new Date(quota.fullyResetsAt).getTime() + 2_000 : Date.now() + AUTOMATIC_SYNC_FOLLOW_UP_MS;
    const delay = Math.max(60_000, quotaReadyAt - Date.now());
    const nextRunAt = new Date(Date.now() + delay).toISOString();
    manualContinuationNextRunAt = nextRunAt;
    manualContinuationTimer = setTimeout(() => {
      manualContinuationTimer = null;
      manualContinuationNextRunAt = null;
      if (weatherWorkerStopping || weatherInFlight) {
        void scheduleNext();
        return;
      }
      batchesRemaining -= 1;
      weatherInFlight = syncDueCityWeather().then(async (result) => {
        const latest = await readCityWeatherAdminStatus();
        if (latest.inventory.due > 0 && result.status !== "disabled") await scheduleNext();
      }).catch((error) => {
        console.error("[city-weather] manual continuation failed", safeErrorCode(error));
      }).finally(() => { weatherInFlight = null; });
    }, delay);
    manualContinuationTimer.unref?.();
    return nextRunAt;
  };

  const nextRunAt = await scheduleNext();
  return { scheduled: Boolean(nextRunAt), nextRunAt };
}

/**
 * Automatic refresh starts just after midnight in Istanbul. Turkey has used
 * permanent UTC+03:00 since 2016, so this calculation is deterministic and
 * does not inherit the host machine's local timezone.
 */
export function nextCityWeatherAutomaticRun(now = new Date()): Date {
  const localNow = new Date(now.getTime() + ISTANBUL_UTC_OFFSET_MS);
  let target = new Date(Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
    AUTOMATIC_SYNC_LOCAL_HOUR,
    AUTOMATIC_SYNC_LOCAL_MINUTE,
  ) - ISTANBUL_UTC_OFFSET_MS);
  if (target.getTime() <= now.getTime()) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1_000);
  }
  return target;
}

export function startCityWeatherSyncWorker(): () => Promise<void> {
  if (weatherTimer || weatherInFlight) return stopCityWeatherSyncWorker;
  weatherWorkerStopping = false;

  const scheduleDailyStart = () => {
    if (weatherWorkerStopping) return;
    automaticBatchNumber = 0;
    const delay = Math.max(1_000, nextCityWeatherAutomaticRun().getTime() - Date.now());
    weatherTimer = setTimeout(runAutomaticBatch, delay);
    weatherTimer.unref?.();
  };

  const scheduleFollowUp = () => {
    if (weatherWorkerStopping) return;
    weatherTimer = setTimeout(runAutomaticBatch, AUTOMATIC_SYNC_FOLLOW_UP_MS);
    weatherTimer.unref?.();
  };

  const runAutomaticBatch = () => {
    weatherTimer = null;
    if (weatherInFlight) {
      scheduleFollowUp();
      return;
    }
    automaticBatchNumber += 1;
    weatherInFlight = syncDueCityWeather().then((result) => {
      const mayHaveMoreDue = result.status === "quota_exhausted"
        || result.skipped > 0
        || result.requested >= DEFAULT_BATCH_SIZE;
      if (mayHaveMoreDue && automaticBatchNumber < AUTOMATIC_SYNC_MAX_BATCHES) scheduleFollowUp();
      else scheduleDailyStart();
    }).catch((error) => {
      console.error("[city-weather] automatic batch failed", safeErrorCode(error));
      scheduleDailyStart();
    }).finally(() => { weatherInFlight = null; });
  };

  scheduleDailyStart();
  void readCityWeatherAdminStatus().then((status) => {
    const latestStartedAt = status.latestRun?.startedAt ? new Date(status.latestRun.startedAt).getTime() : 0;
    const recentRunCanResume = latestStartedAt > 0
      && Date.now() - latestStartedAt <= 2 * 60 * 60 * 1_000
      && status.inventory.due > 0
      && Number(status.latestRun?.requested || 0) > 0;
    if (recentRunCanResume) {
      return scheduleCityWeatherContinuationAfterManualRun({ requested: Number(status.latestRun!.requested) });
    }
    return undefined;
  }).catch((error) => {
    console.error("[city-weather] interrupted cycle recovery failed", safeErrorCode(error));
  });
  return stopCityWeatherSyncWorker;
}

export async function stopCityWeatherSyncWorker(): Promise<void> {
  weatherWorkerStopping = true;
  if (weatherTimer) clearTimeout(weatherTimer);
  clearManualContinuation();
  weatherTimer = null;
  automaticBatchNumber = 0;
  await weatherInFlight;
}
