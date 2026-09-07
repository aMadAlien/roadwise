// Leave empty to make every loaded topic available. Use topic file IDs such as "01", "08-1", or "10".
const AVAILABLE_TOPICS = [
  "01-zahalni-polozhennya",
  "02-obov-yazky-i-prava-vodiyiv-mekhanichnykh-transportnykh-zasobiv",
  "03-rukh-transportnykh-zasobiv-iz-spetsialnymy-syhnalamy",
  "04-obov-yazky-i-prava-pishokhodiv",
  "05-obov-yazky-i-prava-pasazhyriv",
  "06-vymohy-do-velosypedystiv",
  "07-vymohy-do-osib-yaki-keruyut-huzhovym-transportom-i-pohonychiv-tvaryn",
  "08-1-rehulyuvannya-dorozhnoho-rukhu-rehulovani-perekhrestya",
  "09-2-rehulyuvannya-dorozhnoho-rukhu-nerehulovani-perekhrestya",
  "10-poperedzhuvalni-syhnaly",
  "11-pochatok-rukhu-ta-zmina-yoho-napryamku",
  "12-roztashuvannya-transportnykh-zasobiv-na-dorozi",
  "13-shvydkist-rukhu",
  "14-dystantsiya-interval-zustrichnyy-roz-yizd",

  "17-1-proyizd-perekhrest-rehulovani-perekhrestya",

  "19-perevahy-marshrutnykh-transportnykh-zasobiv",
  "20-proyizd-pishokhidnykh-perekhodiv-i-zupynok-transportnykh-zasobiv",

  "23-perevezennya-pasazhyriv",
  "24-perevezennya-vantazhu",
  "25-buksyruvannya-ta-ekspluatatsiya-transportnykh-sostaviv",
  "26-navchalna-yizda",
  "27-rukh-transportnykh-zasobiv-u-kolonakh",

  "29-rukh-po-avtomahistralyakh",
  "30-rukh-po-hirskykh-dorohakh-i-na-krutykh-spuskakh",
  "31-mizhnarodnyy-rukh",
];
const state = { questions: [], topicCatalog: [], topicIds: {}, topicCache: new Map(), currentTest: [], currentIndex: 0, selectedAnswer: null, mode: "random", topic: null, lastResult: null, errors: JSON.parse(localStorage.getItem("roadwise-errors") || "[]"), history: JSON.parse(localStorage.getItem("roadwise-history") || "[]") };
const $ = (selector) => document.querySelector(selector);
const shuffle = (items) => [...items].sort(() => Math.random() - 0.5);
let lastClientErrorAt = 0;

function showAppError(message, retry = null) {
  const status = $("#app-status");
  $("#app-status-message").textContent = message;
  $("#app-status-retry").classList.toggle("hidden", !retry);
  status.classList.remove("hidden");
  status.dataset.retry = retry ? "available" : "none";
  state.retryAction = retry;
}

function clearAppError() {
  $("#app-status").classList.add("hidden");
  state.retryAction = null;
}

function reportClientError(error) {
  if (Date.now() - lastClientErrorAt < 30_000) return;
  lastClientErrorAt = Date.now();
  const payload = { message: error?.message || String(error), stack: error?.stack || "", url: window.location.href };
  fetch("api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => { });
}
function trackAnalyticsEvent(event, details = {}) {
  fetch("api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, ...details }),
    keepalive: true
  }).catch(() => { });
}

trackAnalyticsEvent("page_view", { mode: "none", topic: "all", total: 0 });

async function loadQuestions() {
  clearAppError();
  const indexResponse = await fetch("questions.by-topic/index.json");
  if (!indexResponse.ok) throw new Error(`Не вдалося завантажити індекс тем: ${indexResponse.status}`);

  state.topicCatalog = await indexResponse.json();
  state.topicIds = Object.fromEntries(state.topicCatalog.map((topic) => [topic.topic, topic.file.replace(/\.json$/, "")]));
  renderHome();
}

