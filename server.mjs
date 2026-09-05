import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const maxBodySize = 20_000;
const mimeTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png" };

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

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7867801663:AAElpy-upi5EUfLeX9-_GsusTegs6OE1iWo';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '741847718';

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
      console.error("Telegram API error:", await telegramResponse.text());
      sendJson(response, 502, { error: "Telegram не прийняв повідомлення" });
      return;
    }
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, error.message === "Повідомлення завелике" ? 413 : 400, { error: error.message || "Некоректний запит" });
  }
}

function serveStatic(request, response) {
  const requestedPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\//, "");
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404); response.end("Not found"); return;
  }
  response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  response.corsHeaders = corsHeaders(request);
  if (request.method === "OPTIONS" && request.url === "/api/report-question") {
    response.writeHead(204, response.corsHeaders);
    response.end();
    return;
  }
  if (request.method === "POST" && request.url === "/api/report-question") {
    reportQuestion(request, response);
  } else if (request.method === "GET") {
    serveStatic(request, response);
  } else {
    sendJson(response, 405, { error: "Method not allowed" });
  }
});

server.listen(port, () => console.log(`Roadwise server: http://localhost:${port}`));
