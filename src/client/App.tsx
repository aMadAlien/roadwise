import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AVAILABLE_TOPICS, RANDOM_TEST_CATEGORIES } from "../../available-topics.js";

type View = "home" | "topics" | "tickets" | "saved" | "errors" | "results" | "settings" | "feedback" | "quiz" | "result";
type AnswerMode = "check" | "instant" | "auto-correct";
type TestMode = "topic" | "random" | "mistakes" | "ticket" | "saved";
type RandomCategory = keyof typeof RANDOM_TEST_CATEGORIES;
type SurveyQuestion =
  | { title: string; type: "choice"; options: string[] }
  | { title: string; type: "choice-other"; options: string[] }
  | { title: string; type: "stars"; options: string[] }
  | { title: string; type: "slider" };

const targetedSurveyQuestions: SurveyQuestion[] = [
  { title: "З якою метою ти найчастіше заходиш на Roadwise?", type: "choice", options: ["Готуюся до теоретичного іспиту", "Вчу окремі теми", "Повторюю складні питання", "Тренуюсь для себе", "Все одразу"] },
  { title: "Який формат тренування використовуєш найчастіше?", type: "choice", options: ["За темами", "За білетами", "Випадковий іспит", "Мої помилки"] },
  { title: "Чого тобі найбільше бракує або що варто покращити?", type: "choice-other", options: ["Пояснень до відповідей", "Більше різних режимів тренування", "Зручнішого повторення помилок", "Можливості зберігати питання по категоріях", "Нічого, усе необхідне є"] },
  { title: "Наскільки вам зручно користуватися сайтом?", type: "stars", options: ["1", "2", "3", "4", "5"] },
  { title: "Наскільки ймовірно, що порадиш Roadwise друзям?", type: "slider" },
];

const isSurveyPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  new URLSearchParams(window.location.search).get("survey-test") === "1";
const surveyPreviewSession = isSurveyPreview ? crypto.randomUUID() : null;

interface TopicEntry {
  topic: string;
  file: string;
  count: number;
}

interface Question {
  id: string;
  topic: string;
  question: string;
  image: string | null;
  answers: string[];
  correctAnswer: number | null;
  source?: {
    file: string;
    page: number;
    number: number;
  } | null;
  savedAt?: string;
  userAnswer?: number;
  pendingAnswer?: number;
  showCorrectAnswer?: boolean;
}

interface HistoryEntry {
  percent: number;
  correct: number;
  total: number;
  passed: boolean;
  mode: string;
  topic: string | null;
  durationMs: number | null;
  date: string;
}

interface TopicProgress {
  status: "started" | "completed";
  mistakes?: number;
  percent?: number;
  completedAt?: string;
  lastOpenedAt?: string;
}

interface SavedTopicTest {
  mode: TestMode;
  topic: string | null;
  currentIndex: number;
  questions: Question[];
  category?: RandomCategory;
  startedAt?: number;
  ticket?: number;
}

interface TicketProgress {
  correct: number;
  mistakes: number;
  passed: boolean;
  completedAt: string;
}

const HISTORY_KEY = "roadwise-history";
const ERRORS_KEY = "roadwise-errors";
const TOPIC_PROGRESS_KEY = "roadwise-topic-progress";
const CURRENT_TEST_KEY = "roadwise-test-progress";
const ANSWER_MODE_KEY = "roadwise-answer-mode";
const SAVED_KEY = "roadwise-saved";
const TICKET_PROGRESS_KEY = "roadwise-ticket-progress";
const DAILY_TOPIC_TEST_LIMIT = 3;
const EXAM_PASS_PERCENT = 90;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch (error) {
    console.error(`Could not read local storage key "${key}".`, error);
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function getAnswerMode(): AnswerMode {
  const stored = localStorage.getItem(ANSWER_MODE_KEY);
  if (stored === "auto") return "auto-correct";
  return stored === "check" || stored === "auto-correct" ? stored : "instant";
}

function isTopicAvailable(topic: TopicEntry): boolean {
  const topicId = topic.file.replace(/\.json$/, "");
  return AVAILABLE_TOPICS.length === 0 || AVAILABLE_TOPICS.includes(topicId);
}

function getLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

let lastClientErrorAt = 0;

function reportClientError(error: Error | string) {
  if (Date.now() - lastClientErrorAt < 30_000) return;
  lastClientErrorAt = Date.now();
  const normalizedError = typeof error === "string" ? new Error(error) : error;
  void fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: normalizedError.message,
      stack: normalizedError.stack ?? "",
      url: window.location.href,
    }),
    keepalive: true,
  }).then((response) => {
    if (!response.ok) throw new Error(`Client error report failed (${response.status}).`);
  }).catch((reportingError: unknown) => {
    console.error("Could not report client error.", reportingError);
  });
}