function topics() { return state.topicCatalog.map((topic) => topic.topic); }
function topicId(topic) { return state.topicIds[topic]; }
function isTopicAvailable(topic) { return AVAILABLE_TOPICS.length === 0 || AVAILABLE_TOPICS.includes(topicId(topic)); }
function availableTopicCatalog() { return state.topicCatalog.filter((topic) => isTopicAvailable(topic.topic)); }
function topicEntry(topic) { return state.topicCatalog.find((item) => item.topic === topic); }

async function loadTopicQuestions(topicEntry) {
  if (state.topicCache.has(topicEntry.file)) return state.topicCache.get(topicEntry.file);
  const response = await fetch(`questions.by-topic/${encodeURIComponent(topicEntry.file)}`);
  if (!response.ok) throw new Error(`Не вдалося завантажити файл теми: ${response.status}`);
  const questions = await response.json();
  state.topicCache.set(topicEntry.file, questions);
  return questions;
}

async function loadQuestionsForTopics(topicEntries) {
  const questionGroups = await Promise.all(topicEntries.map((entry) => loadTopicQuestions(entry)));
  return questionGroups.flat();
}
function saveProgress() { localStorage.setItem("roadwise-errors", JSON.stringify(state.errors)); localStorage.setItem("roadwise-history", JSON.stringify(state.history)); }

function renderHome() {
  const topicList = $("#topic-list");
  const counts = Object.fromEntries(state.topicCatalog.map((topic) => [topic.topic, topic.count]));
  $("#question-count").textContent = availableTopicCatalog().reduce((total, topic) => total + topic.count, 0);
  $("#topic-count").textContent = `${topics().length} тем`;
  $("#tests-count").textContent = state.history.length;
  const average = state.history.length ? Math.round(state.history.reduce((sum, item) => sum + item.percent, 0) / state.history.length) : null;
  $("#average-score").textContent = average === null ? "—" : `${average}%`;
  $("#mistakes-description").textContent = state.errors.length ? `${state.errors.length} питань для повторення` : "Поки що помилок немає";
  $("#streak-count").textContent = state.history.length ? "1" : "0";
  topicList.innerHTML = topics().map((topic) => `<div class="topic-row"><span class="topic-bullet"></span><span class="topic-name">${topic}</span><span class="topic-questions">${counts[topic]} питань</span></div>`).join("");
}

function showView(viewName) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-visible", view.id === `${viewName}-view`));
  document.querySelectorAll("[data-view]").forEach((link) => link.classList.toggle("is-active", link.dataset.view === viewName));
  if (viewName === "home" && state.topicCatalog.length) renderHome();
}

async function startTest(mode = "random", topic = null) {
  state.mode = mode; state.topic = topic; state.currentIndex = 0; state.selectedAnswer = null;
  if (mode === "topic" && topic && !isTopicAvailable(topic)) return;
  if (mode === "topic" && !topic) {
    $("#test-mode-label").textContent = "Обери тему";
    $("#question-nav").classList.add("hidden");
    $(".progress-track").classList.add("hidden");
    $(".test-progress-label").classList.add("hidden");
    $("#topic-picker").classList.remove("hidden");
    $("#question-layout").classList.add("hidden");
    renderTopicPicker();
    showView("test");
    return;
  }
  const topicEntries = topic ? [topicEntry(topic)] : availableTopicCatalog();
  try {
    state.questions = await loadQuestionsForTopics(topicEntries.filter(Boolean));
  } catch (error) {
    reportClientError(error);
    showAppError("Не вдалося завантажити питання. Перевір з'єднання та спробуй ще раз.", () => startTest(mode, topic));
    return;
  }
  let pool = mode === "mistakes" ? state.questions.filter((question) => state.errors.includes(question.id)) : topic ? state.questions.filter((question) => question.topic === topic) : state.questions;
  const testSize = mode === "topic" ? pool.length : Math.min(20, pool.length);
  state.currentTest = shuffle(pool).slice(0, testSize);
  state.currentTest.forEach((question) => { delete question.userAnswer; delete question.showCorrectAnswer; });
  if (!state.currentTest.length) { showAppError("Тут поки немає питань для цього режиму."); return; }
  $("#test-mode-label").textContent = mode === "mistakes" ? "Мої помилки" : topic ? '' : "Випадковий тест";
  $(".question-nav").classList.remove("hidden");
  $(".progress-track").classList.remove("hidden");
  $(".test-progress-label").classList.remove("hidden");
  $("#topic-picker").classList.add("hidden");
  $("#question-layout").classList.remove("hidden");
  trackAnalyticsEvent("test_started", { mode, topic: topic || "all", total: testSize });
  showView("test"); renderQuestion();
}

