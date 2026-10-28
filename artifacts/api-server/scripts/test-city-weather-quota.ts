import assert from "node:assert/strict";
import test from "node:test";
import { citiesTable, cityWeatherSnapshotsTable, countriesTable, db, weatherProviderCallsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { __setSafeOutboundRequestOverrideForTests } from "../src/lib/safeOutboundRequest";
import { readCityWeatherQuotaStatus, refreshCityWeather, testOpenWeatherConnection } from "../src/lib/cityWeather";

const weatherResponse = {
  coord: { lat: 41.1, lon: 29.2 },
  dt: 1_791_000_000,
  timezone: 10_800,
  weather: [{ id: 801, main: "Clouds", description: "few clouds", icon: "02d" }],
  main: { temp: 18.4, feels_like: 17.8, temp_min: 16.2, temp_max: 20.1, humidity: 64 },
  wind: { speed: 3.7 },
};

test("the shared rolling quota blocks call 51 before any outbound request", async () => {
  const marker = `weather_quota_test_${process.pid}_${Date.now()}`;
  let outboundCalled = false;
  try {
    const before = await readCityWeatherQuotaStatus();
    const fillerCount = Math.max(0, before.remaining);
    if (fillerCount > 0) {
      await db.insert(weatherProviderCallsTable).values(Array.from({ length: fillerCount }, () => ({
        provider: "openweather",
        callKind: "connection_test",
        outcome: "failed",
        errorCode: marker,
      })));
    }
    const full = await readCityWeatherQuotaStatus();
    assert.equal(full.used, 50);
    assert.equal(full.remaining, 0);
    __setSafeOutboundRequestOverrideForTests(async () => {
      outboundCalled = true;
      throw new Error("outbound_should_not_run");
    });
    await assert.rejects(testOpenWeatherConnection("not-a-real-key"), /weather_hourly_quota_exhausted/);
    assert.equal(outboundCalled, false);
  } finally {
    __setSafeOutboundRequestOverrideForTests(null);
    await db.delete(weatherProviderCallsTable).where(eq(weatherProviderCallsTable.errorCode, marker));
  }
});
test("a city without coordinates is geocoded, persisted and refreshed", async (context) => {
  const quota = await readCityWeatherQuotaStatus();
  if (quota.remaining < 1) {
    context.skip("the local provider quota is already full from real calls");
    return;
  }
  const marker = `Weather geocode test ${process.pid} ${Date.now()}`;
  const countryCode = `T${process.pid}${Date.now()}`;
  let countryId: number | null = null;
  let cityId: number | null = null;
  const requestedPaths: string[] = [];
  try {
    const [country] = await db.insert(countriesTable).values({ name: marker, code: countryCode }).returning({ id: countriesTable.id });
    countryId = country.id;
    const [city] = await db.insert(citiesTable).values({ name: "Quota Test City", countryId: country.id }).returning({ id: citiesTable.id });
    cityId = city.id;
    __setSafeOutboundRequestOverrideForTests(async (url) => {
      const parsed = new URL(url);
      requestedPaths.push(parsed.pathname);
      return { ok: true, status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(weatherResponse)), url };
    });
    const snapshot = await refreshCityWeather(city.id, {
      ALLOW_OPENWEATHER_INTEGRATION: "true",
      OPENWEATHER_API_KEY: "not-a-real-key",
    });
    assert.deepEqual(requestedPaths, ["/data/2.5/weather"]);
    assert.equal(snapshot.temperatureC, 18.4);
    const [storedCity] = await db.select({ latitude: citiesTable.latitude, longitude: citiesTable.longitude, sourceMetadata: citiesTable.sourceMetadata })
      .from(citiesTable).where(eq(citiesTable.id, city.id));
    assert.equal(storedCity.latitude, 41.1);
    assert.equal(storedCity.longitude, 29.2);
    assert.equal(storedCity.sourceMetadata.latitude?.sourceName, "OpenWeather Current Weather");
    const [storedSnapshot] = await db.select({ cityId: cityWeatherSnapshotsTable.cityId })
      .from(cityWeatherSnapshotsTable).where(eq(cityWeatherSnapshotsTable.cityId, city.id));
    assert.equal(storedSnapshot.cityId, city.id);
  } finally {
    __setSafeOutboundRequestOverrideForTests(null);
    if (cityId) await db.delete(weatherProviderCallsTable).where(eq(weatherProviderCallsTable.cityId, cityId));
    if (countryId) await db.delete(countriesTable).where(eq(countriesTable.id, countryId));
  }
});
