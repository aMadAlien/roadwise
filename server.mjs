import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { AVAILABLE_TOPICS } from "./available-topics.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const maxBodySize = 20_000;
const analyticsPath = path.join(root, "analytics.json");
const questionsDir = path.join(root, "questions.by-topic");
const analyticsKey = process.env.ANALYTICS_KEY;
const AVAILABLE_RANDOM_TOPICS = AVAILABLE_TOPICS;
const criticalAlertCooldownMs = 5 * 60 * 1000;
const reportRateLimitMax = Number(process.env.REPORT_RATE_LIMIT_MAX || 5);
const reportRateLimitWindowMs = Number(process.env.REPORT_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const telegramRateLimitMax = Number(process.env.TELEGRAM_RATE_LIMIT_MAX || 20);
const telegramRateLimitWindowMs = Number(process.env.TELEGRAM_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const targetedSurveyRateLimitEnabled = process.env.TARGETED_SURVEY_RATE_LIMIT_ENABLED === "true";
const analyticsRateLimitMax = Number(process.env.ANALYTICS_RATE_LIMIT_MAX || 120);
const analyticsRateLimitWindowMs = Number(process.env.ANALYTICS_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const visitorCookieName = "roadwise_visitor";
const visitorThanksReactionCookieName = "roadwise_thanks_reacted";
const thankedVisitorId = "";
const targetedSurveyVersion = 2;
const targetedSurveyQuestions = [
  { title: "З якою метою ти найчастіше заходиш на Roadwise?", options: ["Готуюся до теоретичного іспиту", "Вчу окремі теми", "Повторюю складні питання", "Тренуюсь для себе", "Все одразу"] },
  { title: "Який формат тренування використовуєш найчастіше?", options: ["За темами", "За білетами", "Випадковий іспит", "Мої помилки"] },
  { title: "Чого тобі найбільше бракує або що варто покращити?", options: ["Пояснень до відповідей", "Більше різних режимів тренування", "Зручнішого повторення помилок", "Можливості зберігати питання по категоріях", "Нічого, усе необхідне є"], other: true },
  { title: "Наскільки вам зручно користуватися сайтом?", options: ["1", "2", "3", "4", "5"] },
  { title: "Наскільки ймовірно, що порадиш Roadwise друзям?", options: Array.from({ length: 11 }, (_, score) => String(score)) }
];
const excludedAnalyticsVisitors = new Set([
  "b23667de6c213192205a3b9f3f1fdf3f",
  "b23cfece3870fdc9affba62aad11d1af",
  "530821532936155f5aabe36598f3f105"
]);
const mimeTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png" };

let analytics = loadAnalytics();
let analyticsWrite = Promise.resolve();
let lastCriticalAlert = new Map();
const reportRateLimit = new Map();
const telegramRateLimit = new Map();
const analyticsRateLimit = new Map();

function loadAnalytics() {
  try {
    console.log('analyticsPath: ', analyticsPath)
    const saved = JSON.parse(fs.readFileSync(analyticsPath, "utf8"));
    console.log('saved analytics: ', saved);
    return {
      totalPageViews: saved.totalPageViews || 0,
      totalUniqueVisitors: saved.totalUniqueVisitors || 0,
      totalReturningVisitors: saved.totalReturningVisitors || 0,
      totalTestStarts: saved.totalTestStarts || 0,
      totalTestsCompleted: saved.totalTestsCompleted || 0,
      totalQuestionsAnswered: saved.totalQuestionsAnswered || 0,
      totalRatings: saved.totalRatings || 0,
      ratings: saved.ratings || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      daily: saved.daily || {},
      visitors: saved.visitors || {}
    };
  } catch {
    return { totalPageViews: 0, totalUniqueVisitors: 0, totalReturningVisitors: 0, totalTestStarts: 0, totalTestsCompleted: 0, totalQuestionsAnswered: 0, totalRatings: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, daily: {}, visitors: {} };
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
  const visitor = analytics.visitors[visitorId] || { firstSeen: now, lastSeen: now, visits: 0, testStarts: 0, testsCompleted: 0, questionsAnswered: 0 };
  visitor.activityByDay ||= {};
  visitor.feedbackSurvey ||= { status: "not_started", answers: [], version: targetedSurveyVersion };
  return visitor;
}

function visitorActivityDay(visitor, date) {
  visitor.activityByDay[date] ||= { views: 0, testStarts: 0, testsCompleted: 0 };
  return visitor.activityByDay[date];
}

function trackPageView(request, response) {
  const visitorId = getVisitorId(request);
  setVisitorCookie(response, visitorId);
  if (excludedAnalyticsVisitors.has(visitorId)) return;
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const daily = analyticsDay(date);
  const visitor = visitorRecord(visitorId, now);
  visitorActivityDay(visitor, date).views += 1;
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
  analytics.daily[date] = daily;
  saveAnalytics().catch((error) => console.error("Analytics write error:", error.message));
}

function publicAnalytics() {
  console.log('analytics data: ', analytics)
  const daily = Object.fromEntries(Object.entries(analytics.daily).map(([date, value]) => [date, {
    views: value.views,
    uniqueVisitors: (value.visitors || []).length,
    newVisitors: value.newVisitors || 0,
    returningVisitors: value.returningVisitors || 0,
    testStarts: value.testStarts || 0,
    testsCompleted: value.testsCompleted || 0,
    questionsAnswered: value.questionsAnswered || 0,
    modes: value.modes || {},
    topics: value.topics || {}
  }]));
  const visitorDates = new Map();
  for (const [date, value] of Object.entries(analytics.daily)) {
    for (const visitorId of value.visitors || []) {
      if (!visitorDates.has(visitorId)) visitorDates.set(visitorId, new Set());
      visitorDates.get(visitorId).add(date);
    }
  }
  const visitors = Object.entries(analytics.visitors).map(([id, visitor]) => {
    const activeDates = visitorDates.get(id) || new Set();
    for (const date of Object.keys(visitor.activityByDay || {})) activeDates.add(date);
    const dates = [...activeDates].sort();
    const activityByDay = Object.fromEntries(dates.map((date) => {
      const activity = visitor.activityByDay?.[date];
      return [date, activity
        ? { views: activity.views, testStarts: activity.testStarts, testsCompleted: activity.testsCompleted, recorded: true }
        : { views: null, testStarts: null, testsCompleted: null, recorded: false }];
    }));
    let bestStreak = 0;
    let streak = 0;
    let previousDay = null;
    for (const date of dates) {
      const currentDay = Date.parse(`${date}T00:00:00Z`);
      streak = previousDay !== null && currentDay - previousDay === 86_400_000 ? streak + 1 : 1;
      bestStreak = Math.max(bestStreak, streak);
      previousDay = currentDay;
    }
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const currentStreak = dates.length && (dates[dates.length - 1] === today || dates[dates.length - 1] === yesterday) ? streak : 0;
    return {
      id,
      firstSeen: visitor.firstSeen,
      lastSeen: visitor.lastSeen,
      visits: visitor.visits || 0,
      testStarts: visitor.testStarts || 0,
      testsCompleted: visitor.testsCompleted || 0,
      questionsAnswered: visitor.questionsAnswered || 0,
      activeDays: dates.length,
      currentStreak,
      bestStreak,
      activityByDay
    };
  }).sort((first, second) => Date.parse(second.lastSeen || 0) - Date.parse(first.lastSeen || 0));
  return {
    totalPageViews: analytics.totalPageViews,
    totalUniqueVisitors: analytics.totalUniqueVisitors,
    totalReturningVisitors: analytics.totalReturningVisitors,
    totalTestStarts: analytics.totalTestStarts,
    totalTestsCompleted: analytics.totalTestsCompleted,
    totalQuestionsAnswered: analytics.totalQuestionsAnswered,
    totalRatings: analytics.totalRatings,
    ratings: analytics.ratings,
    completionRate: analytics.totalTestStarts ? Math.round((analytics.totalTestsCompleted / analytics.totalTestStarts) * 100) : 0,
    daily,
    visitors
  };
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    ...response.corsHeaders
  });
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
  const allowedEvents = new Set(["page_view", "test_started", "test_completed", "site_rating"]);
  const event = typeof payload.event === "string" ? payload.event : "";
  if (!allowedEvents.has(event)) return null;
  const mode = typeof payload.mode === "string" ? payload.mode.slice(0, 40) : "unknown";
  const topic = typeof payload.topic === "string" ? payload.topic.slice(0, 200) : "all";
  const total = Number.isInteger(payload.total) ? Math.max(0, Math.min(payload.total, 1000)) : 0;
  const correct = Number.isInteger(payload.correct) ? Math.max(0, Math.min(payload.correct, total)) : 0;
  const rating = Number.isInteger(payload.rating) && payload.rating >= 1 && payload.rating <= 5 ? payload.rating : null;
  if (event === "site_rating" && rating === null) return null;
  return { event, mode, topic, total, correct, rating };
}

function ratingText(payload) {
  return [
    "⭐ Нова оцінка Roadwise",
    `Оцінка: ${payload.rating}/5`,
    `Відвідувач: ${payload.visitorId}`,
    `Час: ${new Date().toISOString()}`
  ].join("\n\n");
}

async function sendRatingToTelegram(payload) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Rating notification skipped: Telegram is not configured");
    return;
  }
  pruneRateLimitStore(telegramRateLimit, telegramRateLimitWindowMs);
  const telegramLimit = consumeRateLimit(telegramRateLimit, "global", telegramRateLimitMax, telegramRateLimitWindowMs);
  if (!telegramLimit.allowed) {
    console.error(`Rating notification skipped: Telegram rate limit exceeded, retry in ${telegramLimit.retryAfter}s`);
    return;
  }
  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: ratingText(payload).slice(0, 4000) })
    });
    if (!telegramResponse.ok) console.error("Telegram rating notification failed:", await telegramResponse.text());
  } catch (error) {
    console.error("Telegram rating notification request failed:", errorDetails(error));
  }
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
    if (excludedAnalyticsVisitors.has(visitorId)) {
      sendJson(response, 204, null);
      return;
    }
    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const day = analyticsDay(date);
    const visitor = visitorRecord(visitorId, now);
    const visitorDay = visitorActivityDay(visitor, date);
    const modeKey = payload.mode || "unknown";
    const topicKey = payload.topic || "all";
    day.modes[modeKey] = day.modes[modeKey] || { starts: 0, completed: 0 };
    day.topics[topicKey] = day.topics[topicKey] || { starts: 0, completed: 0 };
    if (payload.event === "site_rating") {
      analytics.totalRatings += 1;
      analytics.ratings[payload.rating] = (analytics.ratings[payload.rating] || 0) + 1;
      visitor.lastRating = payload.rating;
      await sendRatingToTelegram({ rating: payload.rating, visitorId });
    } else if (payload.event === "page_view") {
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
      visitorDay.views += 1;
    } else if (payload.event === "test_started") {
      analytics.totalTestStarts += 1;
      day.testStarts += 1;
      day.modes[modeKey].starts += 1;
      day.topics[topicKey].starts += 1;
      visitor.testStarts += 1;
      visitorDay.testStarts += 1;
    } else {
      analytics.totalTestsCompleted += 1;
      analytics.totalQuestionsAnswered += payload.total;
      day.testsCompleted += 1;
      day.questionsAnswered += payload.total;
      day.modes[modeKey].completed += 1;
      day.topics[topicKey].completed += 1;
      visitor.testsCompleted += 1;
      visitor.questionsAnswered += payload.total;
      visitorDay.testsCompleted += 1;
    }
    visitor.lastSeen = now;
    analytics.visitors[visitorId] = visitor;
    analytics.daily[date] = day;
    saveAnalytics().catch((error) => console.error("Analytics write error:", error.message));
    sendJson(response, 204, null);
  } catch (error) {
    sendJson(response, error.message === "Повідомлення завелике" ? 413 : 400, { error: "Не вдалося зберегти аналітичну подію" });
  }
}

