const DEFAULT_LOGIN_ATTEMPT_LIMIT = 10;
const MIN_LOGIN_ATTEMPT_LIMIT = 5;
const MAX_LOGIN_ATTEMPT_LIMIT = 20;

export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

export function resolveLoginAttemptLimit(
  rawValue = process.env.LOGIN_RATE_LIMIT_POINTS,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_LOGIN_ATTEMPT_LIMIT;
  }

  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed)) {
    return DEFAULT_LOGIN_ATTEMPT_LIMIT;
  }

  return Math.min(MAX_LOGIN_ATTEMPT_LIMIT, Math.max(MIN_LOGIN_ATTEMPT_LIMIT, parsed));
}

export const LOGIN_RATE_LIMIT_POINTS = resolveLoginAttemptLimit();
