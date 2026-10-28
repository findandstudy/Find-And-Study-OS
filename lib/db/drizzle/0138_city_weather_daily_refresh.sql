-- Existing cached measurements adopt the daily refresh policy without
-- discarding or re-fetching otherwise valid weather data.
UPDATE city_weather_snapshots
SET stale_after = fetched_at + interval '24 hours'
WHERE fetched_at IS NOT NULL
  AND (stale_after IS NULL OR stale_after > fetched_at + interval '24 hours');
