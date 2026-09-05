const state = { questions: [], currentTest: [], currentIndex: 0, selectedAnswer: null, mode: "random", topic: null, lastResult: null, errors: JSON.parse(localStorage.getItem("roadwise-errors") || "[]"), history: JSON.parse(localStorage.getItem("roadwise-history") || "[]") };
const $ = (selector) => document.querySelector(selector);
const shuffle = (items) => [...items].sort(() => Math.random() - 0.5);

async function loadQuestions() {
  const response = await fetch("questions.json");
  state.questions = await response.json();
  renderHome();
}

function topics() { return [...new Set(state.questions.map((question) => question.topic))]; }
function saveProgress() { localStorage.setItem("roadwise-errors", JSON.stringify(state.errors)); localStorage.setItem("roadwise-history", JSON.stringify(state.history)); }

function renderHome() {
  const topicList = $("#topic-list");
  const counts = Object.fromEntries(topics().map((topic) => [topic, state.questions.filter((question) => question.topic === topic).length]));
  $("#question-count").textContent = state.questions.length;
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
}

function startTest(mode = "random", topic = null) {
  state.mode = mode; state.topic = topic; state.currentIndex = 0; state.selectedAnswer = null;
  if (mode === "topic" && !topic) {
    $("#test-mode-label").textContent = "Обери тему";
    $("#topic-picker").classList.remove("hidden");
    $("#question-layout").classList.add("hidden");
    renderTopicPicker();
    showView("test");
    return;
  }
  let pool = mode === "mistakes" ? state.questions.filter((question) => state.errors.includes(question.id)) : topic ? state.questions.filter((question) => question.topic === topic) : state.questions;
  state.currentTest = shuffle(pool).slice(0, Math.min(20, pool.length));
  state.currentTest.forEach((question) => { delete question.userAnswer; });
  if (!state.currentTest.length) { alert("Тут поки немає питань. Спочатку пройди звичайний тест."); return; }
  $("#test-mode-label").textContent = mode === "mistakes" ? "Мої помилки" : topic ? topic : "Випадковий тест";
  $("#topic-picker").classList.add("hidden");
  $("#question-layout").classList.remove("hidden");
  showView("test"); renderQuestion();
}

function renderTopicPicker() {
  $("#topic-picker").innerHTML = `<p class="topic-picker-title">Питання з якої теми тренуємо?</p>${topics().map((topic) => `<button type="button" class="${topic === state.topic ? "is-selected" : ""}" data-topic="${topic}">${topic}<span>${state.questions.filter((question) => question.topic === topic).length}</span></button>`).join("")}`;
  $("#topic-picker").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => startTest("topic", button.dataset.topic)));
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
    answersList: $("#answers-list"),
    nextButton: $("#next-button")
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
  elements.answersList.innerHTML = question.answers.map((answer, index) => {
    const answerState = question.userAnswer === index ? question.userAnswer === question.correctAnswer ? "selected answer-correct" : "selected answer-wrong" : "";
    return `<button class="answer-option ${answerState}" type="button" data-answer="${index}"><span class="answer-letter">${String.fromCharCode(65 + index)}</span><span>${answer}</span></button>`;
  }).join("");
  elements.nextButton.disabled = question.userAnswer === undefined;
  elements.nextButton.innerHTML = state.currentIndex === state.currentTest.length - 1 ? "Завершити тест <span>✓</span>" : "Наступне питання <span>→</span>";
  elements.questionNav.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { state.currentIndex = Number(button.dataset.questionIndex); renderQuestion(); }));
  elements.answersList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    const answer = Number(button.dataset.answer);
    question.userAnswer = answer;
    state.selectedAnswer = answer;
    elements.answersList.querySelectorAll("button").forEach((item) => item.classList.remove("selected", "answer-correct", "answer-wrong"));
    button.classList.add("selected", answer === question.correctAnswer ? "answer-correct" : "answer-wrong");
    elements.nextButton.disabled = false;
    renderQuestionNav();
  }));
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
  state.history.push({ percent, date: new Date().toISOString() }); saveProgress(); renderResults(); showView("results");
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
  loadQuestions().catch((error) => { console.error(error); $("#question-title").textContent = "Не вдалося завантажити questions.json"; });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();