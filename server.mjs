import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const maxBodySize = 20_000;
const analyticsPath = path.join(root, "analytics.json");
const analyticsKey = process.env.ANALYTICS_KEY;
const criticalAlertCooldownMs = 5 * 60 * 1000;
const mimeTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png" };

let analytics = loadAnalytics();
let analyticsWrite = Promise.resolve();
let lastCriticalAlert = new Map();

function loadAnalytics() {
  try {
    return JSON.parse(fs.readFileSync(analyticsPath, "utf8"));
  } catch {
    return { totalPageViews: 0, daily: {} };
  }
}

function saveAnalytics() {
  analyticsWrite = analyticsWrite.then(() => fs.promises.writeFile(analyticsPath, JSON.stringify(analytics, null, 2)));
  return analyticsWrite;
}

function trackPageView(request) {
  const day = new Date().toISOString().slice(0, 10);
  const forwardedIp = request.headers["x-forwarded-for"]?.split(",")[0].trim();
  const ip = forwardedIp || request.socket.remoteAddress || "unknown";
  const visitorHash = crypto.createHash("sha256").update(`${day}:${ip}`).digest("hex");
  const daily = analytics.daily[day] || { views: 0, visitors: [] };
  daily.views += 1;
  if (!daily.visitors.includes(visitorHash)) daily.visitors.push(visitorHash);
  analytics.totalPageViews += 1;
  analytics.daily[day] = daily;
  saveAnalytics().catch((error) => console.error("Analytics write error:", error.message));
}

function publicAnalytics() {
  const daily = Object.fromEntries(Object.entries(analytics.daily).map(([date, value]) => [date, { views: value.views, uniqueVisitors: value.visitors.length }]));
  return { totalPageViews: analytics.totalPageViews, daily };
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...response.corsHeaders });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodySize) {
        reject(new Error("Повідомлення завелике"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function telegramText(payload) {
  const question = payload.question;
  return [
    "⚠️ Помилка в питанні",
    `ID: ${question.id}`,
    `Тема: ${question.topic}`,
    `Питання: ${question.text}`,
    `Обрана відповідь: ${question.selectedAnswer || "не обрано"}`,
    `Опис: ${payload.message}`
  ].join("\n\n");
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function errorDetails(error) {
  return error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
}

async function reportCriticalError(error, context = "server") {
  const details = errorDetails(error).slice(0, 3000);
  const alertKey = `${context}:${details.split("\n")[0]}`;
  const lastSentAt = lastCriticalAlert.get(alertKey) || 0;
  if (Date.now() - lastSentAt < criticalAlertCooldownMs) return;
  lastCriticalAlert.set(alertKey, Date.now());
  const text = `🚨 Критична помилка Roadwise\nКонтекст: ${context}\nЧас: ${new Date().toISOString()}\n\n${details}`;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Critical alert skipped: Telegram is not configured", text);
    return;
  }
  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000) })
    });
    if (!telegramResponse.ok) console.error("Critical Telegram alert failed:", await telegramResponse.text());
  } catch (alertError) {
    console.error("Critical Telegram alert request failed:", errorDetails(alertError));
  }
}

function clientErrorPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const message = typeof payload.message === "string" ? payload.message.trim().slice(0, 1000) : "";
  const stack = typeof payload.stack === "string" ? payload.stack.trim().slice(0, 2000) : "";
  const url = typeof payload.url === "string" ? payload.url.slice(0, 500) : "";
  return message ? { message, stack, url } : null;
}

async function reportClientError(request, response) {
  try {
    const payload = clientErrorPayload(JSON.parse(await readBody(request)));
    if (!payload) {
      sendJson(response, 400, { error: "Некоректні дані помилки" });
      return;
    }
    await reportCriticalError({ name: "ClientError", message: `${payload.message}\nURL: ${payload.url}\n${payload.stack}` }, "browser");
    sendJson(response, 204, null);
  } catch (error) {
    await reportCriticalError(error, "client-error-endpoint");
    sendJson(response, error.message === "Повідомлення завелике" ? 413 : 400, { error: "Не вдалося обробити помилку" });
  }
}

async function reportQuestion(request, response) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    sendJson(response, 503, { error: "Telegram ще не налаштований на сервері" });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(request));
    const question = payload.question;
    if (!payload.message?.trim() || !question?.id || !question?.text || !question?.topic) {
      sendJson(response, 400, { error: "Заповніть опис помилки" });
      return;
    }
    const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: telegramText({ ...payload, message: payload.message.trim() }).slice(0, 4000) })
    });
    if (!telegramResponse.ok) {
      const telegramBody = await telegramResponse.text();
      let telegramDescription = "Telegram не прийняв повідомлення";
      try {
        telegramDescription = JSON.parse(telegramBody).description || telegramDescription;
      } catch {
        // Keep the generic message when Telegram returns a non-JSON response.
      }
      console.error("Telegram API error:", telegramDescription);
      sendJson(response, 502, { error: telegramDescription });
      return;
    }
    sendJson(response, 200, { ok: true });
  } catch (error) {
    const status = error.message === "Повідомлення завелике" ? 413 : error instanceof SyntaxError ? 400 : 502;
    sendJson(response, status, { error: error.message || "Помилка підключення до Telegram" });
  }
}

function serveStatic(request, response) {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  } catch (error) {
    reportCriticalError(error, "static-path");
    response.writeHead(400); response.end("Bad request"); return;
  }
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\//, "");
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404); response.end("Not found"); return;
  }
  if (request.method === "GET" && (relativePath === "index.html" || relativePath === "")) trackPageView(request);
  response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
  const stream = fs.createReadStream(filePath);
  stream.on("error", (error) => {
    reportCriticalError(error, `static-file:${relativePath}`);
    if (!response.headersSent) response.writeHead(500);
    response.end("Internal server error");
  });
  stream.pipe(response);
}

const server = http.createServer((request, response) => {
  response.corsHeaders = corsHeaders(request);
  let requestPath;
  try {
    requestPath = new URL(request.url, "http://localhost").pathname.replace(/^\/roadwise/, "");
  } catch (error) {
    reportCriticalError(error, "request-path");
    sendJson(response, 400, { error: "Некоректний запит" });
    return;
  }
  if (request.method === "OPTIONS" && requestPath === "/api/report-question") {
    response.writeHead(204, response.corsHeaders);
    response.end();
    return;
  }
  if (request.method === "GET" && requestPath === "/api/analytics") {
    if (!analyticsKey || request.headers["x-analytics-key"] !== analyticsKey) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    sendJson(response, 200, publicAnalytics());
    return;
  }
  if (request.method === "POST" && requestPath === "/api/report-question") {
    reportQuestion(request, response);
  } else if (request.method === "POST" && requestPath === "/api/client-error") {
    reportClientError(request, response);
  } else if (request.method === "GET") {
    serveStatic(request, response);
  } else {
    sendJson(response, 405, { error: "Method not allowed" });
  }
});

server.on("clientError", (error, socket) => {
  reportCriticalError(error, "http-client");
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", errorDetails(error));
  reportCriticalError(error, "uncaught-exception");
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", errorDetails(error));
  reportCriticalError(error, "unhandled-rejection");
});

server.listen(port, () => console.log(`Roadwise server: http://localhost:${port}`));