function QuestionImage({ question, loading = "eager" }: { question: Question; loading?: "eager" | "lazy" }) {
  const [imageSrc, setImageSrc] = useState(question.image ?? "");
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    setImageSrc(question.image ?? "");
    setFailed(false);
    setRetried(false);
  }, [question.id, question.image]);

  if (!question.image) return null;

  return (
    <div className="client-question-image-frame">
      {!failed && (
        <img
          className="client-question-image"
          src={imageSrc}
          alt={`Ілюстрація до питання ${question.id}`}
          loading={loading}
          onError={() => {
            setFailed(true);
            if (retried) {
              reportClientError(`Зображення не завантажилось після повторної спроби: ${question.image} (питання ${question.id})`);
            }
          }}
        />
      )}
      {failed && (
        <div className="client-question-image-fallback" role="status">
          <p>{retried ? "Перепрошуємо, зображення тимчасово недоступне." : "Не вдалося завантажити зображення."}</p>
          {!retried && (
            <button
              className="client-secondary"
              type="button"
              onClick={() => {
                setRetried(true);
                setFailed(false);
                const separator = question.image?.includes("?") ? "&" : "?";
                setImageSrc(`${question.image}${separator}retry=${Date.now()}`);
              }}
            >
              Спробувати ще раз
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getTestLabel(test: SavedTopicTest): string {
  switch (test.mode) {
    case "topic":
      return `тест за темою «${test.topic}»`;
    case "random":
      return "випадковий іспит";
    case "ticket":
      return `білет ${test.ticket}`;
    case "saved":
      return "тест зі збережених питань";
    case "mistakes":
      return "тест за помилками";
  }
}

function isSavedTopicTest(value: unknown): value is SavedTopicTest {
  if (!value || typeof value !== "object") return false;
  const saved = value as Partial<SavedTopicTest>;
  return (
    (saved.mode === "topic" || saved.mode === "random" || saved.mode === "mistakes" || saved.mode === "ticket" || saved.mode === "saved") &&
    (saved.mode !== "topic" || typeof saved.topic === "string") &&
    (saved.mode !== "ticket" || Number.isInteger(saved.ticket)) &&
    Number.isInteger(saved.currentIndex) &&
    Array.isArray(saved.questions) &&
    saved.questions.length > 0 &&
    saved.questions.every(
      (question) =>
        question &&
        typeof question.id === "string" &&
        typeof question.question === "string" &&
        Array.isArray(question.answers),
    )
  );
}

function App() {
  const [view, setView] = useState<View>("home");
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readStorage(HISTORY_KEY, []));
  const [errors, setErrors] = useState<string[]>(() => readStorage(ERRORS_KEY, []));
  const [savedQuestions, setSavedQuestions] = useState<Question[]>(() => readStorage(SAVED_KEY, []));
  const [errorQuestions, setErrorQuestions] = useState<Question[]>([]);
  const [ticketProgress, setTicketProgress] = useState<Record<number, TicketProgress>>(() => readStorage(TICKET_PROGRESS_KEY, {}));
  const [topicProgress, setTopicProgress] = useState<Record<string, TopicProgress>>(() =>
    readStorage(TOPIC_PROGRESS_KEY, {}),
  );
  const [selectedTopic, setSelectedTopic] = useState<TopicEntry | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<number | null>(null);
  const [selectedMode, setSelectedMode] = useState<TestMode>("topic");
  const [randomCategory, setRandomCategory] = useState<RandomCategory | null>(null);
  const [tickets, setTickets] = useState<Question[][] | null>(null);
  const [expandedSavedId, setExpandedSavedId] = useState<string | null>(null);
  const [confirmClearSaved, setConfirmClearSaved] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackContact, setFeedbackContact] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [timerHidden, setTimerHidden] = useState(() => localStorage.getItem("roadwise-timer-hidden") === "1");
  const [shareStatus, setShareStatus] = useState("");
  const [shareSending, setShareSending] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingStatus, setRatingStatus] = useState("");
  const [ticketsIntroOpen, setTicketsIntroOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveyAvailable, setSurveyAvailable] = useState(false);
  const [promptsReady, setPromptsReady] = useState(false);
  const [surveyIndex, setSurveyIndex] = useState(0);
  const [surveyAnswer, setSurveyAnswer] = useState("");
  const [surveyOtherAnswer, setSurveyOtherAnswer] = useState("");
  const [surveyStatus, setSurveyStatus] = useState("");
  const [surveySending, setSurveySending] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [result, setResult] = useState<{ correct: number; total: number; passed: boolean; durationMs: number | null } | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingTopic, setLoadingTopic] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [answerMode, setAnswerMode] = useState(getAnswerMode);
  const [interruptedTest, setInterruptedTest] = useState<SavedTopicTest | null>(null);
  const [pendingTopic, setPendingTopic] = useState<TopicEntry | null>(null);
  const [pendingMode, setPendingMode] = useState<Exclude<TestMode, "topic"> | null>(null);
  const [pendingTicket, setPendingTicket] = useState<number | null>(null);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [categoryChoice, setCategoryChoice] = useState<RandomCategory | "">("");
  const [rememberCategory, setRememberCategory] = useState(false);
  const [examFailedPrompt, setExamFailedPrompt] = useState(false);
  const [examFailed, setExamFailed] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerNow, setTimerNow] = useState(Date.now);

  useEffect(() => {
    let active = true;
    fetch("/questions.by-topic/index.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Не вдалося завантажити теми (${response.status}).`);
        return response.json() as Promise<TopicEntry[]>;
      })
      .then((catalog) => {
        if (active) {
          setTopics(catalog);
          const saved = readStorage<unknown>(CURRENT_TEST_KEY, null);
          if (isSavedTopicTest(saved)) setInterruptedTest(saved);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          reportClientError(error instanceof Error ? error : String(error));
          setErrorMessage(error instanceof Error ? error.message : "Не вдалося завантажити теми.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const returningVisitor = localStorage.getItem("roadwise_visited") === "1";
    localStorage.setItem("roadwise_visited", "1");
    const introTimeout = window.setTimeout(() => {
      if (!returningVisitor && !localStorage.getItem("roadwise-tickets-intro-seen")) setTicketsIntroOpen(true);
    }, 500);
    const ratingTimeout = window.setTimeout(() => {
      if (returningVisitor && !localStorage.getItem("roadwise-rating")) setRatingOpen(true);
    }, 650);
    const promptsReadyTimeout = window.setTimeout(() => setPromptsReady(true), 800);
    return () => {
      window.clearTimeout(introTimeout);
      window.clearTimeout(ratingTimeout);
      window.clearTimeout(promptsReadyTimeout);
    };
  }, [loading]);

  const availableTopics = useMemo(
    () => topics.filter(isTopicAvailable),
    [topics],
  );
  const visibleTopics = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("uk");
    return topics.filter((topic) => topic.topic.toLocaleLowerCase("uk").includes(normalizedSearch));
  }, [topics, search]);
  const totalQuestions = availableTopics.reduce((total, topic) => total + topic.count, 0);
  const average = history.length
    ? Math.round(history.reduce((total, item) => total + item.percent, 0) / history.length)
    : null;
  const homeAverages = useMemo(() => {
    const todayKey = getUtcDateKey(new Date());
    const weekStart = new Date();
    weekStart.setUTCHours(0, 0, 0, 0);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const weekStartKey = getUtcDateKey(weekStart);
    const averageFor = (entries: HistoryEntry[]) =>
      entries.length ? `${Math.round(entries.reduce((total, item) => total + item.percent, 0) / entries.length)}%` : "—";
    return {
      today: averageFor(history.filter((item) => item.date.slice(0, 10) === todayKey)),
      week: averageFor(history.filter((item) => item.date.slice(0, 10) >= weekStartKey)),
    };
  }, [history]);
  const streakDays = useMemo(() => {
    const activeDays = new Set(history.map((item) => item.date.slice(0, 10)));
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    if (!activeDays.has(getUtcDateKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
    let streak = 0;
    while (activeDays.has(getUtcDateKey(cursor))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
  }, [history]);
  const topicProgressStats = useMemo(() => {
    const passed = availableTopics.filter((topic) => {
      const progress = topicProgress[topic.file.replace(/\.json$/, "")];
      return progress?.status === "completed" && (progress.percent ?? 0) >= EXAM_PASS_PERCENT;
    }).length;
    const notStarted = availableTopics.filter((topic) => !topicProgress[topic.file.replace(/\.json$/, "")]?.status).length;
    return { passed, notStarted };
  }, [availableTopics, topicProgress]);
  const currentQuestion = questions[currentIndex];
  const missedQuestions = useMemo(
    () => questions.filter((question) => question.userAnswer !== question.correctAnswer),
    [questions],
  );
  const answeredCount = questions.filter((question) => question.userAnswer !== undefined).length;
  const incorrectCount = questions.filter(
    (question) => question.userAnswer !== undefined && question.userAnswer !== question.correctAnswer,
  ).length;
  const modeLabel =
    selectedMode === "topic" ? selectedTopic?.topic ?? "Обери тему" :
      selectedMode === "random" ? "Випадковий іспит" :
        selectedMode === "ticket" ? `Білет ${selectedTicket}` :
          selectedMode === "saved" ? "Збережені питання" : "Мої помилки";
  const resultStats = useMemo(() => {
    const totalQuestions = history.reduce((total, item) => total + item.total, 0);
    const totalCorrect = history.reduce((total, item) => total + item.correct, 0);
    const exams = history.filter((item) => item.mode === "random" || !item.mode);
    const passedExams = exams.filter((item) => item.passed ?? item.percent >= EXAM_PASS_PERCENT).length;
    return {
      totalQuestions,
      totalCorrect,
      passedExams,
      failedExams: exams.length - passedExams,
      totalErrors: totalQuestions - totalCorrect,
    };
  }, [history]);
  const weeklyStats = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setHours(12, 0, 0, 0);
      date.setDate(today.getDate() - (6 - index));
      const dayHistory = history.filter((item) => getLocalDateKey(new Date(item.date)) === getLocalDateKey(date));
      const topic = dayHistory.filter((item) => item.mode === "topic").length;
      const ticketsCount = dayHistory.filter((item) => item.mode === "ticket").length;
      const examsCount = dayHistory.filter((item) => item.mode === "random" || !item.mode).length;
      return {
        date,
        topic,
        tickets: ticketsCount,
        exams: examsCount,
        total: dayHistory.length,
        failed: dayHistory.filter(
          (item) => (item.mode === "random" || !item.mode) && !(item.passed ?? item.percent >= EXAM_PASS_PERCENT),
        ).length,
      };
    });
  }, [history]);
  const weeklyMaximum = Math.max(1, ...weeklyStats.map((item) => item.total));

  function targetedSurveyEndpoint(path: string) {
    return isSurveyPreview
      ? `${path}?survey-test=1&session=${encodeURIComponent(surveyPreviewSession ?? "")}`
      : path;
  }

  async function checkTargetedSurvey() {
    try {
      const response = await fetch(targetedSurveyEndpoint("/api/targeted-feedback-prompt"), { cache: "no-store" });
      const payload = (await response.json()) as { show?: boolean; questionIndex?: number };
      if (!response.ok) throw new Error("Не вдалося перевірити доступність опитування.");
      if (payload.show) {
        setSurveyIndex(payload.questionIndex ?? 0);
        setSurveyAvailable(true);
      }
    } catch (error) {
      console.error("Could not check targeted feedback prompt.", error);
    }
  }

  useEffect(() => {
    if (!loading) void checkTargetedSurvey();
  }, [loading]);

  useEffect(() => {
    if (promptsReady && surveyAvailable && !ratingOpen && !ticketsIntroOpen) setSurveyOpen(true);
  }, [promptsReady, surveyAvailable, ratingOpen, ticketsIntroOpen]);

  function closeTargetedSurvey() {
    setSurveyOpen(false);
    setSurveyAvailable(false);
    void fetch(targetedSurveyEndpoint("/api/targeted-feedback-dismiss"), { method: "POST", keepalive: true })
      .then((response) => {
        if (!response.ok) throw new Error(`Не вдалося закрити опитування (${response.status}).`);
      })
      .catch((error: unknown) => console.error("Could not dismiss targeted feedback survey.", error));
  }

  async function submitTargetedSurveyAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = targetedSurveyQuestions[surveyIndex];
    if (!question) return;
    const answer = question.type === "choice-other" && surveyAnswer === "Інше"
      ? `Інше: ${surveyOtherAnswer.trim()}`
      : question.type === "slider"
        ? surveyAnswer || "5"
        : surveyAnswer;
    if (!answer.trim()) return;
    setSurveySending(true);
    setSurveyStatus("Надсилаємо відповідь…");
    try {
      const response = await fetch(targetedSurveyEndpoint("/api/targeted-feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIndex: surveyIndex, answer }),
      });
      const payload = (await response.json()) as { complete?: boolean; questionIndex?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Не вдалося надіслати відповідь.");
      if (payload.complete) {
        setSurveyIndex(targetedSurveyQuestions.length);
        setSurveyAvailable(false);
        setSurveyStatus("");
      } else {
        setSurveyIndex(payload.questionIndex ?? surveyIndex + 1);
        setSurveyAnswer("");
        setSurveyOtherAnswer("");
        setSurveyStatus("");
      }
    } catch (error) {
      setSurveyStatus(error instanceof Error ? error.message : "Не вдалося надіслати відповідь.");
    } finally {
      setSurveySending(false);
    }
  }

  async function confirmRating() {
    if (!rating) return;
    localStorage.setItem("roadwise-rating", String(rating));
    setRatingStatus("Дякуємо за оцінку!");
    try {
      const response = await fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "site_rating", rating }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`Не вдалося зберегти оцінку (${response.status}).`);
      window.setTimeout(() => setRatingOpen(false), 700);
    } catch (error) {
      setRatingStatus(error instanceof Error ? error.message : "Не вдалося зберегти оцінку.");
    }
  }

  function closeTicketsIntro() {
    localStorage.setItem("roadwise-tickets-intro-seen", "1");
    setTicketsIntroOpen(false);
  }

  function toggleTimerVisibility() {
    const nextHidden = !timerHidden;
    setTimerHidden(nextHidden);
    localStorage.setItem("roadwise-timer-hidden", nextHidden ? "1" : "0");
  }

  function formatDuration(durationMs: number) {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  }

  function resultShareModeLabel() {
    if (selectedMode === "ticket") return `Білет ${selectedTicket}`;
    if (selectedMode === "random") return "Випадковий іспит";
    if (selectedMode === "topic") return "Тренування за темою";
    if (selectedMode === "mistakes") return "Мої помилки";
    return "Збережені питання";
  }

  async function createResultShareCard() {
    if (!result) throw new Error("Немає результату для поширення.");
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не вдалося створити картку результату.");
    context.fillStyle = "#f4f8f7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#17231f";
    context.fillRect(0, 0, canvas.width, 150);
    context.fillStyle = "#fff";
    context.font = "700 34px Arsenal, sans-serif";
    context.fillText("ROADWISE", 72, 94);
    context.fillStyle = "#deeff5";
    context.font = "600 20px DM Sans, sans-serif";
    context.fillText("МОЇ РЕЗУЛЬТАТИ ПДР", 870, 91);
    context.fillStyle = result.passed ? "#449e48" : "#ff805b";
    context.font = "700 150px Arsenal, sans-serif";
    context.fillText(`${Math.round(result.correct / result.total * 100)}%`, 72, 358);
    context.fillStyle = "#17231f";
    context.font = "700 34px Arsenal, sans-serif";
    context.fillText(result.passed ? "Іспит складено" : "Є до чого прагнути", 78, 422);
    context.fillStyle = "#718078";
    context.font = "500 24px DM Sans, sans-serif";
    context.fillText(`Правильних відповідей: ${result.correct} із ${result.total}`, 80, 480);
    context.fillText(resultShareModeLabel(), 80, 524);
    if (result.durationMs !== null) context.fillText(`Час: ${formatDuration(result.durationMs)}`, 80, 568);
    context.fillStyle = "#449e48";
    context.fillRect(850, 205, 270, 270);
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.font = "700 52px Arsenal, sans-serif";
    context.fillText(`${result.correct}/${result.total}`, 985, 330);
    context.font = "500 22px DM Sans, sans-serif";
    context.fillText("правильних", 985, 378);
    context.textAlign = "left";
    context.fillStyle = "#718078";
    context.font = "500 18px DM Sans, sans-serif";
    context.fillText(window.location.host, 80, 606);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Не вдалося зберегти картку результату.")), "image/png");
    });
  }

  async function shareTestResult() {
    if (!result || shareSending) return;
    setShareSending(true);
    setShareStatus("Готуємо картку…");
    const url = new URL(window.location.pathname, window.location.origin).href;
    const modeLabel = resultShareModeLabel().toLowerCase();
    const caption = `Мій результат: ${result.correct} з ${result.total} правильних у форматі «${modeLabel}» (${Math.round(result.correct / result.total * 100)}%).`;
    try {
      const blob = await createResultShareCard();
      const file = typeof File === "undefined" ? null : new File([blob], "roadwise-result.png", { type: "image/png" });
      let canShareFile = false;
      if (file && navigator.canShare) {
        try {
          canShareFile = navigator.canShare({ files: [file] });
        } catch {
          canShareFile = false;
        }
      }
      if (navigator.share) {
        await navigator.share({ title: "Мій результат Roadwise", text: caption, url, ...(canShareFile && file ? { files: [file] } : {}) });
        setShareStatus("Результатом поділилися.");
      } else {
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "roadwise-result.png";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        let copied = false;
        try {
          await navigator.clipboard.writeText(`${caption} ${url}`);
          copied = true;
        } catch {
          copied = false;
        }
        setShareStatus(copied ? "Картку завантажено, текст результату скопійовано." : "Картку завантажено. Її можна додати до допису в соцмережі.");
      }
    } catch (error) {
      setShareStatus(error instanceof Error && error.name === "AbortError" ? "Поширення скасовано." : error instanceof Error ? error.message : "Не вдалося підготувати результат.");
    } finally {
      setShareSending(false);
    }
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (showReportModal && !reportSending) setShowReportModal(false);
      if (confirmClearSaved) setConfirmClearSaved(false);
      if (showCategoryPicker) setShowCategoryPicker(false);
      if (examFailedPrompt) setExamFailedPrompt(false);
      if (ratingOpen) setRatingOpen(false);
      if (ticketsIntroOpen) closeTicketsIntro();
      if (surveyOpen && !surveySending) closeTargetedSurvey();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showReportModal, reportSending, confirmClearSaved, showCategoryPicker, examFailedPrompt, ratingOpen, ticketsIntroOpen, surveyOpen, surveySending]);

  useEffect(() => {
    if (!["random", "ticket"].includes(selectedMode) || view !== "quiz" || timerStartedAt === null) return;
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [selectedMode, timerStartedAt, view]);

  async function loadTopic(topic: TopicEntry) {
    if (!isTopicAvailable(topic)) return;
    const dateKey = getLocalDateKey(new Date());
    const testsToday = history.filter(
      (item) =>
        item.mode === "topic" &&
        item.topic === topic.topic &&
        getLocalDateKey(new Date(item.date)) === dateKey,
    ).length;
    if (testsToday >= DAILY_TOPIC_TEST_LIMIT) {
      setErrorMessage("Цю тему вже пройдено тричі сьогодні. Спробуй знову завтра.");
      return;
    }

    setLoadingTopic(true);
    setErrorMessage("");
    try {
      const response = await fetch(`/questions.by-topic/${encodeURIComponent(topic.file)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Не вдалося завантажити питання (${response.status}).`);
      const topicQuestions = (await response.json()) as Question[];
      if (!Array.isArray(topicQuestions) || topicQuestions.length === 0) {
        throw new Error("У цій темі поки немає питань.");
      }

      const shuffledQuestions = shuffle(topicQuestions);
      const startedAt = new Date().toISOString();
      const topicId = topic.file.replace(/\.json$/, "");
      const nextProgress = {
        ...topicProgress,
        [topicId]: { status: "started" as const, lastOpenedAt: startedAt },
      };
      setTopicProgress(nextProgress);
      writeStorage(TOPIC_PROGRESS_KEY, nextProgress);
      localStorage.setItem("roadwise-last-topic", topic.topic);
      setSelectedTopic(topic);
      setSelectedTicket(null);
      setSelectedMode("topic");
      setRandomCategory(null);
      setQuestions(shuffledQuestions);
      setCurrentIndex(0);
      setResult(null);
      setView("quiz");
      setTimerStartedAt(null);
      setInterruptedTest(null);
      setPendingMode(null);
      setPendingTopic(null);
      writeStorage(CURRENT_TEST_KEY, {
        mode: "topic",
        topic: topic.topic,
        ticket: null,
        currentIndex: 0,
        questions: shuffledQuestions,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не вдалося завантажити питання.");
    } finally {
      setLoadingTopic(false);
    }
  }

  function changeAnswerMode(mode: AnswerMode) {
    setAnswerMode(mode);
    localStorage.setItem(ANSWER_MODE_KEY, mode);
    setQuestions((current) =>
      current.map((question) => {
        const { pendingAnswer: _pendingAnswer, ...rest } = question;
        return rest;
      }),
    );
  }

  async function submitQuestionReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = questions[currentIndex];
    const message = reportMessage.trim();
    if (!question || !message) return;
    setReportSending(true);
    setReportStatus("Надсилаємо…");
    try {
      const response = await fetch("/api/report-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          question: {
            id: question.id,
            topic: question.topic,
            text: question.question,
            selectedAnswer: question.userAnswer === undefined ? null : question.answers[question.userAnswer],
          },
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не вдалося надіслати повідомлення.");
      setReportStatus("Дякуємо, що повідомили! Звіт надіслано.");
      setReportMessage("");
    } catch (error) {
      setReportStatus(error instanceof Error ? error.message : "Не вдалося надіслати повідомлення.");
    } finally {
      setReportSending(false);
    }
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = feedbackMessage.trim();
    if (!message) return;
    setFeedbackSending(true);
    setFeedbackStatus("Надсилаємо…");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, contact: feedbackContact.trim() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не вдалося надіслати повідомлення.");
      setFeedbackMessage("");
      setFeedbackContact("");
      setFeedbackStatus("Дякуємо! Повідомлення надіслано.");
    } catch (error) {
      setFeedbackStatus(error instanceof Error ? error.message : "Не вдалося надіслати повідомлення.");
    } finally {
      setFeedbackSending(false);
    }
  }

  function requestTopic(topic: TopicEntry) {
    if (interruptedTest) {
      setPendingTopic(topic);
      setPendingMode(null);
      return;
    }
    void loadTopic(topic);
  }

  function requestMode(mode: "random" | "mistakes") {
    if (interruptedTest) {
      setPendingTopic(null);
      setPendingMode(mode);
      setPendingTicket(null);
      return;
    }
    void startMode(mode);
  }

  async function startMode(mode: "random" | "mistakes", category?: RandomCategory) {
    if (mode === "random" && !category) {
      const savedCategory = localStorage.getItem("roadwise-random-category");
      if (savedCategory && Object.hasOwn(RANDOM_TEST_CATEGORIES, savedCategory)) {
        category = savedCategory as RandomCategory;
      } else {
        setCategoryChoice("");
        setRememberCategory(false);
        setShowCategoryPicker(true);
        return;
      }
    }

    setLoadingTopic(true);
    setErrorMessage("");
    try {
      let testQuestions: Question[];
      if (mode === "random") {
        const response = await fetch(`/api/questions/random?count=20&category=${encodeURIComponent(category!)}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || `Не вдалося завантажити випадкові питання (${response.status}).`);
        }
        const payload = (await response.json()) as { questions?: Question[] };
        if (!Array.isArray(payload.questions)) throw new Error("Сервер повернув питання в невідомому форматі.");
        testQuestions = payload.questions;
      } else {
        if (errors.length === 0) {
          setErrorMessage("Поки немає помилок для повторення. Спершу пройди тест за темою.");
          return;
        }
        const groups = await Promise.all(
          availableTopics.map(async (topic) => {
            const response = await fetch(`/questions.by-topic/${encodeURIComponent(topic.file)}`, {
              cache: "no-store",
            });
            if (!response.ok) throw new Error(`Не вдалося завантажити тему «${topic.topic}» (${response.status}).`);
            const topicQuestions = (await response.json()) as Question[];
            if (!Array.isArray(topicQuestions)) throw new Error(`Некоректний формат питань теми «${topic.topic}».`);
            return topicQuestions;
          }),
        );
        const errorIds = new Set(errors);
        testQuestions = shuffle(groups.flat().filter((question) => errorIds.has(question.id))).slice(0, 20);
      }

      if (testQuestions.length === 0) {
        setErrorMessage(mode === "mistakes" ? "Помилки більше не знайдено. Чудова робота!" : "Сервер не повернув питань для цього іспиту.");
        return;
      }

      const startedAt = mode === "random" ? Date.now() : null;
      beginTest(mode, testQuestions, { category, startedAt });
      if (mode === "random" && rememberCategory && category) {
        localStorage.setItem("roadwise-random-category", category);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не вдалося завантажити питання.");
    } finally {
      setLoadingTopic(false);
    }
  }

  function resumeInterruptedTest() {
    if (!interruptedTest) return;
    const topic = interruptedTest.mode === "topic"
      ? topics.find((entry) => entry.topic === interruptedTest.topic)
      : null;
    if (interruptedTest.mode === "topic" && !topic) {
      setErrorMessage("Не вдалося знайти тему для незавершеного тесту. Спробуй почати її заново.");
      return;
    }
    setSelectedTopic(topic ?? null);
    setSelectedTicket(interruptedTest.mode === "ticket" ? interruptedTest.ticket ?? null : null);
    setSelectedMode(interruptedTest.mode);
    setRandomCategory(interruptedTest.category ?? null);
    setQuestions(interruptedTest.questions);
    setCurrentIndex(Math.max(0, Math.min(interruptedTest.currentIndex, interruptedTest.questions.length - 1)));
    setResult(null);
    setView("quiz");
    setTimerStartedAt(["random", "ticket"].includes(interruptedTest.mode) ? interruptedTest.startedAt ?? Date.now() : null);
    setTimerNow(Date.now());
    setExamFailed(interruptedTest.mode === "random" && interruptedTest.questions.some(
      (question) => question.userAnswer !== undefined && question.userAnswer !== question.correctAnswer,
    ));
    setPendingTopic(null);
    setPendingMode(null);
    setPendingTicket(null);
  }

  function startPendingTest() {
    const nextTopic = pendingTopic;
    const nextTicket = pendingTicket;
    const nextMode = pendingMode;
    localStorage.removeItem(CURRENT_TEST_KEY);
    setInterruptedTest(null);
    if (nextTopic) void loadTopic(nextTopic);
    else if (nextTicket !== null) void startTicket(nextTicket);
    else if (nextMode === "saved") beginTest("saved", shuffle(savedQuestions));
    else if (nextMode === "random" || nextMode === "mistakes") void startMode(nextMode);
  }

  function beginTest(
    mode: TestMode,
    testQuestions: Question[],
    options: { topic?: TopicEntry; ticket?: number; category?: RandomCategory; startedAt?: number | null } = {},
  ) {
    const sanitizedQuestions = testQuestions.map(
      ({ userAnswer: _answer, pendingAnswer: _pending, showCorrectAnswer: _shown, ...question }) => question,
    );
    setSelectedTopic(options.topic ?? null);
    setSelectedTicket(options.ticket ?? null);
    setSelectedMode(mode);
    setRandomCategory(mode === "random" ? options.category ?? null : null);
    setQuestions(sanitizedQuestions);
    setCurrentIndex(0);
    setResult(null);
    setView("quiz");
    const startedAt = options.startedAt ?? (mode === "ticket" ? Date.now() : null);
    setTimerStartedAt(startedAt);
    setTimerNow(Date.now());
    setExamFailedPrompt(false);
    setExamFailed(false);
    setInterruptedTest(null);
    setPendingMode(null);
    setPendingTopic(null);
    setPendingTicket(null);
    writeStorage(CURRENT_TEST_KEY, {
      mode,
      topic: options.topic?.topic ?? null,
      ticket: options.ticket,
      category: mode === "random" ? options.category : undefined,
      startedAt: startedAt ?? undefined,
      currentIndex: 0,
      questions: sanitizedQuestions,
    });
    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test_started", mode, topic: options.topic?.topic ?? "all", total: sanitizedQuestions.length }),
      keepalive: true,
    }).catch(() => {});
  }

  async function loadTickets(): Promise<Question[][]> {
    if (tickets) return tickets;
    const groups = await Promise.all(
      availableTopics.map(async (topic) => {
        const response = await fetch(`/questions.by-topic/${encodeURIComponent(topic.file)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Не вдалося завантажити тему «${topic.topic}» (${response.status}).`);
        const questionsForTopic = (await response.json()) as Question[];
        if (!Array.isArray(questionsForTopic)) throw new Error(`Некоректний формат питань теми «${topic.topic}».`);
        return questionsForTopic;
      }),
    );
    const questionsByTopic = new Map<string, Question[]>();
    groups.flat().forEach((question) => {
      const group = questionsByTopic.get(question.topic) ?? [];
      group.push(question);
      questionsByTopic.set(question.topic, group);
    });
    const allQuestions = groups.flat();
    const ticketCount = Math.ceil(allQuestions.length / 20);
    if (ticketCount === 0) {
      setTickets([]);
      return [];
    }
    const generatedTickets = Array.from({ length: ticketCount }, () => [] as Question[]);
    let ticketIndex = 0;
    questionsByTopic.forEach((topicQuestions) => {
      topicQuestions.forEach((question) => {
        generatedTickets[ticketIndex].push(question);
        ticketIndex = (ticketIndex + 1) % ticketCount;
      });
    });
    setTickets(generatedTickets);
    return generatedTickets;
  }

  async function openTickets() {
    setView("tickets");
    if (tickets) return;
    setLoadingTopic(true);
    setErrorMessage("");
    try {
      await loadTickets();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не вдалося завантажити білети.");
    } finally {
      setLoadingTopic(false);
    }
  }

  async function openErrors() {
    setView("errors");
    if (!errors.length) {
      setErrorQuestions([]);
      return;
    }
    setLoadingTopic(true);
    setErrorMessage("");
    try {
      const groups = await Promise.all(
        availableTopics.map(async (topic) => {
          const response = await fetch(`/questions.by-topic/${encodeURIComponent(topic.file)}`, { cache: "no-store" });
          if (!response.ok) throw new Error(`Не вдалося завантажити тему «${topic.topic}» (${response.status}).`);
          const topicQuestions = (await response.json()) as Question[];
          if (!Array.isArray(topicQuestions)) throw new Error(`Некоректний формат питань теми «${topic.topic}».`);
          return topicQuestions;
        }),
      );
      const questionsById = new Map(groups.flat().map((question) => [question.id, question]));
      setErrorQuestions(errors.map((id) => questionsById.get(id)).filter((question): question is Question => question !== undefined));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не вдалося завантажити питання для повторення.");
    } finally {
      setLoadingTopic(false);
    }
  }

  function requestTicket(ticketNumber: number) {
    if (interruptedTest) {
      setPendingTopic(null);
      setPendingMode(null);
      setPendingTicket(ticketNumber);
      return;
    }
    void startTicket(ticketNumber);
  }

  async function startTicket(ticketNumber: number) {
    setLoadingTopic(true);
    setErrorMessage("");
    try {
      const ticketList = await loadTickets();
      const ticketQuestions = ticketList[ticketNumber - 1];
      if (!ticketQuestions?.length) throw new Error("Цей білет не знайдено.");
      beginTest("ticket", ticketQuestions, { ticket: ticketNumber, startedAt: Date.now() });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не вдалося завантажити білет.");
    } finally {
      setLoadingTopic(false);
    }
  }

  function requestSavedTest() {
    if (!savedQuestions.length) {
      setView("saved");
      return;
    }
    if (interruptedTest) {
      setPendingTopic(null);
      setPendingMode("saved");
      setPendingTicket(null);
      return;
    }
    beginTest("saved", shuffle(savedQuestions));
  }

  function toggleSavedQuestion(question: Question) {
    const alreadySaved = savedQuestions.some((saved) => saved.id === question.id);
    const updated = alreadySaved
      ? savedQuestions.filter((saved) => saved.id !== question.id)
      : [
          ...savedQuestions,
          {
            id: question.id,
            topic: question.topic,
            question: question.question,
            image: question.image,
            answers: question.answers,
            correctAnswer: question.correctAnswer,
            source: question.source,
            savedAt: new Date().toISOString(),
          },
        ];
    setSavedQuestions(updated);
    writeStorage(SAVED_KEY, updated);
  }

  function removeSavedQuestion(id: string) {
    const updated = savedQuestions.filter((question) => question.id !== id);
    setSavedQuestions(updated);
    writeStorage(SAVED_KEY, updated);
  }

  function clearSavedQuestions() {
    setSavedQuestions([]);
    writeStorage(SAVED_KEY, []);
    setConfirmClearSaved(false);
  }

  function answerQuestion(answerIndex: number) {
    if (!currentQuestion || currentQuestion.userAnswer !== undefined) return;
    if (answerMode === "check") {
      setQuestions((current) =>
        current.map((question, index) =>
          index === currentIndex ? { ...question, pendingAnswer: answerIndex } : question,
        ),
      );
      return;
    }
    recordAnswer(answerIndex);
  }

  function recordAnswer(answerIndex: number) {
    if (
      selectedMode === "random" &&
      !examFailed &&
      answerIndex !== currentQuestion?.correctAnswer &&
      (questions.length - incorrectCount - 1) / questions.length < EXAM_PASS_PERCENT / 100
    ) {
      setExamFailed(true);
      setExamFailedPrompt(true);
    }
    const updated = questions.map((question, index) =>
      index === currentIndex
        ? { ...question, userAnswer: answerIndex, pendingAnswer: undefined, showCorrectAnswer: false }
        : question,
    );
    setQuestions(updated);
    const topicId = selectedMode === "topic" ? selectedTopic?.file.replace(/\.json$/, "") : undefined;
    if (topicId) {
      const progress = {
        ...readStorage<Record<string, TopicProgress>>(TOPIC_PROGRESS_KEY, {}),
        [topicId]: { status: "started" as const, lastOpenedAt: new Date().toISOString() },
      };
      setTopicProgress(progress);
      writeStorage(TOPIC_PROGRESS_KEY, progress);
    }
    writeStorage(CURRENT_TEST_KEY, {
      mode: selectedMode,
      topic: selectedTopic?.topic ?? null,
      ticket: selectedTicket ?? undefined,
      category: randomCategory ?? undefined,
      startedAt: timerStartedAt ?? undefined,
      currentIndex,
      questions: updated,
    });
  }

  function navigateQuestion(index: number) {
    setCurrentIndex(index);
    writeStorage(CURRENT_TEST_KEY, {
      mode: selectedMode,
      topic: selectedTopic?.topic ?? null,
      ticket: selectedTicket ?? undefined,
      category: randomCategory ?? undefined,
      startedAt: timerStartedAt ?? undefined,
      currentIndex: index,
      questions,
    });
  }

  function showCorrectAnswer() {
    setQuestions((current) =>
      current.map((question, index) =>
        index === currentIndex ? { ...question, showCorrectAnswer: true } : question,
      ),
    );
  }

  function goToQuestion(index: number) {
    navigateQuestion(index);
  }

  function nextQuestion() {
    if (!currentQuestion || currentQuestion.userAnswer === undefined) return;
    if (currentIndex < questions.length - 1) {
      goToQuestion(currentIndex + 1);
      return;
    }
    finishTest();
  }

  function finishTest() {
    const correct = questions.filter((question) => question.userAnswer === question.correctAnswer).length;
    const wrongQuestions = questions.filter((question) => question.userAnswer !== question.correctAnswer);
    const percent = Math.round((correct / questions.length) * 100);
    const passed = selectedMode === "ticket" ? correct >= 18 : percent >= EXAM_PASS_PERCENT;
    const nextErrors = errors.filter(
      (id) => !questions.some((question) => question.id === id && question.userAnswer === question.correctAnswer),
    );
    wrongQuestions.forEach((question) => {
      if (!nextErrors.includes(question.id)) nextErrors.push(question.id);
    });
    const entry: HistoryEntry = {
      percent,
      correct,
      total: questions.length,
      passed,
      mode: selectedMode,
      topic: selectedTopic?.topic ?? null,
      durationMs: ["random", "ticket"].includes(selectedMode) && timerStartedAt !== null ? Date.now() - timerStartedAt : null,
      date: new Date().toISOString(),
    };
    const nextHistory = [...history, entry];
    const completedAt = entry.date;
    const topicId = selectedMode === "topic" ? selectedTopic?.file.replace(/\.json$/, "") : undefined;
    const nextProgress = topicId
      ? {
          ...topicProgress,
          [topicId]: {
            status: "completed" as const,
            mistakes: wrongQuestions.length,
            percent,
            completedAt,
            lastOpenedAt: completedAt,
          },
        }
      : topicProgress;
    setErrors(nextErrors);
    setHistory(nextHistory);
    setTopicProgress(nextProgress);
    if (selectedMode === "ticket" && selectedTicket !== null) {
      const nextTicketProgress = {
        ...ticketProgress,
        [selectedTicket]: {
          correct,
          mistakes: wrongQuestions.length,
          passed: correct >= 18,
          completedAt,
        },
      };
      setTicketProgress(nextTicketProgress);
      writeStorage(TICKET_PROGRESS_KEY, nextTicketProgress);
    }
    setResult({
      correct,
      total: questions.length,
      passed,
      durationMs: entry.durationMs,
    });
    setView("result");
    setInterruptedTest(null);
    setTimerStartedAt(null);
    setExamFailedPrompt(false);
    setExamFailed(false);
    writeStorage(ERRORS_KEY, nextErrors);
    writeStorage(HISTORY_KEY, nextHistory);
    writeStorage(TOPIC_PROGRESS_KEY, nextProgress);
    localStorage.removeItem(CURRENT_TEST_KEY);
    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test_completed", mode: selectedMode, topic: selectedTopic?.topic ?? "all", total: questions.length, correct }),
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Не вдалося записати завершення тесту (${response.status}).`);
        return checkTargetedSurvey();
      })
      .catch((error: unknown) => console.error("Could not record completed test.", error));
  }

  function returnToTopics() {
    setView("topics");
    setResult(null);
    setQuestions([]);
    setSelectedTopic(null);
    setErrorMessage("");
  }

  function returnToCurrentList() {
    setView(selectedMode === "ticket" ? "tickets" : selectedMode === "saved" ? "saved" : "home");
    setResult(null);
    setQuestions([]);
    setSelectedTicket(null);
    setErrorMessage("");
  }

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError(event.error instanceof Error ? event.error : new Error(event.message));
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportClientError(event.reason instanceof Error ? event.reason : String(event.reason ?? "Unhandled promise rejection"));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    const question = questions[currentIndex];
    if (
      answerMode !== "auto-correct" ||
      question?.userAnswer === undefined ||
      question.userAnswer !== question.correctAnswer
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (currentIndex === questions.length - 1) {
        finishTest();
        return;
      }
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      writeStorage(CURRENT_TEST_KEY, {
        mode: selectedMode,
        topic: selectedTopic?.topic ?? null,
        ticket: selectedTicket ?? undefined,
        category: randomCategory ?? undefined,
        startedAt: timerStartedAt ?? undefined,
        currentIndex: nextIndex,
        questions,
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [answerMode, currentIndex, questions, randomCategory, selectedMode, selectedTopic, timerStartedAt]);

  return (
    <div className="client-app">
      <header className="client-header">
        <button className="client-brand" type="button" onClick={() => setView("home")} aria-label="Roadwise — головна">
          <img src="/images/logo-wide.svg" alt="Roadwise" />
        </button>
        <nav className="client-nav" aria-label="Основна навігація">
          <button className={view === "home" ? "is-active" : ""} type="button" onClick={() => setView("home")}>
            Головна
          </button>
          <button
            className={view === "topics" ? "is-active" : ""}
            type="button"
            onClick={() => setView("topics")}
          >
            Теми
          </button>
          <button className={view === "tickets" ? "is-active" : ""} type="button" onClick={() => void openTickets()}>
            Білети
          </button>
          <button className={view === "saved" ? "is-active" : ""} type="button" onClick={() => setView("saved")}>
            Збережені{savedQuestions.length > 0 && <span className="client-nav-badge">{savedQuestions.length}</span>}
          </button>
          <button className={view === "errors" ? "is-active" : ""} type="button" onClick={() => void openErrors()}>
            Помилки{errors.length > 0 && <span className="client-nav-badge">{errors.length}</span>}
          </button>
          <button className={view === "results" ? "is-active" : ""} type="button" onClick={() => setView("results")}>
            Результати
          </button>
          <button className={view === "settings" ? "is-active" : ""} type="button" onClick={() => setView("settings")}>
            Налаштування
          </button>
          <button className={view === "feedback" ? "is-active" : ""} type="button" onClick={() => setView("feedback")}>
            Зв’язок
          </button>
        </nav>
      </header>

      <main className="client-main">
        {errorMessage && (
          <div className="client-alert" role="alert">
            <span>{errorMessage}</span>
            <button type="button" onClick={() => setErrorMessage("")} aria-label="Закрити повідомлення">
              ×
            </button>
          </div>
        )}

        {view === "home" && (
          <>
            {interruptedTest && (
              <div className="client-resume-banner" role="status">
                <span>
                  Є незавершений тест: {interruptedTest.mode === "topic" ? `«${interruptedTest.topic}»` : interruptedTest.mode === "random" ? "випадковий іспит" : "мої помилки"}.
                </span>
                <button className="client-text-button" type="button" onClick={resumeInterruptedTest}>
                  Продовжити →
                </button>
              </div>
            )}
            <section className="client-hero">
              <div>
                <p className="client-eyebrow">Твій простір для підготовки</p>
                <h1>
                  Тести ПДР
                  <br />
                  <em>України онлайн.</em>
                </h1>
                <p className="client-lead">
                  Тренуйся за темами, проходь пробні іспити та закріплюй питання, у яких помилився.
                </p>
                <button className="client-primary" type="button" onClick={() => setView("topics")}>
                  Обрати тему <span aria-hidden="true">→</span>
                </button>
              </div>
              <div className="client-hero-image">
                <img src="/images/hero-road.jpg" alt="" />
              </div>
            </section>

            <section className="client-stats" aria-label="Статистика">
              <article>
                <span>Пройдено тестів</span>
                <strong>{history.length}</strong>
                <small>Збережено на цьому пристрої</small>
              </article>
              <article>
                <span>Середній результат</span>
                <strong>{average === null ? "—" : `${average}%`}</strong>
                <div className="client-stat-submetrics">
                  <span><strong>{homeAverages.week}</strong><small>7 днів</small></span>
                  <span><strong>{homeAverages.today}</strong><small>сьогодні</small></span>
                </div>
              </article>
              <article>
                <span>Питань у базі</span>
                <strong>{loading ? "…" : totalQuestions.toLocaleString("uk-UA")}</strong>
                <small>{availableTopics.length} доступних тем</small>
              </article>
              <article>
                <span>Активна серія</span>
                <strong>{streakDays}</strong>
                <small>днів поспіль</small>
              </article>
              <article>
                <span>Прогрес тем</span>
                <strong>{topicProgressStats.passed}</strong>
                <small>тем із результатом 90%+</small>
                <small>{topicProgressStats.notStarted} ще не розпочато</small>
              </article>
            </section>

            <section className="client-section">
              <div className="client-section-heading">
                <div>
                  <p className="client-eyebrow">Почати тренування</p>
                  <h2>Обери формат</h2>
                </div>
                <span>01 / 03</span>
              </div>
              <div className="client-mode-grid">
                <button className="client-mode-card" type="button" onClick={() => setView("topics")}>
                  <span className="client-mode-number">01</span>
                  <strong>За темою</strong>
                  <span>Зосередься на конкретному розділі</span>
                  <span className="client-mode-arrow" aria-hidden="true">↗</span>
                </button>
                <button className="client-mode-card is-primary" type="button" onClick={() => requestMode("random")}>
                  <span className="client-mode-number">02</span>
                  <strong>Випадковий тест</strong>
                  <span>20 питань, як на теоретичному іспиті</span>
                  <span className="client-mode-arrow" aria-hidden="true">↗</span>
                </button>
                <button className="client-mode-card" type="button" onClick={() => requestMode("mistakes")}>
                  <span className="client-mode-number">03</span>
                  <strong>Мої помилки</strong>
                  <span>{errors.length ? `${errors.length} питань для повторення` : "Поки помилок немає"}</span>
                  <span className="client-mode-arrow" aria-hidden="true">↗</span>
                </button>
                <button className="client-mode-card" type="button" onClick={() => void openTickets()}>
                  <span className="client-mode-number">04</span>
                  <strong>Білети</strong>
                  <span>Повні іспити по 19–20 питань</span>
                  <span className="client-mode-arrow" aria-hidden="true">↗</span>
                </button>
                <button className="client-mode-card" type="button" onClick={() => setView("saved")}>
                  <span className="client-mode-number">05</span>
                  <strong>Збережені питання</strong>
                  <span>{savedQuestions.length ? `${savedQuestions.length} питань у списку` : "Збирай питання для повторення"}</span>
                  <span className="client-mode-arrow" aria-hidden="true">↗</span>
                </button>
              </div>
            </section>

            <section className="client-section client-topic-preview">
              <div className="client-section-heading">
                <div>
                  <p className="client-eyebrow">Структура бази</p>
                  <h2>Теми</h2>
                </div>
                <button className="client-text-button" type="button" onClick={() => setView("topics")}>
                  Усі теми <span aria-hidden="true">→</span>
                </button>
              </div>
              <div className="client-topic-list">
                {availableTopics.slice(0, 5).map((topic) => (
                  <button className="client-topic-row" type="button" key={topic.file} onClick={() => requestTopic(topic)}>
                    <span className="client-topic-dot" />
                    <span>{topic.topic}</span>
                    <small>{topic.count} питань</small>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {view === "topics" && (
          <section className="client-section client-topics-page">
            <button className="client-back-link" type="button" onClick={() => setView("home")}>
              ← Головна
            </button>
            <p className="client-eyebrow">Почати тренування</p>
            <h1>Обери тему</h1>
            <p className="client-lead">У темі потрібно відповісти на всі питання. Результат збережеться на цьому пристрої.</p>
            <label className="client-search">
              <span className="sr-only">Пошук тем</span>
              <input
                type="search"
                placeholder="Знайти тему…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {loading ? (
              <p className="client-loading" role="status">Завантажуємо теми…</p>
            ) : (
              <div className="client-topic-grid">
                {visibleTopics.map((topic) => {
                  const available = isTopicAvailable(topic);
                  const topicId = topic.file.replace(/\.json$/, "");
                  const progress = topicProgress[topicId];
                  const completed = progress?.status === "completed";
                  return (
                    <button
                      className={`client-topic-card${available ? "" : " is-unavailable"}${completed ? " is-completed" : ""}`}
                      type="button"
                      key={topic.file}
                      disabled={!available || loadingTopic}
                      onClick={() => requestTopic(topic)}
                    >
                      <span className="client-topic-card-title">{topic.topic}</span>
                      <span className="client-topic-card-meta">
                        {available ? `${topic.count} питань` : "У розробці"}
                        {completed && ` · ${progress.percent}% завершено`}
                      </span>
                      <span className="client-topic-card-arrow" aria-hidden="true">{available ? "↗" : "🔒"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {view === "tickets" && (
          <section className="client-section client-topics-page">
            <button className="client-back-link" type="button" onClick={() => setView("home")}>← Головна</button>
            <p className="client-eyebrow">Підготовка до іспиту</p>
            <h1>Тести за білетами</h1>
            <p className="client-lead">Усі доступні питання розподілені між білетами. У кожному — 19–20 питань.</p>
            {tickets ? (
              <>
                <p className="client-ticket-summary">
                  {tickets.length} білетів · {tickets.reduce((total, ticket) => total + ticket.length, 0).toLocaleString("uk-UA")} питань
                </p>
                <div className="client-ticket-grid">
                  {tickets.map((ticket, index) => {
                    const number = index + 1;
                    const progress = ticketProgress[number];
                    return (
                      <button
                        className={`client-ticket-card${progress?.passed ? " is-passed" : progress ? " is-attempted" : ""}`}
                        type="button"
                        key={number}
                        disabled={loadingTopic}
                        onClick={() => requestTicket(number)}
                      >
                        <span className="client-ticket-number">{String(number).padStart(2, "0")}</span>
                        <span className="client-ticket-title">Білет {number}</span>
                        <span className="client-ticket-count">{ticket.length} питань</span>
                        {progress && (
                          <span className="client-ticket-status">
                            {progress.passed ? "✓ Складено" : "Не складено"} · {progress.mistakes} помилок
                          </span>
                        )}
                        <span className="client-ticket-arrow" aria-hidden="true">↗</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : loadingTopic ? (
              <p className="client-loading" role="status">Формуємо білети з доступних питань…</p>
            ) : (
              <button className="client-primary" type="button" onClick={() => void openTickets()}>Завантажити білети</button>
            )}
          </section>
        )}

        {view === "saved" && (
          <section className="client-section client-topics-page">
            <button className="client-back-link" type="button" onClick={() => setView("home")}>← Головна</button>
            <div className="client-saved-heading">
              <div>
                <p className="client-eyebrow">Твоя добірка</p>
                <h1>Збережені питання</h1>
                <p className="client-lead">{savedQuestions.length} питань збережено на цьому пристрої.</p>
              </div>
              {savedQuestions.length > 0 && (
                <div className="client-saved-actions">
                  <button className="client-primary" type="button" onClick={requestSavedTest}>Почати тренування <span aria-hidden="true">→</span></button>
                  <button className="client-text-button" type="button" onClick={() => setConfirmClearSaved(true)}>Очистити список</button>
                </div>
              )}
            </div>
            {savedQuestions.length === 0 ? (
              <div className="client-empty-state">
                <h2>Поки немає збережених питань</h2>
                <p>Під час тесту натисни «Зберегти питання», щоб додати його сюди.</p>
                <button className="client-secondary" type="button" onClick={() => setView("topics")}>Обрати тему</button>
              </div>
            ) : (
              <div className="client-saved-list">
                {savedQuestions.map((question) => {
                  const expanded = expandedSavedId === question.id;
                  return (
                    <article className={`client-saved-item${expanded ? " is-open" : ""}`} key={question.id}>
                      <button
                        className="client-saved-toggle"
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setExpandedSavedId(expanded ? null : question.id)}
                      >
                        <span>
                          <small>{question.topic} · {question.id}</small>
                          <strong>{question.question}</strong>
                        </span>
                        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                      </button>
                      {expanded && (
                        <div className="client-saved-details">
                          {question.image && <QuestionImage key={question.id} question={question} loading="lazy" />}
                          <ol className="client-saved-answers" type="A">
                            {question.answers.map((answer, index) => (
                              <li className={index === question.correctAnswer ? "is-correct" : ""} key={`${question.id}-${index}`}>
                                {answer}
                              </li>
                            ))}
                          </ol>
                          <button className="client-text-button" type="button" onClick={() => removeSavedQuestion(question.id)}>Видалити зі збережених</button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {view === "results" && (
          <section className="client-section client-topics-page">
            <button className="client-back-link" type="button" onClick={() => setView("home")}>← Головна</button>
            <p className="client-eyebrow">Аналітика</p>
            <h1>Твоя статистика</h1>
            {history.length === 0 ? (
              <div className="client-empty-state">
                <h2>Ще немає завершених тестів</h2>
                <p>Пройди перший тест, щоб побачити статистику.</p>
                <button className="client-primary" type="button" onClick={() => requestMode("random")}>Почати тест <span aria-hidden="true">→</span></button>
              </div>
            ) : (
              <>
                <p className="client-lead">Пройдено {history.length} тестів. Результати збережено на цьому пристрої.</p>
                <div className="client-results-stats">
                  <article><span>Всього тестів</span><strong>{history.length}</strong></article>
                  <article><span>Всього питань</span><strong>{resultStats.totalQuestions}</strong></article>
                  <article><span>Правильних відповідей</span><strong>{resultStats.totalCorrect}</strong></article>
                  <article><span>Іспитів складено / не складено</span><strong>{resultStats.passedExams} / {resultStats.failedExams}</strong></article>
                  <article><span>Помилок у тестах</span><strong>{resultStats.totalErrors}</strong></article>
                  <article><span>Питань для повторення</span><strong>{errors.length}</strong></article>
                </div>
                <section className="client-weekly-stats" aria-labelledby="weekly-stats-title">
                  <p className="client-eyebrow">Останні 7 днів</p>
                  <h2 id="weekly-stats-title">Ритм підготовки</h2>
                  <div className="client-chart-legend">
                    <span><i className="is-topic" />За темами</span>
                    <span><i className="is-ticket" />Білети</span>
                    <span><i className="is-exam" />Іспити</span>
                    <span><i className="is-total" />Усього</span>
                    <span><i className="is-failed" />Не складено</span>
                  </div>
                  <div className="client-weekly-chart" role="img" aria-label="Кількість пройдених тестів за типом у кожен день за останні сім днів">
                    {weeklyStats.map((day) => {
                      const label = new Intl.DateTimeFormat("uk-UA", { weekday: "short", day: "numeric", month: "short" }).format(day.date);
                      const bars = [
                        ["topic", day.topic],
                        ["ticket", day.tickets],
                        ["exam", day.exams],
                        ["total", day.total],
                        ["failed", day.failed],
                      ] as const;
                      return (
                        <div className="client-chart-day" key={getLocalDateKey(day.date)} aria-label={`${label}: ${day.total} тестів, ${day.failed} іспитів не складено`}>
                          <div className="client-chart-bars">
                            {bars.map(([kind, count]) => (
                              <span
                                className={`is-${kind}`}
                                key={kind}
                                title={`${kind}: ${count}`}
                                style={{ height: `${Math.max(count ? 8 : 2, count / weeklyMaximum * 100)}%` }}
                              />
                            ))}
                          </div>
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </section>
        )}

        {view === "errors" && (
          <section className="client-section client-topics-page">
            <button className="client-back-link" type="button" onClick={() => setView("home")}>← Головна</button>
            <p className="client-eyebrow">Повторення</p>
            <h1>Мої помилки</h1>
            <p className="client-lead">{errors.length} питань для повторення.</p>
            {errors.length > 0 && (
              <button className="client-primary client-errors-start" type="button" onClick={() => requestMode("mistakes")}>
                Почати повторення <span aria-hidden="true">→</span>
              </button>
            )}
            {loadingTopic ? (
              <p className="client-loading" role="status">Завантажуємо питання для повторення…</p>
            ) : errorQuestions.length ? (
              <div className="client-error-list">
                {errorQuestions.map((question) => (
                  <article className="client-error-item" key={question.id}>
                    <p className="client-eyebrow">{question.topic} · {question.id}</p>
                    <h2>{question.question}</h2>
                    {question.image && <QuestionImage key={question.id} question={question} loading="lazy" />}
                    <ol className="client-saved-answers" type="A">
                      {question.answers.map((answer, index) => (
                        <li className={index === question.correctAnswer ? "is-correct" : ""} key={`${question.id}-${index}`}>{answer}</li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            ) : (
              <div className="client-empty-state">
                <h2>Помилок немає</h2>
                <p>Тут з’являться питання, у яких ти помилишся.</p>
              </div>
            )}
          </section>
        )}

        {view === "settings" && (
          <section className="client-section client-topics-page">
            <button className="client-back-link" type="button" onClick={() => setView("home")}>← Головна</button>
            <p className="client-eyebrow">Персоналізація</p>
            <h1>Режим відповіді</h1>
            <p className="client-lead">Обери, як показувати результат після вибору відповіді. Налаштування збережеться на цьому пристрої.</p>
            <fieldset className="client-answer-modes">
              <legend className="sr-only">Режим відповіді</legend>
              <label className={answerMode === "instant" ? "is-selected" : ""}>
                <input type="radio" name="client-answer-mode" value="instant" checked={answerMode === "instant"} onChange={() => changeAnswerMode("instant")} />
                <span><strong>Миттєва перевірка</strong><small>Після вибору відповіді одразу покажемо, чи вона правильна.</small></span>
              </label>
              <label className={answerMode === "check" ? "is-selected" : ""}>
                <input type="radio" name="client-answer-mode" value="check" checked={answerMode === "check"} onChange={() => changeAnswerMode("check")} />
                <span><strong>Спочатку перевірити</strong><small>Обери відповідь і підтверди її кнопкою «Перевірити». Вибір можна змінити до підтвердження.</small></span>
              </label>
              <label className={answerMode === "auto-correct" ? "is-selected" : ""}>
                <input type="radio" name="client-answer-mode" value="auto-correct" checked={answerMode === "auto-correct"} onChange={() => changeAnswerMode("auto-correct")} />
                <span><strong>Автоперехід після правильної відповіді</strong><small>Правильна відповідь автоматично веде далі; після помилки можна продовжити самостійно.</small></span>
              </label>
            </fieldset>
          </section>
        )}

        {view === "feedback" && (
          <section className="client-section client-topics-page">
            <button className="client-back-link" type="button" onClick={() => setView("home")}>← Головна</button>
            <p className="client-eyebrow">Ми на зв’язку</p>
            <h1>Є питання, скарга чи пропозиція?</h1>
            <p className="client-lead">Напиши, що допоможе зробити Roadwise кращим. Можна залишитися анонімно або додати контакт для відповіді.</p>
            <form className="client-feedback-form" onSubmit={(event) => void submitFeedback(event)}>
              <label htmlFor="client-feedback-message">Ваше повідомлення</label>
              <textarea id="client-feedback-message" rows={7} maxLength={2000} required value={feedbackMessage} onChange={(event) => setFeedbackMessage(event.target.value)} placeholder="Розкажіть, що трапилося або що варто покращити" />
              <label htmlFor="client-feedback-contact">Контакт для відповіді <span>необов’язково</span></label>
              <input id="client-feedback-contact" type="text" maxLength={200} value={feedbackContact} onChange={(event) => setFeedbackContact(event.target.value)} placeholder="Telegram, email або телефон" />
              <button className="client-primary" type="submit" disabled={feedbackSending || !feedbackMessage.trim()}>{feedbackSending ? "Надсилаємо…" : "Надіслати повідомлення"} <span aria-hidden="true">→</span></button>
              {feedbackStatus && <p className={`client-form-status${feedbackStatus.startsWith("Дякуємо") ? " is-success" : feedbackSending ? "" : " is-error"}`} role="status">{feedbackStatus}</p>}
            </form>
          </section>
        )}

        {view === "quiz" && currentQuestion && (selectedMode !== "topic" || selectedTopic) && (
          <section className="client-quiz">
            <div className="client-quiz-header">
              <button className="client-back-link" type="button" onClick={selectedMode === "topic" ? returnToTopics : returnToCurrentList}>
                {selectedMode === "topic" ? "← Список тем" : selectedMode === "ticket" ? "← Список білетів" : selectedMode === "saved" ? "← Збережені питання" : "← Головна"}
              </button>
              <span>{modeLabel}</span>
              {["random", "ticket"].includes(selectedMode) && timerStartedAt !== null && (
                <button className={`client-quiz-timer${timerHidden ? " is-hidden" : ""}`} type="button" aria-pressed={timerHidden} aria-label={timerHidden ? "Показати таймер" : "Приховати таймер"} onClick={toggleTimerVisibility}>
                  <span aria-hidden="true">◷</span>
                  {timerHidden ? "Час приховано" : formatDuration(timerNow - timerStartedAt)}
                </button>
              )}
            </div>
            <div className="client-quiz-progress">
              <div className="client-progress-track">
                <span style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
              </div>
              <div className="client-quiz-meta">
                <span>Помилки: {incorrectCount} / Відповіді: {answeredCount} / {questions.length}</span>
                <span>Питання {currentIndex + 1} з {questions.length}</span>
              </div>
            </div>
            <div className="client-question-nav" aria-label="Навігація питаннями">
              {questions.map((question, index) => {
                const isCorrect = question.userAnswer === question.correctAnswer;
                const answered = question.userAnswer !== undefined;
                return (
                  <button
                    className={`${index === currentIndex ? "is-current" : ""}${answered ? (isCorrect ? " is-correct" : " is-wrong") : ""}`}
                    type="button"
                    key={question.id}
                    onClick={() => goToQuestion(index)}
                    aria-label={`Питання ${index + 1}${answered ? (isCorrect ? ", правильно" : ", помилка") : ""}`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
            <article className="client-question-card">
              <div className="client-question-label">
                <span>{currentQuestion.topic}</span>
                <span>{currentQuestion.id}</span>
              </div>
              <h1>{currentQuestion.question}</h1>
              {currentQuestion.image && <QuestionImage key={currentQuestion.id} question={currentQuestion} />}
              <button
                className={`client-save-question${savedQuestions.some((question) => question.id === currentQuestion.id) ? " is-saved" : ""}`}
                type="button"
                aria-pressed={savedQuestions.some((question) => question.id === currentQuestion.id)}
                onClick={() => toggleSavedQuestion(currentQuestion)}
              >
                {savedQuestions.some((question) => question.id === currentQuestion.id) ? "✓ Збережено" : "☆ Зберегти питання"}
              </button>
              <button className="client-text-button client-report-question" type="button" onClick={() => { setReportMessage(""); setReportStatus(""); setShowReportModal(true); }}>
                Повідомити про помилку в питанні
              </button>
              <div className="client-answers">
                {currentQuestion.answers.map((answer, index) => {
                  const answered = currentQuestion.userAnswer !== undefined;
                  const selectedAnswer = answered ? currentQuestion.userAnswer : currentQuestion.pendingAnswer;
                  const selected = selectedAnswer === index;
                  const isCorrectAnswer = index === currentQuestion.correctAnswer;
                  const showCorrect = answered && currentQuestion.showCorrectAnswer && isCorrectAnswer;
                  const answerState = answered
                    ? selected ? (isCorrectAnswer ? "is-correct" : "is-wrong") : showCorrect ? "is-correct is-revealed" : ""
                    : selected ? "is-selected" : "";
                  return (
                    <button
                      className={`client-answer ${answerState}`}
                      type="button"
                      key={`${currentQuestion.id}-${index}`}
                      disabled={answered}
                      aria-pressed={selected}
                      onClick={() => answerQuestion(index)}
                    >
                      <span>{String.fromCharCode(65 + index)}</span>
                      <span>{answer}</span>
                    </button>
                  );
                })}
              </div>
              {currentQuestion.userAnswer !== undefined &&
                currentQuestion.userAnswer !== currentQuestion.correctAnswer &&
                !currentQuestion.showCorrectAnswer && (
                  <button className="client-text-button client-correct-answer" type="button" onClick={showCorrectAnswer}>
                    Показати правильну відповідь
                  </button>
                )}
              <div className="client-quiz-actions">
                {answerMode === "check" && currentQuestion.userAnswer === undefined && (
                  <button
                    className="client-primary"
                    type="button"
                    disabled={currentQuestion.pendingAnswer === undefined}
                    onClick={() => {
                      if (currentQuestion.pendingAnswer !== undefined) recordAnswer(currentQuestion.pendingAnswer);
                    }}
                  >
                    Перевірити відповідь
                  </button>
                )}
                {currentQuestion.userAnswer !== undefined && (
                  <button className="client-primary" type="button" onClick={nextQuestion}>
                    {currentIndex === questions.length - 1 ? "Завершити тест" : "Наступне питання"} <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </article>
          </section>
        )}

        {view === "result" && result && (
          <section className="client-result">
            <p className="client-eyebrow">Результат тренування</p>
            <h1>{Math.round((result.correct / result.total) * 100)}%</h1>
            <h2>
              {result.passed
                ? selectedMode === "random" ? "Іспит складено!" : selectedMode === "ticket" ? "Білет складено!" : "Тему пройдено!"
                : selectedMode === "random" || selectedMode === "ticket" ? "Іспит не складено." : "Є над чим попрацювати."}
            </h2>
            <p>Правильних відповідей: {result.correct} з {result.total}. Результат збережено локально.</p>
            {result.durationMs !== null && (
              <p>Час складання: {`${String(Math.floor(result.durationMs / 60000)).padStart(2, "0")}:${String(Math.floor((result.durationMs % 60000) / 1000)).padStart(2, "0")}`}</p>
            )}
            {missedQuestions.length > 0 && (
              <section className="client-result-review" aria-labelledby="result-review-title">
                <p className="client-eyebrow">Робота над помилками</p>
                <h3 id="result-review-title">Питання для повторення · {missedQuestions.length}</h3>
                <div className="client-result-review-list">
                  {missedQuestions.map((question) => (
                    <article className="client-result-review-item" key={question.id}>
                      <p className="client-eyebrow">{question.topic} · {question.id}</p>
                      <h4>{question.question}</h4>
                      {question.image && <QuestionImage key={question.id} question={question} />}
                      <p className="client-result-review-answer is-wrong">
                        Твоя відповідь: {question.userAnswer === undefined ? "Без відповіді" : question.answers[question.userAnswer] ?? "Невідомий варіант"}
                      </p>
                      <p className="client-result-review-answer is-correct">
                        Правильна відповідь: {question.correctAnswer === null ? "не визначена" : question.answers[question.correctAnswer] ?? "не знайдена"}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <div className="client-result-actions">
              {selectedMode === "topic" && selectedTopic && (
                <>
                  <button className="client-primary" type="button" onClick={() => requestTopic(selectedTopic)}>
                    Пройти ще раз <span aria-hidden="true">↻</span>
                  </button>
                  <button className="client-secondary" type="button" onClick={returnToTopics}>До списку тем</button>
                </>
              )}
              {selectedMode === "random" && <button className="client-primary" type="button" onClick={() => requestMode("random")}>Ще один іспит <span aria-hidden="true">↻</span></button>}
              {selectedMode === "ticket" && selectedTicket !== null && <button className="client-primary" type="button" onClick={() => requestTicket(selectedTicket)}>Пройти білет ще раз <span aria-hidden="true">↻</span></button>}
              {selectedMode === "mistakes" && errors.length > 0 && <button className="client-primary" type="button" onClick={() => requestMode("mistakes")}>Повторити помилки <span aria-hidden="true">↻</span></button>}
              {selectedMode === "saved" && savedQuestions.length > 0 && <button className="client-primary" type="button" onClick={requestSavedTest}>Повторити збережені <span aria-hidden="true">↻</span></button>}
              {selectedMode === "ticket" && <button className="client-secondary" type="button" onClick={() => void openTickets()}>До білетів</button>}
              {selectedMode === "saved" && <button className="client-secondary" type="button" onClick={() => setView("saved")}>До збережених</button>}
              <button className="client-secondary" type="button" onClick={() => setView("home")}>На головну</button>
            </div>
            <button className="client-secondary client-share-result" type="button" disabled={shareSending} onClick={() => void shareTestResult()}>
              {shareSending ? "Готуємо картку…" : "Поділитися результатом"}
            </button>
            {shareStatus && <p className="client-form-status" role="status">{shareStatus}</p>}
          </section>
        )}
      </main>
      {loadingTopic && <div className="client-loading-overlay" role="status">Завантажуємо питання…</div>}
      {(pendingTopic || pendingTicket !== null) && interruptedTest && (
        <div className="client-modal-backdrop">
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="resume-title">
            <p className="client-eyebrow">Незавершений тест</p>
            <h2 id="resume-title">Продовжити чи почати новий?</h2>
            <p>
              Залишився {getTestLabel(interruptedTest)}.
              Початок нового тесту замінить збережений прогрес.
            </p>
            <div className="client-modal-actions">
              <button className="client-primary" type="button" onClick={resumeInterruptedTest}>Продовжити</button>
              <button className="client-secondary" type="button" onClick={startPendingTest}>Почати новий</button>
              <button className="client-text-button" type="button" onClick={() => { setPendingTopic(null); setPendingTicket(null); }}>Скасувати</button>
            </div>
          </section>
        </div>
      )}
      {pendingMode && interruptedTest && pendingTopic === null && pendingTicket === null && (
        <div className="client-modal-backdrop">
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="resume-mode-title">
            <p className="client-eyebrow">Незавершений тест</p>
            <h2 id="resume-mode-title">Продовжити чи почати інший?</h2>
            <p>
              Залишився {getTestLabel(interruptedTest)}.
            </p>
            <div className="client-modal-actions">
              <button className="client-primary" type="button" onClick={resumeInterruptedTest}>Продовжити</button>
              <button className="client-secondary" type="button" onClick={startPendingTest}>Почати новий</button>
              <button className="client-text-button" type="button" onClick={() => setPendingMode(null)}>Скасувати</button>
            </div>
          </section>
        </div>
      )}
      {showCategoryPicker && (
        <div className="client-modal-backdrop">
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="category-title">
            <p className="client-eyebrow">Підготовка до іспиту</p>
            <h2 id="category-title">Яку категорію складаєш?</h2>
            <p>До тесту увійдуть загальні питання та додаткові питання вибраної категорії.</p>
            <label className="client-category-label" htmlFor="random-category">
              Категорія посвідчення
            </label>
            <select
              id="random-category"
              className="client-category-select"
              value={categoryChoice}
              onChange={(event) => setCategoryChoice(event.target.value as RandomCategory | "")}
            >
              <option value="">Оберіть категорію</option>
              {Object.entries(RANDOM_TEST_CATEGORIES).map(([key, category]) => (
                <option value={key} key={key}>{category.label}</option>
              ))}
            </select>
            <label className="client-remember-category">
              <input type="checkbox" checked={rememberCategory} onChange={(event) => setRememberCategory(event.target.checked)} />
              Запам’ятати і більше не питати
            </label>
            <div className="client-modal-actions">
              <button
                className="client-primary"
                type="button"
                disabled={!categoryChoice}
                onClick={() => {
                  if (!categoryChoice) return;
                  const category = categoryChoice;
                  setShowCategoryPicker(false);
                  void startMode("random", category);
                }}
              >
                Почати тест <span aria-hidden="true">→</span>
              </button>
              <button className="client-text-button" type="button" onClick={() => setShowCategoryPicker(false)}>Скасувати</button>
            </div>
          </section>
        </div>
      )}
      {examFailedPrompt && selectedMode === "random" && (
        <div className="client-modal-backdrop">
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="exam-failed-title">
            <p className="client-eyebrow">Пробний іспит</p>
            <h2 id="exam-failed-title">Іспит не складено</h2>
            <p>
              За правилами іспиту допускається не більше двох помилок. Ви вже відповіли неправильно на {incorrectCount} питань.
              Можна продовжити — усі питання будуть зараховані до результату.
            </p>
            <div className="client-modal-actions">
              <button className="client-primary" type="button" onClick={() => setExamFailedPrompt(false)}>Продовжити тест</button>
            </div>
          </section>
        </div>
      )}
      {showReportModal && currentQuestion && (
        <div className="client-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !reportSending) setShowReportModal(false); }}>
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="report-question-title">
            <p className="client-eyebrow">Зворотний зв’язок</p>
            <h2 id="report-question-title">Що не так із питанням?</h2>
            <p className="client-reported-question"><strong>{currentQuestion.id}</strong> · {currentQuestion.question}</p>
            <form className="client-feedback-form" onSubmit={(event) => void submitQuestionReport(event)}>
              <label htmlFor="client-report-message">Опишіть помилку</label>
              <textarea id="client-report-message" rows={4} maxLength={1000} required value={reportMessage} onChange={(event) => setReportMessage(event.target.value)} placeholder="Наприклад: правильна відповідь не збігається з ПДР" />
              <button className="client-primary" type="submit" disabled={reportSending || !reportMessage.trim()}>{reportSending ? "Надсилаємо…" : "Надіслати повідомлення"} <span aria-hidden="true">→</span></button>
              {reportStatus && <p className={`client-form-status${reportStatus.startsWith("Дякуємо") ? " is-success" : reportSending ? "" : " is-error"}`} role="status">{reportStatus}</p>}
              <button className="client-text-button" type="button" disabled={reportSending} onClick={() => setShowReportModal(false)}>Закрити</button>
            </form>
          </section>
        </div>
      )}
      {ticketsIntroOpen && (
        <div className="client-modal-backdrop">
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="tickets-intro-title">
            <p className="client-eyebrow">Нове у Roadwise</p>
            <h2 id="tickets-intro-title">Зустрічай тести за білетами</h2>
            <p>Усі доступні питання розподілено на білети по 19–20 питань. Проходь їх у будь-якому порядку й повторюй, коли зручно.</p>
            <div className="client-modal-actions">
              <button className="client-primary" type="button" onClick={() => { closeTicketsIntro(); void openTickets(); }}>Спробувати білети <span aria-hidden="true">→</span></button>
              <button className="client-secondary" type="button" onClick={closeTicketsIntro}>Можливо, пізніше</button>
            </div>
          </section>
        </div>
      )}
      {ratingOpen && (
        <div className="client-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setRatingOpen(false); }}>
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="rating-title">
            <p className="client-eyebrow">Roadwise розвивається</p>
            <h2 id="rating-title">Як тобі тут?</h2>
            <p>Ми наповнюємо базу, розширюємо функціонал і швидко виправляємо помилки. Твоя оцінка допоможе зрозуміти, чи рухаємось у правильному напрямку.</p>
            <div className="client-rating-stars" role="radiogroup" aria-label="Оцінка від 1 до 5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button className={value <= rating ? "is-selected" : ""} type="button" role="radio" aria-checked={value === rating} aria-label={`${value} з 5`} key={value} onClick={() => { setRating(value); setRatingStatus(""); }}>★</button>
              ))}
            </div>
            <p className={`client-form-status${ratingStatus.startsWith("Дякуємо") ? " is-success" : " is-error"}`} role="status">{ratingStatus || (rating ? `Обрано: ${rating} з 5` : "Обери оцінку від 1 до 5")}</p>
            <div className="client-modal-actions">
              <button className="client-primary" type="button" disabled={!rating} onClick={() => void confirmRating()}>Підтвердити</button>
              <button className="client-text-button" type="button" onClick={() => setRatingOpen(false)}>Закрити</button>
            </div>
          </section>
        </div>
      )}
      {surveyOpen && (
        <div className="client-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !surveySending) closeTargetedSurvey(); }}>
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="targeted-survey-title">
            {surveyIndex >= targetedSurveyQuestions.length ? (
              <>
                <p className="client-eyebrow">Дякуємо за чесність</p>
                <h2 id="targeted-survey-title">Тепер знаємо, куди їхати далі</h2>
                <p>Твої відповіді вже допомагають зробити Roadwise кращим.</p>
                <div className="client-modal-actions"><button className="client-primary" type="button" onClick={() => setSurveyOpen(false)}>Готово</button></div>
              </>
            ) : (() => {
              const question = targetedSurveyQuestions[surveyIndex];
              return (
                <>
                  <p className="client-eyebrow">Питання {surveyIndex + 1} з {targetedSurveyQuestions.length}</p>
                  <h2 id="targeted-survey-title">{question.title}</h2>
                  <form className="client-survey-form" onSubmit={(event) => void submitTargetedSurveyAnswer(event)}>
                    {question.type === "slider" ? (
                      <div className="client-survey-slider">
                        <strong>{surveyAnswer || "5"}</strong>
                        <input type="range" min="0" max="10" step="1" value={surveyAnswer || "5"} aria-label="Оцінка від 0 до 10" onChange={(event) => setSurveyAnswer(event.target.value)} />
                        <div><span>Зовсім ні</span><span>Точно так</span></div>
                      </div>
                    ) : (
                      <div className={question.type === "stars" ? "client-survey-options is-stars" : "client-survey-options"}>
                        {question.options.map((option) => (
                          <button
                            className={surveyAnswer === option ? "is-selected" : ""}
                            type="button"
                            key={option}
                            aria-pressed={surveyAnswer === option}
                            onClick={() => setSurveyAnswer(option)}
                          >
                            {question.type === "stars" ? "★" : option}
                          </button>
                        ))}
                        {question.type === "choice-other" && (
                          <button className={surveyAnswer === "Інше" ? "is-selected" : ""} type="button" aria-pressed={surveyAnswer === "Інше"} onClick={() => setSurveyAnswer("Інше")}>Інше</button>
                        )}
                      </div>
                    )}
                    {question.type === "choice-other" && surveyAnswer === "Інше" && (
                      <textarea rows={3} maxLength={1000} value={surveyOtherAnswer} onChange={(event) => setSurveyOtherAnswer(event.target.value)} aria-label="Уточни, будь ласка" placeholder="Твій варіант" />
                    )}
                    {surveyStatus && <p className="client-form-status is-error" role="status">{surveyStatus}</p>}
                    <div className="client-modal-actions">
                      <button className="client-primary" type="submit" disabled={surveySending || (question.type !== "slider" && !surveyAnswer) || (question.type === "choice-other" && surveyAnswer === "Інше" && !surveyOtherAnswer.trim())}>
                        {surveySending ? "Надсилаємо…" : "Надіслати відповідь"}
                      </button>
                      <button className="client-text-button" type="button" disabled={surveySending} onClick={closeTargetedSurvey}>Закрити</button>
                    </div>
                  </form>
                </>
              );
            })()}
          </section>
        </div>
      )}
      {confirmClearSaved && (
        <div className="client-modal-backdrop">
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="clear-saved-title">
            <p className="client-eyebrow">Підтвердження дії</p>
            <h2 id="clear-saved-title">Очистити збережені питання?</h2>
            <p>Буде видалено {savedQuestions.length} питань. Відновити список не вдасться.</p>
            <div className="client-modal-actions">
              <button className="client-primary" type="button" onClick={clearSavedQuestions}>Очистити</button>
              <button className="client-secondary" type="button" onClick={() => setConfirmClearSaved(false)}>Скасувати</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