function requestIp(request) {
  return request.headers["x-forwarded-for"]?.split(",")[0].trim() || request.socket.remoteAddress || "unknown";
}

function loadTopicIndex() {
  const indexFile = fs.existsSync(path.join(questionsDir, "index.json"))
    ? "index.json"
    : "index.json";
  return JSON.parse(fs.readFileSync(path.join(questionsDir, indexFile), "utf8"));
}

function loadTopicFile(file) {
  const filePath = path.join(questionsDir, file);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function shuffleArray(items) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getRandomQuestions(count) {
  const index = loadTopicIndex();
  const entries = AVAILABLE_RANDOM_TOPICS.length ? index.filter((entry) => AVAILABLE_RANDOM_TOPICS.includes(entry.file.replace(/\.json$/, ""))) : index;
  const pool = entries.flatMap((entry) => loadTopicFile(entry.file));
  return shuffleArray(pool).slice(0, count);
}

function handleRandomQuestions(request, response) {
  try {
    const url = new URL(request.url, "http://localhost");
    const requestedCount = Number(url.searchParams.get("count"));
    const count = Number.isInteger(requestedCount) && requestedCount > 0 ? Math.min(requestedCount, 50) : 20;
    sendJson(response, 200, { questions: getRandomQuestions(count) });
  } catch (error) {
    reportCriticalError(error, "questions-random");
    sendJson(response, 500, { error: "Не вдалося отримати питання" });
  }
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

function allowTargetedSurveyRequest(request, response) {
  return !targetedSurveyRateLimitEnabled || allowReport(request, response);
}

function allowTargetedSurveyTelegram(response = null) {
  if (!targetedSurveyRateLimitEnabled) return true;
  pruneRateLimitStore(telegramRateLimit, telegramRateLimitWindowMs);
  const telegramLimit = consumeRateLimit(telegramRateLimit, "global", telegramRateLimitMax, telegramRateLimitWindowMs);
  if (telegramLimit.allowed) return true;
  if (response) rejectRateLimitedRequest(response, telegramLimit.retryAfter);
  else console.error(`Survey notification skipped: Telegram rate limit exceeded, retry in ${telegramLimit.retryAfter}s`);
  return false;
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
    `Опис: ${payload.message}`,
    `Відвідувач: ${payload.visitorId}`
  ].join("\n\n");
}

function feedbackText(payload) {
  return [
    "💬 Нове повідомлення Roadwise",
    `Повідомлення: ${payload.message}`,
    `Контакт: ${payload.contact || "анонімно"}`,
    `Відвідувач: ${payload.visitorId}`
  ].join("\n\n");
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const telegramWebhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

function isValidTelegramWebhookSecret(request) {
  if (!telegramWebhookSecret) return false;
  const received = request.headers["x-telegram-bot-api-secret-token"];
  if (typeof received !== "string" || received.length !== telegramWebhookSecret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(telegramWebhookSecret));
}

function analyticsPeriodSummary(days) {
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - index);
    return date.toISOString().slice(0, 10);
  });
  const visitors = new Set();
  const summary = { views: 0, newVisitors: 0, returningVisitors: 0, testStarts: 0, testsCompleted: 0, questionsAnswered: 0 };
  for (const date of dates) {
    const daily = analyticsDay(date);
    summary.views += daily.views || 0;
    summary.newVisitors += daily.newVisitors || 0;
    summary.returningVisitors += daily.returningVisitors || 0;
    summary.testStarts += daily.testStarts || 0;
    summary.testsCompleted += daily.testsCompleted || 0;
    summary.questionsAnswered += daily.questionsAnswered || 0;
    for (const visitorId of daily.visitors || []) visitors.add(visitorId);
  }
  return { ...summary, uniqueVisitors: visitors.size };
}

