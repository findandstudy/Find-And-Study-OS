import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";

const app: Express = express();

const isDev = process.env.NODE_ENV !== "production";

app.use(cors({
  origin: isDev ? true : (process.env.ALLOWED_ORIGIN ?? false),
  credentials: true,
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", router);

export default app;
