import rateLimit from "express-rate-limit";
import { PgRateLimitStore } from "./pgRateLimiter";

const WINDOW_MS = 15 * 60 * 1000;

export const publicLeadLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again later." },
  store: new PgRateLimitStore(WINDOW_MS),
});