function formatAnalyticsSummary(title, summary) {
  return [
    `Статистика Roadwise: ${title}`,
    `Відвідування: ${summary.views}`,
    `Унікальні відвідувачі: ${summary.uniqueVisitors}`,
    `Нові користувачі: ${summary.newVisitors}`,
    `Повторні відвідування: ${summary.returningVisitors}`,
    `Почато тестів: ${summary.testStarts}`,
    `Завершено тестів: ${summary.testsCompleted}`,
    `Відповідей у завершених тестах: ${summary.questionsAnswered}`
  ].join("\n");
}

function telegramCommandReply(command) {
  if (command === "/today") return formatAnalyticsSummary("сьогодні (UTC)", analyticsPeriodSummary(1));
  if (command === "/week") return formatAnalyticsSummary("останні 7 днів (UTC)", analyticsPeriodSummary(7));
  if (command === "/visits") {
    return formatAnalyticsSummary("за весь час", {
      views: analytics.totalPageViews,
      uniqueVisitors: analytics.totalUniqueVisitors,
      newVisitors: analytics.totalUniqueVisitors,
      returningVisitors: analytics.totalReturningVisitors,
      testStarts: analytics.totalTestStarts,
      testsCompleted: analytics.totalTestsCompleted,
      questionsAnswered: analytics.totalQuestionsAnswered
    });
  }
  return "Команди статистики:\n/today - сьогодні\n/week - останні 7 днів\n/visits - за весь час";
}

