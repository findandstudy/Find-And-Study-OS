import crypto from "crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./middlewares/authMiddleware";
import { getCsrfCookieOptions } from "./lib/cookieOptions";
import { getAllowedOrigins } from "./lib/requestOrigin";
import router from "./routes";
import webhooksRouter from "./routes/webhooks";

const app: Express = express();
app.set("trust proxy", 1);

const cspDirectives = {
  defaultSrc: ["'self'"],
  // TODO: switch scriptSrc/styleSrc to nonce-based CSP once template/SSR pipeline emits per-request nonces.
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", "data:", "https:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'", "https:"],
  frameSrc: ["'self'"],
  frameAncestors: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

app.use((req, res, next) => {
  const isEmbed = req.path.startsWith("/api/public/embed/");
  const isWidget = isEmbed && req.path.endsWith("/widget");

  if (isEmbed) {
    helmet({
      contentSecurityPolicy: isWidget ? false : { directives: cspDirectives },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: false,
      frameguard: isWidget ? false : undefined,
    })(req, res, next);
  } else {
    helmet({
      contentSecurityPolicy: { directives: cspDirectives },
      crossOriginEmbedderPolicy: false,
    })(req, res, next);
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/public/embed/") || req.path.startsWith("/api/public/lead")) {
    cors({ origin: true, credentials: false })(req, res, next);
  } else {
    cors({
      credentials: true,
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        // Always allow localhost origins (needed for local dev and e2e tests)
        if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
        const allowed = getAllowedOrigins();
        if (allowed.length === 0 || allowed.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS: origin ${origin} not allowed`));
      },
    })(req, res, next);
  }
});

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(cookieParser());

// gzip/br compression for JSON / text responses. Skip Server-Sent Events
// streams (text/event-stream) so events are flushed immediately to the
// client instead of being buffered by the compressor.
app.use(
  compression({
    filter: (req, res) => {
      const ct = String(res.getHeader("Content-Type") || "");
      if (ct.includes("text/event-stream")) return false;
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  }),
);

// Webhook routes are mounted BEFORE express.json so the raw body is available
// for HMAC signature verification. These endpoints do not require auth or CSRF.
app.use("/api", webhooksRouter);

// Default body limit is intentionally small to reduce DoS surface on
// unauthenticated public/embed/webhook routes. Bulk-import endpoints that
// genuinely need larger payloads (e.g. /api/programs/bulk with 7000+ rows ×
// 50+ columns) opt-in to a higher local limit by attaching their own
// express.json({ limit: "20mb" }) middleware at the route level — we must
// skip the global parser for those paths so the route-level parser is the
// one that actually reads the body.
const LARGE_BODY_PATHS = [
  "/api/countries/bulk",
  "/api/cities/bulk",
  "/api/universities/bulk",
  "/api/programs/bulk",
  "/api/public/apply",
  "/api/public/ai/extract-document",
  "/api/public/embed",
  "/api/ai/extract-document",
  "/api/ai/extract-bulk-csv",
  // Task #202: lossless export/import for embed widgets and website forms.
  // Route handlers install their own 2 MB parser; bypass the 1 MB global cap.
  "/api/embed/widgets/import",
  "/api/website/forms/import",
  // Contract signing carries the signer's signature as a base64 PNG (drawn or
  // uploaded). The global 1 MB cap rejected larger images with a generic 413
  // long before the route's own 2 MB validation could run. The primary
  // onboarding sign route installs its own 3 MB parser.
  "/api/contracts/me/sign",
];
// Stage-document uploads send the file as base64 inside a JSON body. A 1MB
// file balloons to ~1.4MB after base64 + JSON envelope, so the global 1MB
// cap rejects perfectly legitimate uploads. The route at
// /api/applications/:id/stage-documents installs its own 25MB parser.
const LARGE_BODY_PATH_REGEXES: RegExp[] = [
  /^\/api\/applications\/\d+\/stage-documents(\/|$)/,
  // Admin-driven (non-onboarding) contract signing also carries a base64
  // signature image; the route installs its own 3 MB parser.
  /^\/api\/contracts\/me\/session\/\d+\/sign$/,
];
function isLargeBodyPath(path: string): boolean {
  for (const p of LARGE_BODY_PATHS) {
    if (path === p || path.startsWith(p + "/")) return true;
  }
  for (const re of LARGE_BODY_PATH_REGEXES) {
    if (re.test(path)) return true;
  }
  return false;
}
const globalJson = express.json({ limit: "1mb" });
const globalUrlencoded = express.urlencoded({ extended: true, limit: "1mb" });
app.use((req, res, next) => {
  if (isLargeBodyPath(req.path)) return next();
  globalJson(req, res, next);
});
app.use((req, res, next) => {
  if (isLargeBodyPath(req.path)) return next();
  globalUrlencoded(req, res, next);
});
app.use(authMiddleware);

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    req.path.startsWith("/api/public/") ||
    req.path.startsWith("/api/course-finder") ||
    req.path.startsWith("/api/webhooks/") ||
    // The agent onboarding verify-with-link endpoint is hit by users clicking
    // an email button before any session/CSRF cookie has been issued. It is
    // protected by per-IP rate limiting and a single-use, time-bounded
    // 6-digit code bound to the email.
    req.path === "/api/agents/onboarding/verify-with-link" ||
    req.path === "/api/agents/onboarding/resend-public"
  ) {
    return next();
  }

  if (!req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, getCsrfCookieOptions(req, 7 * 24 * 60 * 60 * 1000));
  }

  if (!CSRF_SAFE_METHODS.has(req.method)) {
    const cookieToken = req.cookies[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      // Production returns this 403 silently, which is why CSRF failures (e.g.
      // an agent whose browser had no csrf_token cookie at contract-signing
      // time) produced "no log". Emit a structured line so the exact cause —
      // missing cookie vs missing header vs mismatch — is visible in prod logs.
      console.warn(
        "[csrf] rejected " +
          JSON.stringify({
            method: req.method,
            path: req.path,
            cookiePresent: Boolean(cookieToken),
            headerPresent: Boolean(headerToken),
            match: Boolean(cookieToken && headerToken && cookieToken === headerToken),
            userId: (req as any).user?.id ?? null,
            role: (req as any).user?.role ?? null,
            ua: req.headers["user-agent"] || null,
          }),
      );
      res.status(403).json({ error: "CSRF token missing or invalid" });
      return;
    }
  }

  next();
});

app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as any).status || (err as any).statusCode || 500;
  const isSafe = status < 500;
  const message = isSafe ? err.message : "Internal server error";
  console.error("[error]", err.message, err.stack?.split("\n")[1]);
  res.status(status).json({ error: message });
});

export default app;