function renderTopicPicker() {
  $("#topic-picker").innerHTML = `<p class="topic-picker-title">Питання з якої теми тренуємо?</p>${topics().map((topic) => {
    const available = isTopicAvailable(topic);
    const topicMeta = available ? `${topicEntry(topic).count} питань` : "🔒 У розробці";
    const developmentNote = available ? "" : "<small>Ми вже працюємо над цією темою.</small>";
    return `<button type="button" class="${topic === state.topic ? "is-selected" : ""} ${available ? "" : "is-unavailable"}" data-topic="${topic}" ${available ? "" : "disabled"}><span class="topic-picker-name">${topic}${developmentNote}</span><span style="flex-shrink: 0;">${topicMeta}</span></button>`;
  }).join("")}`;
  $("#topic-picker").querySelectorAll("button:not(:disabled)").forEach((button) => button.addEventListener("click", () => startTest("topic", button.dataset.topic)));
}

function renderQuestion() {
  const question = state.currentTest[state.currentIndex];
  state.selectedAnswer = null;
  const elements = {
    progressBar: $("#progress-bar"),
    questionNav: $("#question-nav"),
    progressLabel: $(".test-progress-label"),
    questionTopic: $("#question-topic"),
    questionId: $("#question-id"),
    questionTitle: $("#question-title"),
    questionImageWrapper: $("#question-image-wrapper"),
    questionImage: $("#question-image"),
    answersList: $("#answers-list"),
    showCorrectButton: $("#show-correct-button"),
    nextButton: $("#next-button"),
    reportButton: $("#report-button")
  };
  const missingElement = Object.entries(elements).find(([, element]) => !element);
  if (missingElement) throw new Error(`renderQuestion: не знайдено елемент ${missingElement[0]} у index.html`);

  elements.progressBar.style.width = `${((state.currentIndex + 1) / state.currentTest.length) * 100}%`;
  elements.progressLabel.innerHTML = `<span>${state.currentIndex + 1}</span> / ${state.currentTest.length}`;
  elements.questionNav.innerHTML = state.currentTest.map((item, index) => {
    const status = item.userAnswer === undefined ? "" : item.userAnswer === item.correctAnswer ? "correct" : "wrong";
    return `<button type="button" class="question-nav-item ${status} ${index === state.currentIndex ? "active" : ""}" data-question-index="${index}" aria-label="Питання ${index + 1}">${index + 1}</button>`;
  }).join("");
  elements.questionTopic.textContent = question.topic;
  elements.questionId.textContent = question.id;
  elements.questionTitle.textContent = question.question;
  elements.questionImageWrapper.classList.toggle("hidden", !question.image);
  if (question.image) {
    elements.questionImage.src = question.image;
    elements.questionImage.alt = `Ілюстрація до питання ${question.id}`;
  } else {
    elements.questionImage.removeAttribute("src");
  }
  elements.reportButton.dataset.questionId = question.id;
  elements.answersList.innerHTML = question.answers.map((answer, index) => {
    const isSelected = question.userAnswer === index;
    const isCorrectAnswerRevealed = question.showCorrectAnswer && index === question.correctAnswer;
    const answerState = isSelected ? question.userAnswer === question.correctAnswer ? "selected answer-correct" : "selected answer-wrong" : isCorrectAnswerRevealed ? "answer-correct answer-revealed" : "";
    const answered = question.userAnswer !== undefined;
    return `<button class="answer-option ${answerState}" type="button" data-answer="${index}" ${answered ? "disabled" : ""} aria-pressed="${isSelected}"><span class="answer-letter">${String.fromCharCode(65 + index)}</span><span>${answer}</span></button>`;
  }).join("");
  const answeredIncorrectly = question.userAnswer !== undefined && question.userAnswer !== question.correctAnswer;
  elements.showCorrectButton.classList.toggle("hidden", !answeredIncorrectly || question.showCorrectAnswer);
  elements.nextButton.disabled = question.userAnswer === undefined;
  elements.nextButton.innerHTML = state.currentIndex === state.currentTest.length - 1 ? "Завершити тест <span>✓</span>" : "Наступне питання <span>→</span>";
  elements.questionNav.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { state.currentIndex = Number(button.dataset.questionIndex); renderQuestion(); }));
  elements.answersList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    if (question.userAnswer !== undefined) return;
    const answer = Number(button.dataset.answer);
    question.userAnswer = answer;
    state.selectedAnswer = answer;
    elements.answersList.querySelectorAll("button").forEach((item) => item.classList.remove("selected", "answer-correct", "answer-wrong"));
    button.classList.add("selected", answer === question.correctAnswer ? "answer-correct" : "answer-wrong");
    elements.nextButton.disabled = false;
    elements.showCorrectButton.classList.toggle("hidden", answer === question.correctAnswer);
    renderQuestionNav();
  }));
  elements.showCorrectButton.onclick = () => {
    if (question.userAnswer === undefined || question.userAnswer === question.correctAnswer) return;
    question.showCorrectAnswer = true;
    renderQuestion();
  };
}