async function sendTelegramMessage(chatId, text) {
  const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) })
  });
  if (!telegramResponse.ok) throw new Error(`Telegram API: ${await telegramResponse.text()}`);
}

async function notifyTargetedSurveyTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Survey notification skipped: Telegram is not configured");
    return;
  }
  if (!allowTargetedSurveyTelegram()) return;
  try {
    await sendTelegramMessage(TELEGRAM_CHAT_ID, text);
  } catch (error) {
    console.error("Survey Telegram notification failed:", errorDetails(error));
  }
}

async function handleTelegramWebhook(request, response) {
  if (!isValidTelegramWebhookSecret(request)) {
    response.writeHead(401);
    response.end();
    return;
  }
  try {
    const update = JSON.parse(await readBody(request));
    const message = update?.message;
    const chatId = message?.chat?.id;
    const command = message?.text?.trim().split(/\s+/, 1)[0]?.replace(/@[^\s]+$/, "").toLowerCase();
    if (chatId !== undefined && String(chatId) === String(TELEGRAM_CHAT_ID) && command?.startsWith("/")) {
      await sendTelegramMessage(chatId, telegramCommandReply(command));
    }
    sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", errorDetails(error));
    sendJson(response, 400, { ok: false });
  }
}

async function configureTelegramWebhook() {
  if (!TELEGRAM_BOT_TOKEN || !telegramWebhookUrl || !telegramWebhookSecret) return;
  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: telegramWebhookUrl, secret_token: telegramWebhookSecret, allowed_updates: ["message"] })
    });
    if (!telegramResponse.ok) throw new Error(await telegramResponse.text());
    console.log("Telegram webhook configured");
  } catch (error) {
    console.error("Telegram webhook configuration failed:", errorDetails(error));
  }
}

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
    const visitorId = getVisitorId(request);
    const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: telegramText({ ...payload, message: payload.message.trim(), visitorId }).slice(0, 4000) })
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

