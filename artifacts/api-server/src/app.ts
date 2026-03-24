import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";

const app: Express = express();

function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  if (process.env.REPLIT_DOMAINS) {
    process.env.REPLIT_DOMAINS.split(",").forEach(d => origins.push(`https://${d.trim()}`));
  }
  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(",").forEach(d => origins.push(d.trim()));
  }
  return origins;
}

app.use((req, res, next) => {
  if (req.path.startsWith("/api/public/embed/") && req.path.endsWith("/widget")) {
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    })(req, res, next);
  } else {
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })(req, res, next);
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/public/embed/")) {
    cors({ origin: true, credentials: false })(req, res, next);
  } else {
    cors({
      credentials: true,
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(authMiddleware);

app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as any).status || (err as any).statusCode || 500;
  const isSafe = status < 500;
  const message = isSafe ? err.message : "Internal server error";
  console.error("[error]", err.message, err.stack?.split("\n")[1]);
  res.status(status).json({ error: message });
});

export default app;
