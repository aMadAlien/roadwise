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
const reportRateLimitMax = Number(process.env.REPORT_RATE_LIMIT_MAX || 5);
const reportRateLimitWindowMs = Number(process.env.REPORT_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const telegramRateLimitMax = Number(process.env.TELEGRAM_RATE_LIMIT_MAX || 20);
const telegramRateLimitWindowMs = Number(process.env.TELEGRAM_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const analyticsRateLimitMax = Number(process.env.ANALYTICS_RATE_LIMIT_MAX || 120);
const analyticsRateLimitWindowMs = Number(process.env.ANALYTICS_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const visitorCookieName = "roadwise_visitor";
const mimeTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png" };

let analytics = loadAnalytics();
let analyticsWrite = Promise.resolve();
let lastCriticalAlert = new Map();
const reportRateLimit = new Map();
const telegramRateLimit = new Map();
const analyticsRateLimit = new Map();

function loadAnalytics() {
  try {
    const saved = JSON.parse(fs.readFileSync(analyticsPath, "utf8"));
    return {
      totalPageViews: saved.totalPageViews || 0,
      totalUniqueVisitors: saved.totalUniqueVisitors || 0,
      totalReturningVisitors: saved.totalReturningVisitors || 0,
      totalTestStarts: saved.totalTestStarts || 0,
      totalTestsCompleted: saved.totalTestsCompleted || 0,
      totalQuestionsAnswered: saved.totalQuestionsAnswered || 0,
      daily: saved.daily || {},
      visitors: saved.visitors || {}
    };
  } catch {
    return { totalPageViews: 0, totalUniqueVisitors: 0, totalReturningVisitors: 0, totalTestStarts: 0, totalTestsCompleted: 0, totalQuestionsAnswered: 0, daily: {}, visitors: {} };
  }
}

function saveAnalytics() {
  analyticsWrite = analyticsWrite.catch(() => {}).then(() => fs.promises.writeFile(analyticsPath, JSON.stringify(analytics, null, 2))).catch((error) => {
    console.error(`Analytics write error (${analyticsPath}):`, error.message);
    throw error;
  });
  return analyticsWrite;
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]));
}

function getVisitorId(request) {
  const existing = parseCookies(request)[visitorCookieName];
  return existing && /^[a-f0-9]{32}$/.test(existing) ? existing : crypto.randomBytes(16).toString("hex");
}

function setVisitorCookie(response, visitorId) {
  response.setHeader("Set-Cookie", `${visitorCookieName}=${visitorId}; Max-Age=31536000; Path=/; SameSite=Lax; HttpOnly`);
}

function analyticsDay(day = new Date().toISOString().slice(0, 10)) {
  return analytics.daily[day] || { views: 0, visitors: [], newVisitors: 0, returningVisitors: 0, testStarts: 0, testsCompleted: 0, questionsAnswered: 0, modes: {}, topics: {} };
}

function visitorRecord(visitorId, now) {
  return analytics.visitors[visitorId] || { firstSeen: now, lastSeen: now, visits: 0, testStarts: 0, testsCompleted: 0, questionsAnswered: 0 };
}

function trackPageView(request, response) {
  const visitorId = getVisitorId(request);
  const now = new Date().toISOString();
  const day = new Date().toISOString().slice(0, 10);
  const daily = analyticsDay(day);
  const visitor = visitorRecord(visitorId, now);
  const isReturning = visitor.visits > 0;
  daily.views += 1;
  if (!daily.visitors.includes(visitorId)) daily.visitors.push(visitorId);
  if (!isReturning) daily.newVisitors += 1;
  else daily.returningVisitors += 1;
  visitor.visits += 1;
  visitor.lastSeen = now;
  analytics.visitors[visitorId] = visitor;
  analytics.totalPageViews += 1;
  if (!isReturning) analytics.totalUniqueVisitors += 1;
  else analytics.totalReturningVisitors += 1;
  analytics.daily[day] = daily;
  setVisitorCookie(response, visitorId);
  saveAnalytics().catch((error) => console.error("Analytics write error:", error.message));
}