async function reportVisitorThanksReaction(request, response) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    sendJson(response, 503, { error: "Telegram ще не налаштований на сервері" });
    return;
  }
  const visitorId = getVisitorId(request);
  if (visitorId !== thankedVisitorId) {
    sendJson(response, 403, { error: "Недоступно" });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(request));
    const action = payload?.action === "please" ? "Будь ласка" : payload?.action === "close" ? "Закрито" : null;
    if (!action) {
      sendJson(response, 400, { error: "Некоректна реакція" });
      return;
    }
    pruneRateLimitStore(telegramRateLimit, telegramRateLimitWindowMs);
    const telegramLimit = consumeRateLimit(telegramRateLimit, "global", telegramRateLimitMax, telegramRateLimitWindowMs);
    if (!telegramLimit.allowed) {
      rejectRateLimitedRequest(response, telegramLimit.retryAfter);
      return;
    }
    await sendTelegramMessage(TELEGRAM_CHAT_ID, `Реакція відвідувача на подяку: ${action}\nВідвідувач: ${visitorId}`);
    response.setHeader("Set-Cookie", `${visitorThanksReactionCookieName}=1; Max-Age=31536000; Path=/; SameSite=Lax; HttpOnly`);
    sendJson(response, 204, null);
  } catch (error) {
    sendJson(response, error.message === "Повідомлення завелике" ? 413 : 502, { error: "Не вдалося надіслати реакцію" });
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
    const visitorId = getVisitorId(request);
    const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: feedbackText({ message, contact, visitorId }).slice(0, 4000) })
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

function isTargetedSurveyEligible(visitorId, visitor) {
  const activeDays = Object.values(analytics.daily).filter((day) => day.visitors?.includes(visitorId)).length;
  return visitor.testsCompleted >= 12 || activeDays >= 3;
}

function targetedSurveyTestRequest(request) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.searchParams.get("survey-test") !== "1") return { requested: false };
  const localHosts = new Set(["localhost", "127.0.0.1"]);
  let hostIsLocal = false;
  let originIsLocal = !request.headers.origin;
  try {
    hostIsLocal = localHosts.has(new URL(`http://${request.headers.host}`).hostname);
    if (request.headers.origin) originIsLocal = localHosts.has(new URL(request.headers.origin).hostname);
  } catch { }
  const sessionId = url.searchParams.get("session") || "";
  const validSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId);
  return { requested: true, allowed: hostIsLocal && originIsLocal && validSessionId, sessionId };
}

