const $ = (selector) => document.querySelector(selector);
const accessPanel = $("#access-panel");
const accessMessage = $("#access-message");
const accessButton = $("#access-button");
const dashboardContent = $("#dashboard-content");
const refreshButton = $("#refresh-button");
let analyticsKey = "";
let analyticsData = null;
let selectedVisitorId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatNumber(value) {
  return new Intl.NumberFormat("uk-UA").format(value || 0);
}

function formatDate(value, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function dayLabel(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function formatPercent(value) {
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}

function renderSummary(data) {
  const visitors = data.visitors || [];
  const repeatVisitors = visitors.filter((visitor) => visitor.activeDays >= 2).length;

  const cards = [
    ["Унікальні користувачі", data.totalUniqueVisitors, "За весь період"],
    ["Постійні користувачі", repeatVisitors, "Активність у 2+ різні дні"],
    ["Перегляди сторінок", data.totalPageViews, "Усього"],
    ["Завершення тестів", `${formatNumber(data.totalTestsCompleted)} / ${formatNumber(data.totalTestStarts)}`, `Завершення від розпочатих: ${data.completionRate}%`]
  ];
  $("#summary-cards").innerHTML = cards.map(([label, value, note]) => `
    <article class="summary-card"><span>${escapeHtml(label)}</span><strong>${typeof value === "number" ? formatNumber(value) : value}</strong><small>${escapeHtml(note)}</small></article>
  `).join("");

  const neverStarted = visitors.filter((visitor) => visitor.testStarts === 0).length;
  const neverCompleted = visitors.filter((visitor) => visitor.testsCompleted === 0).length;
  const completedUpToFive = visitors.filter((visitor) => visitor.testsCompleted >= 1 && visitor.testsCompleted <= 5).length;
  const completedMoreThanFive = visitors.filter((visitor) => visitor.testsCompleted > 5).length;
  const segments = [
    ["Не починали тести", neverStarted, "0 розпочатих тестів"],
    ["Не завершили жодного", neverCompleted, "0 завершених тестів"],
    ["Завершили 1–5 тестів", completedUpToFive, "Від 1 до 5 включно"],
    ["Завершили понад 5", completedMoreThanFive, "6 або більше тестів"]
  ];
  $("#segments").innerHTML = segments.map(([label, value, note]) => `
    <article class="segment-card"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong><small>${escapeHtml(note)}</small></article>
  `).join("");
}

function renderVisitors(data) {
  const visitors = (data.visitors || []).filter((visitor) => visitor.testsCompleted > 0);
  const query = $("#visitor-search").value.trim().toLowerCase();
  const filteredVisitors = visitors.filter((visitor) => visitor.id.toLowerCase().includes(query));
  $("#visitor-count").textContent = `${formatNumber(filteredVisitors.length)} із ${formatNumber(visitors.length)} користувачів`;
  $("#visitors-table").innerHTML = filteredVisitors.length
    ? filteredVisitors.map((visitor) => `
      <tr>
        <td class="visitor-id" title="${escapeHtml(visitor.id)}">${escapeHtml(visitor.id.slice(0, 12))}…</td>
        <td>${formatDate(visitor.lastSeen, true)}</td>
        <td>${formatNumber(visitor.visits)}</td>
        <td>${formatNumber(visitor.activeDays)}</td>
        <td>${formatNumber(visitor.currentStreak)} / ${formatNumber(visitor.bestStreak)} дн.</td>
        <td>${formatNumber(visitor.testStarts)}</td>
        <td>${formatNumber(visitor.testsCompleted)}</td>
        <td><button class="details-button" type="button" data-visitor-id="${escapeHtml(visitor.id)}">Деталі</button></td>
      </tr>
    `).join("")
    : '<tr><td class="empty-row" colspan="8">Користувачів не знайдено.</td></tr>';
  renderVisitorDetails();
}

function renderVisitorDetails() {
  const panel = $("#visitor-details");
  const visitor = analyticsData?.visitors?.find((item) => item.id === selectedVisitorId);
  if (!visitor) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  const dates = Object.entries(visitor.activityByDay || {}).sort(([first], [second]) => second.localeCompare(first));
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <h3>Активність користувача</h3>
    <p><span class="visitor-id">${escapeHtml(visitor.id)}</span> · перший візит: ${escapeHtml(formatDate(visitor.firstSeen, true))} · активних днів: ${formatNumber(visitor.activeDays)} · найкращий стрік: ${formatNumber(visitor.bestStreak)} днів</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Дата</th><th>Відвідування</th><th>Тести розпочато</th><th>Тести завершено</th><th>Дані</th></tr></thead>
        <tbody>${dates.map(([date, activity]) => `
          <tr>
            <td>${escapeHtml(dayLabel(date))}</td>
            <td>${activity.views === null ? "—" : formatNumber(activity.views)}</td>
            <td>${activity.testStarts === null ? "—" : formatNumber(activity.testStarts)}</td>
            <td>${activity.testsCompleted === null ? "—" : formatNumber(activity.testsCompleted)}</td>
            <td>${activity.recorded ? "Точні лічильники" : "Лише факт активності"}</td>
          </tr>
        `).join("") || '<tr><td class="empty-row" colspan="5">Немає даних про активні дні.</td></tr>'}</tbody>
      </table>
    </div>`;
}

function renderMonthly(data) {
  const days = Object.entries(data.daily || {}).sort(([first], [second]) => second.localeCompare(first));
  const monthlyTable = $("#monthly-table");
  if (!days.length) {
    monthlyTable.innerHTML = '<tr><td class="empty-row" colspan="5">Поки немає даних.</td></tr>';
    return;
  }

  const firstDate = days[days.length - 1][0];
  const lastDate = days[0][0];
  const firstTimestamp = Date.parse(`${firstDate}T00:00:00Z`);
  const lastTimestamp = Date.parse(`${lastDate}T00:00:00Z`);
  const dailyActivity = data.daily;
  const monthlyTotals = new Map();
  for (let timestamp = firstTimestamp; timestamp <= lastTimestamp; timestamp += 86_400_000) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const month = date.slice(0, 7);
    const activity = dailyActivity[date] || {};
    const total = monthlyTotals.get(month) || { days: 0, visitors: 0, testStarts: 0, testsCompleted: 0 };
    total.days += 1;
    total.visitors += activity.uniqueVisitors || 0;
    total.testStarts += activity.testStarts || 0;
    total.testsCompleted += activity.testsCompleted || 0;
    monthlyTotals.set(month, total);
  }

  const allTime = [...monthlyTotals.values()].reduce((total, month) => ({
    days: total.days + month.days,
    visitors: total.visitors + month.visitors,
    testStarts: total.testStarts + month.testStarts,
    testsCompleted: total.testsCompleted + month.testsCompleted
  }), { days: 0, visitors: 0, testStarts: 0, testsCompleted: 0 });
  const summaryRows = [
    ["Увесь період", allTime],
    ...[...monthlyTotals.entries()].sort(([first], [second]) => second.localeCompare(first))
      .map(([month, totals]) => [new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${month}-01T00:00:00Z`)), totals])
  ];
  monthlyTable.innerHTML = summaryRows.map(([label, totals]) => {
    const completionRate = totals.testStarts ? totals.testsCompleted / totals.testStarts * 100 : null;
    const completionClass = completionRate !== null && completionRate > 90 ? "completion-high" : "";
    return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${formatNumber(Math.round(totals.visitors / totals.days))}</td>
        <td>${formatNumber(totals.testStarts)}</td>
        <td>${formatNumber(totals.testsCompleted)}</td>
        <td class="${completionClass}">${completionRate === null ? "—" : formatPercent(completionRate)}</td>
      </tr>
    `;
  }).join("");
}

function renderDays(data) {
  const days = Object.entries(data.daily || {}).sort(([first], [second]) => second.localeCompare(first));
  $("#days-table").innerHTML = days.length
    ? days.map(([date, activity]) => `
      <tr>
        <td>${escapeHtml(dayLabel(date))}</td>
        <td>${formatNumber(activity.views)}</td>
        <td>${formatNumber(activity.uniqueVisitors)}</td>
        <td>${formatNumber(activity.testStarts)}</td>
        <td>${formatNumber(activity.testsCompleted)}</td>
        <td>${formatNumber(activity.questionsAnswered)}</td>
      </tr>
    `).join("")
    : '<tr><td class="empty-row" colspan="6">Поки немає даних.</td></tr>';
}

function renderDashboard(data) {
  analyticsData = data;
  renderSummary(data);
  renderVisitors(data);
  renderMonthly(data);
  renderDays(data);
  $("#updated-at").textContent = `Оновлено: ${new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`;
  dashboardContent.classList.remove("hidden");
  accessPanel.classList.add("hidden");
  refreshButton.disabled = false;
}

async function loadAnalytics() {
  if (!analyticsKey) {
    showAccessPanel("Введіть пароль аналітики, щоб переглянути статистику.");
    return;
  }
  refreshButton.disabled = true;
  accessMessage.textContent = "Завантажую статистику…";
  try {
    const response = await fetch("api/analytics", {
      headers: { "x-analytics-key": analyticsKey },
      cache: "no-store"
    });
    if (response.status === 401) {
      analyticsKey = "";
      showAccessPanel("Пароль не прийнято. Перевірте пароль і спробуйте ще раз.");
      return;
    }
    if (!response.ok) throw new Error(`Сервер повернув помилку ${response.status}.`);
    renderDashboard(await response.json());
  } catch (error) {
    showAccessPanel(`Не вдалося завантажити статистику: ${error.message}`);
  } finally {
    refreshButton.disabled = false;
  }
}

function showAccessPanel(message) {
  accessMessage.textContent = message;
  accessPanel.classList.remove("hidden");
  dashboardContent.classList.add("hidden");
}

function requestPassword() {
  const key = window.prompt("Введіть пароль аналітики Roadwise:");
  if (key === null) {
    showAccessPanel("Введення пароля скасовано.");
    return;
  }
  analyticsKey = key.trim();
  if (!analyticsKey) {
    showAccessPanel("Пароль не може бути порожнім.");
    return;
  }
  loadAnalytics();
}

document.querySelectorAll('[role="tab"]').forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll('[role="tab"]').forEach((item) => {
      const isActive = item === tab;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-selected", String(isActive));
    });
    document.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
      panel.classList.toggle("hidden", panel.id !== tab.getAttribute("aria-controls"));
    });
  });
});

accessButton.addEventListener("click", requestPassword);
refreshButton.addEventListener("click", loadAnalytics);
$("#visitor-search").addEventListener("input", () => renderVisitors(analyticsData));
$("#visitors-table").addEventListener("click", (event) => {
  const button = event.target.closest("[data-visitor-id]");
  if (!button) return;
  selectedVisitorId = button.dataset.visitorId;
  renderVisitorDetails();
});

requestPassword();