function publicAnalytics() {
  const daily = Object.fromEntries(Object.entries(analytics.daily).map(([date, value]) => [date, {
    views: value.views,
    uniqueVisitors: value.visitors.length,
    newVisitors: value.newVisitors || 0,
    returningVisitors: value.returningVisitors || 0,
    testStarts: value.testStarts || 0,
    testsCompleted: value.testsCompleted || 0,
    questionsAnswered: value.questionsAnswered || 0,
    modes: value.modes || {},
    topics: value.topics || {}
  }]));
  return {
    totalPageViews: analytics.totalPageViews,
    totalUniqueVisitors: analytics.totalUniqueVisitors,
    totalReturningVisitors: analytics.totalReturningVisitors,
    totalTestStarts: analytics.totalTestStarts,
    totalTestsCompleted: analytics.totalTestsCompleted,
    totalQuestionsAnswered: analytics.totalQuestionsAnswered,
    completionRate: analytics.totalTestStarts ? Math.round((analytics.totalTestsCompleted / analytics.totalTestStarts) * 100) : 0,
    daily
  };
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

function allowAnalyticsEvent(request, response) {
  pruneRateLimitStore(analyticsRateLimit, analyticsRateLimitWindowMs);
  const limit = consumeRateLimit(analyticsRateLimit, requestIp(request), analyticsRateLimitMax, analyticsRateLimitWindowMs);
  if (!limit.allowed) {
    rejectRateLimitedRequest(response, limit.retryAfter);
    return false;
  }
  return true;
}

function analyticsEventPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const allowedEvents = new Set(["page_view", "test_started", "test_completed"]);
  const event = typeof payload.event === "string" ? payload.event : "";
  if (!allowedEvents.has(event)) return null;
  const mode = typeof payload.mode === "string" ? payload.mode.slice(0, 40) : "unknown";
  const topic = typeof payload.topic === "string" ? payload.topic.slice(0, 200) : "all";
  const total = Number.isInteger(payload.total) ? Math.max(0, Math.min(payload.total, 1000)) : 0;
  const correct = Number.isInteger(payload.correct) ? Math.max(0, Math.min(payload.correct, total)) : 0;
  return { event, mode, topic, total, correct };
}

async function trackAnalyticsEvent(request, response) {
  try {
    const payload = analyticsEventPayload(JSON.parse(await readBody(request)));
    if (!payload) {
      sendJson(response, 400, { error: "Некоректна аналітична подія" });
      return;
    }
    const visitorId = getVisitorId(request);
    setVisitorCookie(response, visitorId);
    const now = new Date().toISOString();
    const day = analyticsDay();
    const visitor = visitorRecord(visitorId, now);
    const modeKey = payload.mode || "unknown";
    const topicKey = payload.topic || "all";
    day.modes[modeKey] = day.modes[modeKey] || { starts: 0, completed: 0 };
    day.topics[topicKey] = day.topics[topicKey] || { starts: 0, completed: 0 };
    if (payload.event === "page_view") {
      const isReturning = visitor.visits > 0;
      day.views += 1;
      if (!day.visitors.includes(visitorId)) day.visitors.push(visitorId);
      if (!isReturning) {
        day.newVisitors += 1;
        analytics.totalUniqueVisitors += 1;
      } else {
        day.returningVisitors += 1;
        analytics.totalReturningVisitors += 1;
      }
      analytics.totalPageViews += 1;
      visitor.visits += 1;
    } else if (payload.event === "test_started") {
      analytics.totalTestStarts += 1;
      day.testStarts += 1;
      day.modes[modeKey].starts += 1;
      day.topics[topicKey].starts += 1;
      visitor.testStarts += 1;
    } else {
      analytics.totalTestsCompleted += 1;
      analytics.totalQuestionsAnswered += payload.total;
      day.testsCompleted += 1;
      day.questionsAnswered += payload.total;
      day.modes[modeKey].completed += 1;
      day.topics[topicKey].completed += 1;
      visitor.testsCompleted += 1;
      visitor.questionsAnswered += payload.total;
    }
    visitor.lastSeen = now;
    analytics.visitors[visitorId] = visitor;
    analytics.daily[new Date().toISOString().slice(0, 10)] = day;
    saveAnalytics().catch((error) => console.error("Analytics write error:", error.message));
    sendJson(response, 204, null);
  } catch (error) {
    sendJson(response, error.message === "Повідомлення завелике" ? 413 : 400, { error: "Не вдалося зберегти аналітичну подію" });
  }
}

function requestIp(request) {
  return request.headers["x-forwarded-for"]?.split(",")[0].trim() || request.socket.remoteAddress || "unknown";
}

function consumeRateLimit(store, key, max, windowMs) {
  const now = Date.now();
  const timestamps = (store.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (timestamps.length >= max) {
    store.set(key, timestamps);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000)) };
  }
  timestamps.push(now);
  store.set(key, timestamps);
  return { allowed: true, retryAfter: 0 };
}