async function getTargetedFeedbackPrompt(request, response) {
  const visitorId = getVisitorId(request);
  setVisitorCookie(response, visitorId);
  const testRequest = targetedSurveyTestRequest(request);
  if (testRequest.requested && !testRequest.allowed) {
    sendJson(response, 403, { error: "Тестовий режим доступний лише локально" });
    return;
  }
  if (excludedAnalyticsVisitors.has(visitorId) && !testRequest.requested) {
    sendJson(response, 200, { show: false });
    return;
  }
  const now = new Date().toISOString();
  const visitor = visitorRecord(visitorId, now);
  let survey = visitor.feedbackSurvey;
  let surveyChanged = false;
  if (testRequest.requested && survey.testSessionId !== testRequest.sessionId) {
    survey = {
      status: "in_progress",
      answers: [],
      version: targetedSurveyVersion,
      testSessionId: testRequest.sessionId
    };
    visitor.feedbackSurvey = survey;
    surveyChanged = true;
  }
  if (survey.status === "in_progress" && survey.version !== targetedSurveyVersion) {
    survey.answers = [];
    survey.version = targetedSurveyVersion;
    surveyChanged = true;
  }
  if (survey.status === "not_started" && isTargetedSurveyEligible(visitorId, visitor)) {
    survey.status = "in_progress";
    survey.version = targetedSurveyVersion;
    surveyChanged = true;
  }
  const shouldNotifyShown = survey.status === "in_progress" && !survey.shownNotifiedAt;
  if (shouldNotifyShown) {
    survey.shownNotifiedAt = now;
    surveyChanged = true;
  }
  if (surveyChanged) {
    visitor.lastSeen = now;
    analytics.visitors[visitorId] = visitor;
    await saveAnalytics();
  }
  if (shouldNotifyShown) {
    await notifyTargetedSurveyTelegram([
      "👀 Користувач побачив запрошення до опитування Roadwise",
      `Тестів завершено: ${visitor.testsCompleted || 0}`,
      `Відповідей: ${survey.answers.length} із ${targetedSurveyQuestions.length}`,
      `Відвідувач: ${visitorId}`
    ].join("\n\n"));
  }
  sendJson(response, 200, {
    show: survey.status === "in_progress",
    questionIndex: survey.answers.length
  });
}

async function submitTargetedFeedback(request, response) {
  const visitorId = getVisitorId(request);
  const testRequest = targetedSurveyTestRequest(request);
  try {
    const payload = JSON.parse(await readBody(request));
    const questionIndex = Number.isInteger(payload.questionIndex) ? payload.questionIndex : -1;
    const question = targetedSurveyQuestions[questionIndex];
    const answer = typeof payload.answer === "string" ? payload.answer.trim().slice(0, 1000) : "";
    if (testRequest.requested && !testRequest.allowed) {
      sendJson(response, 403, { error: "Тестовий режим доступний лише локально" });
      return;
    }
    const visitor = analytics.visitors[visitorId];
    const survey = visitor?.feedbackSurvey;
    if (!question || !answer || survey?.status !== "in_progress" || survey.version !== targetedSurveyVersion || (testRequest.requested && survey.testSessionId !== testRequest.sessionId) || questionIndex !== survey.answers.length) {
      sendJson(response, 400, { error: "Некоректна або вже надіслана відповідь" });
      return;
    }
    if (question.options && !question.options.includes(answer) && !(question.other && answer.startsWith("Інше: ") && answer.slice(7).trim())) {
      sendJson(response, 400, { error: "Оберіть відповідь зі списку" });
      return;
    }
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      sendJson(response, 503, { error: "Telegram ще не налаштований на сервері" });
      return;
    }
    if (!allowTargetedSurveyTelegram(response)) return;
    const telegramText = [
      `📝 Опитування Roadwise: ${questionIndex + 1}/${targetedSurveyQuestions.length}`,
      `Питання: ${question.title}`,
      `Відповідь: ${answer}`,
      `Відвідувач: ${visitorId}`
    ].join("\n\n");
    await sendTelegramMessage(TELEGRAM_CHAT_ID, telegramText);
    survey.answers.push(answer);
    if (survey.answers.length === targetedSurveyQuestions.length) survey.status = "complete";
    visitor.lastSeen = new Date().toISOString();
    analytics.visitors[visitorId] = visitor;
    await saveAnalytics();
    sendJson(response, 200, { ok: true, complete: survey.status === "complete", questionIndex: survey.answers.length });
  } catch (error) {
    const status = error.message === "Повідомлення завелике" ? 413 : error instanceof SyntaxError ? 400 : 502;
    sendJson(response, status, { error: error.message || "Не вдалося надіслати пропозицію" });
  }
}

