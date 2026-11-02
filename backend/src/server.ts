import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectDb } from "./config/database.js";
import { logServerError } from "./shared/logger.js";

const app = createApp();

export const server = app.listen(env.PORT, () => {
   
  console.info(`Server berjalan di http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string): void {
   
  console.info(`[shutdown] Menerima ${signal}, menutup server...`);
  server.close(async () => {
     
    console.info("[shutdown] HTTP server ditutup");
    try {
      await disconnectDb();
       
      console.info("[shutdown] Prisma terputus");
      process.exit(0);
    } catch (err) {
       
      // Gunakan safe logger (tanpa message/stack/PII) alih-alih console.error mentah.
      logServerError(undefined, err);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Tangani promise yang tidak tertangkap agar tidak diam-diam gagal.
// Catat ringkasan aman (tanpa message/stack/PII) sebelum proses keluar.
process.on("unhandledRejection", (err: unknown) => {
   
  logServerError(undefined, err);
  process.exit(1);
});

export default app;