function pruneRateLimitStore(store, windowMs) {
  const cutoff = Date.now() - windowMs;
  for (const [key, timestamps] of store) {
    const active = timestamps.filter((timestamp) => timestamp > cutoff);
    if (active.length) store.set(key, active);
    else store.delete(key);
  }
}

function rejectRateLimitedRequest(response, retryAfter) {
  response.setHeader("Retry-After", String(retryAfter));
  sendJson(response, 429, { error: "Забагато повідомлень. Спробуйте пізніше.", retryAfter });
}

function allowReport(request, response) {
  pruneRateLimitStore(reportRateLimit, reportRateLimitWindowMs);
  const clientLimit = consumeRateLimit(reportRateLimit, requestIp(request), reportRateLimitMax, reportRateLimitWindowMs);
  if (!clientLimit.allowed) {
    rejectRateLimitedRequest(response, clientLimit.retryAfter);
    return false;
  }
  return true;
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

function feedbackText(payload) {
  return [
    "💬 Нове повідомлення Roadwise",
    `Повідомлення: ${payload.message}`,
    `Контакт: ${payload.contact || "анонімно"}`
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
  pruneRateLimitStore(telegramRateLimit, telegramRateLimitWindowMs);
  const telegramLimit = consumeRateLimit(telegramRateLimit, "global", telegramRateLimitMax, telegramRateLimitWindowMs);
  if (!telegramLimit.allowed) {
    console.error(`Critical alert skipped: Telegram rate limit exceeded, retry in ${telegramLimit.retryAfter}s`);
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
    pruneRateLimitStore(telegramRateLimit, telegramRateLimitWindowMs);
    const telegramLimit = consumeRateLimit(telegramRateLimit, "global", telegramRateLimitMax, telegramRateLimitWindowMs);
    if (!telegramLimit.allowed) {
      rejectRateLimitedRequest(response, telegramLimit.retryAfter);
      return;
    }
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

async function submitFeedback(request, response) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    sendJson(response, 503, { error: "Telegram ще не налаштований на сервері" });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(request));
    const message = typeof payload.message === "string" ? payload.message.trim().slice(0, 2000) : "";
    const contact = typeof payload.contact === "string" ? payload.contact.trim().slice(0, 200) : "";
    if (!message) {
      sendJson(response, 400, { error: "Напишіть ваше повідомлення" });
      return;
    }
    pruneRateLimitStore(telegramRateLimit, telegramRateLimitWindowMs);
    const telegramLimit = consumeRateLimit(telegramRateLimit, "global", telegramRateLimitMax, telegramRateLimitWindowMs);
    if (!telegramLimit.allowed) {
      rejectRateLimitedRequest(response, telegramLimit.retryAfter);
      return;
    }
    const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: feedbackText({ message, contact }).slice(0, 4000) })
    });
    if (!telegramResponse.ok) {
      console.error("Telegram feedback error:", await telegramResponse.text());
      sendJson(response, 502, { error: "Telegram не прийняв повідомлення" });
      return;
    }
    sendJson(response, 200, { ok: true });
  } catch (error) {
    const status = error.message === "Повідомлення завелике" ? 413 : error instanceof SyntaxError ? 400 : 502;
    sendJson(response, status, { error: error.message || "Не вдалося надіслати повідомлення" });
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
  if (request.method === "OPTIONS" && (requestPath === "/api/report-question" || requestPath === "/api/feedback" || requestPath === "/api/analytics/event")) {
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
    if (allowReport(request, response)) reportQuestion(request, response);
  } else if (request.method === "POST" && requestPath === "/api/feedback") {
    if (allowReport(request, response)) submitFeedback(request, response);
  } else if (request.method === "POST" && requestPath === "/api/client-error") {
    reportClientError(request, response);
  } else if (request.method === "POST" && requestPath === "/api/analytics/event") {
    if (allowAnalyticsEvent(request, response)) trackAnalyticsEvent(request, response);
  } else if (request.method === "GET") {
    serveStatic(request, response);
  } else {
    sendJson(response, 405, { error: "Method not allowed" });
  }
});

server.on("clientError", (error, socket) => {
  const clientAddress = socket.remoteAddress || "unknown";
  const clientError = `${error.code || "HTTP_CLIENT_ERROR"}: ${error.message} (remote: ${clientAddress})`;
  console.warn("HTTP client error:", clientError);
  if (error.code !== "HPE_INVALID_METHOD" && error.code !== "HPE_INVALID_URL" && error.code !== "HPE_HEADER_OVERFLOW") {
    reportCriticalError(new Error(clientError), "http-client");
  }
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

server.listen(port, () => console.log(`Roadwise server: http://localhost:${port}; analytics: ${analyticsPath}`));