async function dismissTargetedFeedback(request, response) {
  const visitorId = getVisitorId(request);
  const testRequest = targetedSurveyTestRequest(request);
  if (testRequest.requested) {
    if (!testRequest.allowed) {
      sendJson(response, 403, { error: "Тестовий режим доступний лише локально" });
      return;
    }
  }
  const visitor = analytics.visitors[visitorId];
  const survey = visitor?.feedbackSurvey;
  if (survey?.status === "in_progress" && !survey.closedNotifiedAt && (!testRequest.requested || survey.testSessionId === testRequest.sessionId)) {
    survey.status = "dismissed";
    survey.closedNotifiedAt = new Date().toISOString();
    await saveAnalytics();
    await notifyTargetedSurveyTelegram([
      "✖️ Користувач закрив незавершене опитування Roadwise",
      `Відповідей до закриття: ${survey.answers.length} із ${targetedSurveyQuestions.length}`,
      `Відвідувач: ${visitorId}`
    ].join("\n\n"));
  }
  sendJson(response, 204, null);
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
  let filePath = path.resolve(root, relativePath);
  if (
    relativePath === "questions.by-topic/index.json" &&
    !fs.existsSync(filePath)
  ) {
    filePath = path.join(questionsDir, "index.json");
  }
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404); response.end("Not found"); return;
  }
  const visitorId = getVisitorId(request);
  setVisitorCookie(response, visitorId);
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0"
  });
  if (path.basename(filePath) === "index.html") {
    const html = fs.readFileSync(filePath, "utf8");
    const hasThanksReaction = parseCookies(request)[visitorThanksReactionCookieName] === "1";
    const personalizedHtml = visitorId === thankedVisitorId && !hasThanksReaction
      ? html.replace('class="visitor-thanks hidden"', 'class="visitor-thanks"')
      : html;
    response.end(personalizedHtml);
    return;
  }
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
  if (request.method === "OPTIONS" && (requestPath === "/api/report-question" || requestPath === "/api/feedback" || requestPath === "/api/analytics/event" || requestPath === "/api/visitor-thanks" || requestPath === "/api/targeted-feedback" || requestPath === "/api/targeted-feedback-dismiss")) {
    response.writeHead(204, response.corsHeaders);
    response.end();
    return;
  }
  if (request.method === "GET" && requestPath === "/api/questions/random") {
    handleRandomQuestions(request, response);
    return;
  }
  if (request.method === "GET" && requestPath === "/api/targeted-feedback-prompt") {
    getTargetedFeedbackPrompt(request, response);
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
  if (request.method === "POST" && requestPath === "/api/telegram/webhook") {
    handleTelegramWebhook(request, response);
  } else if (request.method === "POST" && requestPath === "/api/report-question") {
    if (allowReport(request, response)) reportQuestion(request, response);
  } else if (request.method === "POST" && requestPath === "/api/feedback") {
    if (allowReport(request, response)) submitFeedback(request, response);
  } else if (request.method === "POST" && requestPath === "/api/targeted-feedback") {
    if (allowTargetedSurveyRequest(request, response)) submitTargetedFeedback(request, response);
  } else if (request.method === "POST" && requestPath === "/api/targeted-feedback-dismiss") {
    if (allowTargetedSurveyRequest(request, response)) dismissTargetedFeedback(request, response);
  } else if (request.method === "POST" && requestPath === "/api/client-error") {
    reportClientError(request, response);
  } else if (request.method === "POST" && requestPath === "/api/visitor-thanks") {
    reportVisitorThanksReaction(request, response);
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
  const isBenignClientDisconnect = ["ECONNRESET", "EPIPE", "HPE_INVALID_METHOD", "HPE_INVALID_URL", "HPE_HEADER_OVERFLOW"].includes(error.code);
  if (!isBenignClientDisconnect) {
    reportCriticalError(new Error(clientError), "http-client");
  }
  if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", errorDetails(error));
  reportCriticalError(error, "uncaught-exception");
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", errorDetails(error));
  reportCriticalError(error, "unhandled-rejection");
});

server.listen(port, () => {
  console.log(`Roadwise server: http://localhost:${port}; analytics: ${analyticsPath}`);
  configureTelegramWebhook();
});