function openReportModal() {
  const question = state.currentTest[state.currentIndex];
  $("#report-question").textContent = `${question.id}: ${question.question}`;
  $("#report-message").value = "";
  $("#report-status").textContent = "";
  $("#report-status").className = "report-status";
  $("#report-modal").classList.remove("hidden");
  $("#report-message").focus();
}

function closeReportModal() { $("#report-modal").classList.add("hidden"); }

async function submitReport(event) {
  event.preventDefault();
  const question = state.currentTest[state.currentIndex];
  const message = $("#report-message").value.trim();
  const submitButton = $("#report-submit");
  const status = $("#report-status");
  if (!message) return;
  submitButton.disabled = true;
  status.textContent = "Надсилаємо...";
  status.className = "report-status";
  try {
    const response = await fetch("api/report-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, question: { id: question.id, topic: question.topic, text: question.question, selectedAnswer: question.userAnswer === undefined ? null : question.answers[question.userAnswer] } })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не вдалося надіслати повідомлення");
    status.textContent = "Дякуємо! Повідомлення надіслано.";
    status.className = "report-status is-success";
    setTimeout(closeReportModal, 1200);
  } catch (error) {
    status.textContent = error.message;
    status.className = "report-status is-error";
  } finally { submitButton.disabled = false; }
}

async function submitFeedback(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#feedback-message").value.trim();
  const contact = $("#feedback-contact").value.trim();
  const submitButton = $("#feedback-submit");
  const status = $("#feedback-status");
  if (!message) return;
  submitButton.disabled = true;
  status.textContent = "Надсилаємо...";
  status.className = "report-status";
  try {
    const response = await fetch("api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, contact })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не вдалося надіслати повідомлення");
    form.reset();
    status.textContent = "Дякуємо! Повідомлення надіслано. Ми зв’яжемося з вами якнайшвидше.";
    status.className = "report-status is-success";
  } catch (error) {
    status.textContent = error.message;
    status.className = "report-status is-error";
  } finally {
    submitButton.disabled = false;
  }
}

