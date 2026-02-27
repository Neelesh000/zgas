import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { healthCheck, closePool } from "./db";
import { rebuildASPTreeFromDB } from "./services/asp.service";
import { startDepositWatcher } from "./workers/depositWatcher";
import { startASPUpdater } from "./workers/aspUpdater";
import { startWithdrawalProcessor } from "./workers/withdrawalProcessor";
import apiRouter from "./routes/api";

async function main(): Promise<void> {
  const app = express();

  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------

  // Security headers
  app.use(helmet());

  // CORS
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Body parsing
  app.use(express.json({ limit: "1mb" }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });
  app.use("/api/", limiter);

  // Request logging
  app.use((req, _res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
  });

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  // Health check
  app.get("/health", async (_req, res) => {
    const dbOk = await healthCheck();
    const status = dbOk ? "healthy" : "degraded";
    res.status(dbOk ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? "connected" : "disconnected",
      },
    });
  });

  // API routes
  app.use("/api", apiRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Global error handler
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error("[Server] Unhandled error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  // Verify database connectivity
  const dbOk = await healthCheck();
  if (!dbOk) {
    console.error(
      "[Server] Database connection failed. Ensure DATABASE_URL is set and the database is running."
    );
    process.exit(1);
  }
  console.log("[Server] Database connected");

  // Rebuild ASP tree from persisted state
  await rebuildASPTreeFromDB();

  // Start background workers
  const stopDepositWatcher = await startDepositWatcher();
  const stopASPUpdater = await startASPUpdater();
  const stopWithdrawalProcessor = await startWithdrawalProcessor();

  // Start HTTP server
  const server = app.listen(config.port, () => {
    console.log(
      `[Server] Privacy Paymaster Relayer running on port ${config.port} (${config.nodeEnv})`
    );
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      console.log("[Server] HTTP server closed");
    });

    // Stop workers
    stopDepositWatcher();
    stopASPUpdater();
    stopWithdrawalProcessor();

    // Close database pool
    await closePool();
    console.log("[Server] Database pool closed");

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Catch unhandled rejections
  process.on("unhandledRejection", (reason) => {
    console.error("[Server] Unhandled rejection:", reason);
  });
}

main().catch((err) => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