function renderQuestionNav() {
  const questionNav = $("#question-nav");
  questionNav.querySelectorAll("button").forEach((button, index) => {
    const question = state.currentTest[index];
    button.className = `question-nav-item ${question.userAnswer === undefined ? "" : question.userAnswer === question.correctAnswer ? "correct" : "wrong"} ${index === state.currentIndex ? "active" : ""}`;
  });
}

function finishTest() {
  const answers = state.currentTest.map((question) => question.userAnswer);
  const correct = answers.filter((answer, index) => answer === state.currentTest[index].correctAnswer).length;
  const wrongQuestions = state.currentTest.filter((question) => question.userAnswer !== question.correctAnswer);
  wrongQuestions.forEach((question) => { if (!state.errors.includes(question.id)) state.errors.push(question.id); });
  const percent = Math.round((correct / state.currentTest.length) * 100);
  state.lastResult = { correct, total: state.currentTest.length, percent, wrongQuestions };
  state.history.push({ percent, date: new Date().toISOString() });
  trackAnalyticsEvent("test_completed", { mode: state.mode, topic: state.topic || "all", total: state.currentTest.length, correct });
  saveProgress();
  renderHome();
  renderResults();
  showView("results");
}

function renderResults() {
  const result = state.lastResult; $("#result-percent").textContent = `${result.percent}%`; $("#correct-count").textContent = result.correct; $("#wrong-count").textContent = result.total - result.correct; $("#result-total").textContent = result.total;
  $("#results-title").textContent = result.percent >= 80 ? "Відмінний результат." : result.percent >= 50 ? "Гарний старт." : "Є над чим попрацювати.";
  $("#results-subtitle").textContent = `Правильних відповідей: ${result.correct} з ${result.total}. Результат збережено локально.`;
  $("#mistakes-preview").innerHTML = result.wrongQuestions.length ? `<p class="eyebrow">Питання для повторення</p>${result.wrongQuestions.map((question) => `<div class="mistake-item"><strong>${question.question}</strong><span>${question.topic}</span></div>`).join("")}` : `<p class="eyebrow">Без помилок</p><p>Усі відповіді правильні. Так тримати.</p>`;
}

function init() {
  document.addEventListener("click", (event) => { const modeButton = event.target.closest("[data-mode]"); if (modeButton) startTest(modeButton.dataset.mode); const viewLink = event.target.closest("[data-view]"); if (viewLink && !viewLink.dataset.mode) showView(viewLink.dataset.view); });
  $("#next-button").addEventListener("click", () => { if (state.currentIndex === state.currentTest.length - 1) finishTest(); else { state.currentIndex += 1; renderQuestion(); } });
  $("#retry-button").addEventListener("click", () => startTest(state.mode, state.topic));
  $("#report-button").addEventListener("click", openReportModal);
  $("#report-close").addEventListener("click", closeReportModal);
  $("#report-form").addEventListener("submit", submitReport);
  $("#feedback-form").addEventListener("submit", submitFeedback);
  $("#app-status-retry").addEventListener("click", () => {
    if (state.retryAction) state.retryAction();
    else loadQuestions().catch(handleInitialLoadError);
  });
  $("#report-modal").addEventListener("click", (event) => { if (event.target.id === "report-modal") closeReportModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeReportModal(); });
  window.addEventListener("error", (event) => reportClientError(event.error || new Error(event.message)));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason || new Error("Unhandled promise rejection")));
  loadQuestions().catch(handleInitialLoadError);
}

function handleInitialLoadError(error) {
  console.error(error);
  reportClientError(error);
  $("#question-title").textContent = "Питання тимчасово недоступні";
  showAppError("Не вдалося завантажити базу питань. Перевір з'єднання та спробуй ще раз.", loadQuestions);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();