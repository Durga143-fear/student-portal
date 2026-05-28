import { ACHIEVEMENTS, DAILY_QUOTES, HABIT_COLORS, STUDENT_TEMPLATES } from "./constants.js";
import {
  addMonths,
  formatLongDate,
  formatMonthYear,
  formatShortDate,
  formatWeekday,
  getDayOfYear,
  getMonthMatrix,
  isSameDay,
  isSameMonth,
  toDateKey,
} from "./date-utils.js";
import {
  describeSupabaseClientConfig,
  getAuthStorageSnapshot,
  getOAuthRedirectContext,
  getSupabaseAuthStorageInfo,
  hasSupabaseConfig,
  supabase,
} from "./supabase-client.js";
import {
  createHabitRow,
  deleteHabitRow,
  ensureStarterHabits,
  replaceUserStateFromBackup,
  setCompletionRow,
  updateHabitRow,
} from "./supabase-store.js";
import { createEmptyState, normalizeState, serializeBackup } from "./storage.js";
import {
  getCompletionRate,
  getConsistencyScore,
  getDayStats,
  getHabitStreak,
  getHeatmapData,
  getMonthlyAnalytics,
  getOverallStreaks,
  getProductivityScore,
  getRecoveryState,
  getTotalCompletions,
  getUnlockedAchievementIds,
  getWeeklyAnalytics,
  isHabitComplete,
  setHabitCompletion,
} from "./stats.js";

const initialTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const app = {
  state: createEmptyState({ theme: initialTheme }),
  viewDate: new Date(),
  selectedDate: new Date(),
  celebratedPerfectDays: new Set(),
  user: null,
  busy: false,
  authLoadUserId: "",
};

const dom = {
  html: document.documentElement,
  body: document.body,
  authScreen: document.querySelector("#authScreen"),
  appShell: document.querySelector("#appShell"),
  googleSignIn: document.querySelector("#googleSignIn"),
  authMessage: document.querySelector("#authMessage"),
  logoutButton: document.querySelector("#logoutButton"),
  userName: document.querySelector("#userName"),
  userEmail: document.querySelector("#userEmail"),
  userAvatar: document.querySelector("#userAvatar"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  loadingText: document.querySelector("#loadingText"),
  todayLabel: document.querySelector("#todayLabel"),
  dailyQuote: document.querySelector("#dailyQuote"),
  productivityRing: document.querySelector("#productivityRing"),
  productivityScore: document.querySelector("#productivityScore"),
  totalCompleted: document.querySelector("#totalCompleted"),
  completionRate: document.querySelector("#completionRate"),
  currentStreak: document.querySelector("#currentStreak"),
  longestStreak: document.querySelector("#longestStreak"),
  consistencyScore: document.querySelector("#consistencyScore"),
  monthlyRate: document.querySelector("#monthlyRate"),
  monthlyCompleted: document.querySelector("#monthlyCompleted"),
  monthTitle: document.querySelector("#monthTitle"),
  calendarGrid: document.querySelector("#calendarGrid"),
  prevMonth: document.querySelector("#prevMonth"),
  nextMonth: document.querySelector("#nextMonth"),
  todayButton: document.querySelector("#todayButton"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  selectedDayMeter: document.querySelector("#selectedDayMeter"),
  selectedDayScore: document.querySelector("#selectedDayScore"),
  selectedDayCompleted: document.querySelector("#selectedDayCompleted"),
  selectedDayMood: document.querySelector("#selectedDayMood"),
  habitList: document.querySelector("#habitList"),
  habitForm: document.querySelector("#habitForm"),
  habitFormTitle: document.querySelector("#habitFormTitle"),
  habitId: document.querySelector("#habitId"),
  habitName: document.querySelector("#habitName"),
  habitIcon: document.querySelector("#habitIcon"),
  habitColor: document.querySelector("#habitColor"),
  saveHabitButton: document.querySelector("#saveHabitButton span"),
  resetHabitForm: document.querySelector("#resetHabitForm"),
  colorPresets: document.querySelector("#colorPresets"),
  templateGrid: document.querySelector("#templateGrid"),
  habitLibrary: document.querySelector("#habitLibrary"),
  searchHabits: document.querySelector("#searchHabits"),
  habitFilter: document.querySelector("#habitFilter"),
  weeklyChart: document.querySelector("#weeklyChart"),
  weeklyCompleted: document.querySelector("#weeklyCompleted"),
  monthInsight: document.querySelector("#monthInsight"),
  monthRing: document.querySelector("#monthRing"),
  monthRingLabel: document.querySelector("#monthRingLabel"),
  heatmapGrid: document.querySelector("#heatmapGrid"),
  badgeGrid: document.querySelector("#badgeGrid"),
  badgeCount: document.querySelector("#badgeCount"),
  historyList: document.querySelector("#historyList"),
  streakGrid: document.querySelector("#streakGrid"),
  themeToggle: document.querySelector("#themeToggle"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  importFile: document.querySelector("#importFile"),
  toastStack: document.querySelector("#toastStack"),
  confettiRoot: document.querySelector("#confettiRoot"),
};

const AUTH_LOG_PREFIX = "[auth]";
const OAUTH_SEARCH_PARAMS = ["code", "error", "error_code", "error_description", "state", "type"];
const OAUTH_HASH_PARAMS = [
  "access_token",
  "expires_at",
  "expires_in",
  "provider_refresh_token",
  "provider_token",
  "refresh_token",
  "token_type",
  ...OAUTH_SEARCH_PARAMS,
];
const SENSITIVE_URL_PARAMS = new Set([...OAUTH_SEARCH_PARAMS, ...OAUTH_HASH_PARAMS]);

function summarizeError(error) {
  if (!error) return null;

  const serialized = {};

  Object.getOwnPropertyNames(error).forEach((key) => {
    serialized[key] = error[key];
  });

  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    status: error?.status,
    code: error?.code,
    stack: error?.stack,
    cause: error?.cause,
    details: error?.details,
    raw: serialized,
  };
}

function summarizeAuthValue(value) {
  if (!value) {
    return {
      present: false,
      length: 0,
      preview: null,
    };
  }

  const text = String(value);
  const preview = text.length <= 10 ? "[redacted]" : `${text.slice(0, 5)}...${text.slice(-4)}`;

  return {
    present: true,
    length: text.length,
    preview,
  };
}

function summarizeSession(session) {
  return {
    hasSession: Boolean(session),
    userId: session?.user?.id || null,
    email: session?.user?.email || null,
    expiresAt: session?.expires_at || null,
    tokenType: session?.token_type || null,
  };
}

function toConsolePayload(value) {
  const seen = new WeakSet();

  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (item instanceof Error) return summarizeError(item);
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }

      return item;
    }),
  );
}

function logAuthStep(step, detail = {}) {
  console.info(`${AUTH_LOG_PREFIX} ${step}`, toConsolePayload(detail));
}

function logAuthError(step, error, detail = {}) {
  console.error(`${AUTH_LOG_PREFIX} ${step}`, toConsolePayload({
    ...detail,
    error: summarizeError(error),
  }));
}

function getHashParams(hash = window.location.hash) {
  return new URLSearchParams(hash.replace(/^#/, ""));
}

function redactSensitiveUrl(value) {
  try {
    const url = new URL(value);

    SENSITIVE_URL_PARAMS.forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, summarizeAuthValue(url.searchParams.get(key)).preview);
      }
    });

    if (url.hash) {
      const hashParams = getHashParams(url.hash);
      let hasSensitiveHashParam = false;

      SENSITIVE_URL_PARAMS.forEach((key) => {
        if (hashParams.has(key)) {
          hasSensitiveHashParam = true;
          hashParams.set(key, summarizeAuthValue(hashParams.get(key)).preview);
        }
      });

      if (hasSensitiveHashParam) {
        url.hash = hashParams.toString();
      }
    }

    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

function summarizeCurrentUrl() {
  const url = new URL(window.location.href);
  const hashParams = getHashParams();

  return {
    href: redactSensitiveUrl(window.location.href),
    origin: url.origin,
    host: url.host,
    pathname: url.pathname,
    searchKeys: Array.from(url.searchParams.keys()),
    hashKeys: Array.from(hashParams.keys()),
    codeParameter: summarizeAuthValue(url.searchParams.get("code")),
    stateParameter: summarizeAuthValue(url.searchParams.get("state")),
  };
}

function summarizeAuthorizeUrl(value, expectedRedirectTo) {
  if (!value) {
    return {
      hasUrl: false,
    };
  }

  try {
    const url = new URL(value);
    const redirectTo = url.searchParams.get("redirect_to");
    const codeChallenge = url.searchParams.get("code_challenge");

    return {
      hasUrl: true,
      href: redactSensitiveUrl(value),
      origin: url.origin,
      pathname: url.pathname,
      provider: url.searchParams.get("provider"),
      redirectTo,
      redirectMatchesRequest: redirectTo === expectedRedirectTo,
      hasCodeChallenge: Boolean(codeChallenge),
      codeChallenge: summarizeAuthValue(codeChallenge),
      codeChallengeMethod: url.searchParams.get("code_challenge_method"),
    };
  } catch (error) {
    return {
      hasUrl: true,
      invalidUrl: true,
      error: summarizeError(error),
    };
  }
}

function readPkceStorageState() {
  const storageInfo = getSupabaseAuthStorageInfo();
  const configuredStorage = getAuthStorageSnapshot(storageInfo.codeVerifierKey);

  try {
    const codeVerifier = storageInfo.codeVerifierKey
      ? window.localStorage.getItem(storageInfo.codeVerifierKey)
      : null;
    const codeVerifierKeys = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.includes("code-verifier")) {
        codeVerifierKeys.push(key);
      }
    }

    return {
      storageAvailable: true,
      storageKey: storageInfo.storageKey || null,
      codeVerifierKey: storageInfo.codeVerifierKey || null,
      configuredStorage,
      hasExpectedCodeVerifier: Boolean(codeVerifier) || configuredStorage.values.some((item) => item.hasKey),
      expectedCodeVerifier: summarizeAuthValue(codeVerifier),
      codeVerifierKeys,
    };
  } catch (error) {
    return {
      storageAvailable: false,
      storageKey: storageInfo.storageKey || null,
      codeVerifierKey: storageInfo.codeVerifierKey || null,
      configuredStorage,
      error: summarizeError(error),
    };
  }
}

function readOAuthCallback() {
  const url = new URL(window.location.href);
  const hashParams = getHashParams();
  const hasSearchCallback = OAUTH_SEARCH_PARAMS.some((key) => url.searchParams.has(key));
  const hasHashCallback = OAUTH_HASH_PARAMS.some((key) => hashParams.has(key));

  return {
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state") || hashParams.get("state"),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
    error: url.searchParams.get("error") || hashParams.get("error"),
    errorCode: url.searchParams.get("error_code") || hashParams.get("error_code"),
    errorDescription: url.searchParams.get("error_description") || hashParams.get("error_description"),
    type: url.searchParams.get("type") || hashParams.get("type"),
    hasCallback: hasSearchCallback || hasHashCallback,
    hasHashTokens: Boolean(hashParams.get("access_token") || hashParams.get("refresh_token")),
  };
}

function summarizeOAuthCallback(callback) {
  return {
    hasCallback: callback.hasCallback,
    hasCode: Boolean(callback.code),
    codeParameter: summarizeAuthValue(callback.code),
    stateParameter: summarizeAuthValue(callback.state),
    hasHashTokens: callback.hasHashTokens,
    hasError: Boolean(callback.error),
    error: callback.error || null,
    errorCode: callback.errorCode || null,
    errorDescription: callback.errorDescription || null,
    type: callback.type || null,
  };
}

function clearOAuthCallbackFromUrl() {
  const url = new URL(window.location.href);
  OAUTH_SEARCH_PARAMS.forEach((key) => url.searchParams.delete(key));
  url.hash = "";
  window.history.replaceState(window.history.state, document.title, url.toString());
}

function resetGoogleSignInButton() {
  dom.googleSignIn.disabled = false;
  dom.googleSignIn.querySelector("span").textContent = "Continue with Google";
}

function plural(value, noun) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function refreshIcons() {
  window.lucide?.createIcons();
}

function setBusy(isBusy, message = "Syncing Supabase") {
  app.busy = isBusy;
  dom.body.classList.toggle("is-busy", isBusy);
  dom.loadingOverlay.setAttribute("aria-hidden", String(!isBusy));
  dom.loadingText.textContent = message;
}

function setAuthMessage(message, isError = true) {
  dom.authMessage.textContent = message;
  dom.authMessage.classList.toggle("ok", !isError);
}

function showLogin(message = "") {
  logAuthStep("ui:show-login", { hasMessage: Boolean(message), message });
  app.user = null;
  app.authLoadUserId = "";
  app.state = createEmptyState({ theme: app.state.settings.theme });
  resetGoogleSignInButton();
  dom.body.classList.remove("authenticated");
  dom.authScreen.removeAttribute("aria-hidden");
  dom.appShell.setAttribute("aria-hidden", "true");
  setAuthMessage(message, Boolean(message));
  applyTheme();
  refreshIcons();
}

function showApp() {
  logAuthStep("ui:show-app", summarizeSession({ user: app.user }));
  dom.body.classList.add("authenticated");
  dom.authScreen.setAttribute("aria-hidden", "true");
  dom.appShell.removeAttribute("aria-hidden");
}

function getUserDisplay(user) {
  const metadata = user?.user_metadata || {};
  const email = user?.email || "";
  const name = metadata.full_name || metadata.name || email.split("@")[0] || "Student";
  const avatar = metadata.avatar_url || metadata.picture || "assets/app-icon.svg";

  return { name, email, avatar };
}

function renderUser() {
  const display = getUserDisplay(app.user);
  dom.userName.textContent = display.name;
  dom.userEmail.textContent = display.email;
  dom.userAvatar.src = display.avatar;
  dom.userAvatar.alt = `${display.name} avatar`;
}

function applyTheme() {
  dom.html.dataset.theme = app.state.settings.theme;
  const icon = app.state.settings.theme === "dark" ? "sun" : "moon";
  dom.themeToggle.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
  refreshIcons();
}

function renderWithAchievements(options = {}) {
  const previousAchievements = new Set(Object.keys(app.state.achievements));
  const unlocked = getUnlockedAchievementIds(app.state);

  unlocked.forEach((id) => {
    if (!app.state.achievements[id]) {
      app.state.achievements[id] = new Date().toISOString();
    }
  });

  render();

  if (!options.silent) {
    unlocked
      .filter((id) => !previousAchievements.has(id))
      .forEach((id) => {
        const achievement = ACHIEVEMENTS.find((item) => item.id === id);
        showToast(`${achievement.icon} ${achievement.title}`, achievement.description);
        burstConfetti();
      });
  }
}

function showToast(title, message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  dom.toastStack.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function showError(error, fallback = "Something went wrong. Please try again.") {
  console.error(error);
  showToast("Action failed", error?.message || fallback);
}

function burstConfetti() {
  const colors = ["#2563eb", "#14b8a6", "#f97316", "#db2777", "#8b5cf6", "#22c55e"];

  for (let index = 0; index < 52; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    piece.style.setProperty("--x", `${Math.random() * 100}vw`);
    piece.style.setProperty("--drift", `${Math.random() * 160 - 80}px`);
    piece.style.setProperty("--delay", `${Math.random() * 0.35}s`);
    piece.style.setProperty("--spin", `${Math.random() * 520 - 260}deg`);
    piece.style.background = colors[index % colors.length];
    dom.confettiRoot.append(piece);
    window.setTimeout(() => piece.remove(), 2400);
  }
}

function filteredHabits(dateKey = toDateKey(app.selectedDate)) {
  const query = dom.searchHabits.value.trim().toLowerCase();
  const filter = dom.habitFilter.value;

  return app.state.habits.filter((habit) => {
    const matchesSearch =
      !query ||
      habit.name.toLowerCase().includes(query) ||
      habit.icon.toLowerCase().includes(query);
    const complete = isHabitComplete(app.state, habit.id, dateKey);
    const streak = getHabitStreak(app.state, habit.id).current;

    if (!matchesSearch) return false;
    if (filter === "completed") return complete;
    if (filter === "pending") return !complete;
    if (filter === "streak") return streak > 0;
    return true;
  });
}

function renderOverview() {
  const quoteIndex = getDayOfYear(new Date()) % DAILY_QUOTES.length;
  const totalCompleted = getTotalCompletions(app.state);
  const rate = getCompletionRate(app.state);
  const streaks = getOverallStreaks(app.state);
  const month = getMonthlyAnalytics(app.state, app.viewDate);
  const consistency = getConsistencyScore(app.state);
  const productivity = getProductivityScore(app.state);

  dom.todayLabel.textContent = formatLongDate(new Date());
  dom.dailyQuote.textContent = DAILY_QUOTES[quoteIndex];
  dom.productivityScore.textContent = productivity;
  dom.productivityRing.style.setProperty("--score", productivity);
  dom.totalCompleted.textContent = totalCompleted;
  dom.completionRate.textContent = `${rate.percent}%`;
  dom.currentStreak.textContent = plural(streaks.current, "day");
  dom.longestStreak.textContent = plural(streaks.longest, "day");
  dom.consistencyScore.textContent = `${consistency}%`;
  dom.monthlyRate.textContent = `${month.percent}%`;
  dom.monthlyCompleted.textContent = `${month.completed} completions`;
}

function renderCalendar() {
  const today = new Date();
  const selectedKey = toDateKey(app.selectedDate);
  const dates = getMonthMatrix(app.viewDate);

  dom.monthTitle.textContent = formatMonthYear(app.viewDate);
  dom.calendarGrid.innerHTML = dates
    .map((date) => {
      const dateKey = toDateKey(date);
      const stats = getDayStats(app.state, dateKey);
      const completedHabits = app.state.habits
        .filter((habit) => isHabitComplete(app.state, habit.id, dateKey))
        .slice(0, 4);
      const dots = completedHabits
        .map((habit) => `<i style="--habit-color: ${habit.color}"></i>`)
        .join("");
      const classes = [
        "calendar-day",
        isSameMonth(date, app.viewDate) ? "" : "muted",
        isSameDay(date, today) ? "today" : "",
        selectedKey === dateKey ? "selected" : "",
        stats.total > 0 && stats.completed === stats.total ? "perfect" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <button class="${classes}" data-date="${dateKey}" data-level="${Math.ceil(stats.percent / 25)}" type="button" aria-label="${formatLongDate(date)}, ${stats.percent}% complete">
          <span class="date-number">${date.getDate()}</span>
          <span class="completion-count">${stats.completed}/${stats.total}</span>
          <span class="habit-dots">${dots}</span>
        </button>
      `;
    })
    .join("");
}

function getDayMood(stats) {
  if (!stats.total) return "Create your first habit";
  if (stats.percent === 100) return "Perfect study day";
  if (stats.percent >= 70) return "Strong momentum";
  if (stats.percent >= 40) return "Keep building";
  if (stats.completed > 0) return "You started";
  return "Ready to start";
}

function renderSelectedDay() {
  const dateKey = toDateKey(app.selectedDate);
  const stats = getDayStats(app.state, dateKey);
  const habits = filteredHabits(dateKey);

  dom.selectedDateLabel.textContent = formatLongDate(app.selectedDate);
  dom.selectedDayMeter.style.setProperty("--day-score", stats.percent);
  dom.selectedDayScore.textContent = `${stats.percent}%`;
  dom.selectedDayCompleted.textContent = `${stats.completed} of ${stats.total} habits complete`;
  dom.selectedDayMood.textContent = getDayMood(stats);

  if (!habits.length) {
    dom.habitList.innerHTML = `
      <div class="empty-state">
        <i data-lucide="list-filter" aria-hidden="true"></i>
        <strong>No habits match this view.</strong>
        <span>Adjust the search or filter to keep tracking.</span>
      </div>
    `;
    return;
  }

  dom.habitList.innerHTML = habits
    .map((habit) => {
      const complete = isHabitComplete(app.state, habit.id, dateKey);
      const streak = getHabitStreak(app.state, habit.id);
      const habitName = escapeHtml(habit.name);

      return `
        <article class="habit-row ${complete ? "complete" : ""}">
          <button class="check-button" data-action="toggle" data-id="${habit.id}" type="button" aria-label="Toggle ${habitName}">
            <i data-lucide="${complete ? "check" : "circle"}" aria-hidden="true"></i>
          </button>
          <span class="habit-icon" style="--habit-color: ${habit.color}">${escapeHtml(habit.icon)}</span>
          <div class="habit-main">
            <strong>${habitName}</strong>
            <small>${plural(streak.current, "day")} current - ${plural(streak.longest, "day")} best</small>
          </div>
          <span class="status-chip">${complete ? "Done" : "Open"}</span>
          <button class="icon-button tiny" data-action="edit" data-id="${habit.id}" type="button" aria-label="Edit ${habitName}">
            <i data-lucide="pencil" aria-hidden="true"></i>
          </button>
        </article>
      `;
    })
    .join("");
}

function renderColorPresets() {
  dom.colorPresets.innerHTML = HABIT_COLORS.map(
    (color) => `
      <button class="color-chip" data-color="${color}" style="--chip-color: ${color}" type="button" aria-label="Use ${color}"></button>
    `,
  ).join("");
}

function renderTemplates() {
  const existingNames = new Set(app.state.habits.map((habit) => habit.name.toLowerCase()));

  dom.templateGrid.innerHTML = STUDENT_TEMPLATES.map((template) => {
    const exists = existingNames.has(template.name.toLowerCase());
    return `
      <button class="template-button" data-template="${escapeHtml(template.name)}" type="button" ${exists ? "disabled" : ""}>
        <span style="--habit-color: ${template.color}">${template.icon}</span>
        <strong>${escapeHtml(template.name)}</strong>
        <small>${exists ? "Added" : "Add"}</small>
      </button>
    `;
  }).join("");
}

function renderHabitLibrary() {
  if (!app.state.habits.length) {
    dom.habitLibrary.innerHTML = `
      <div class="empty-state">
        <i data-lucide="sparkles" aria-hidden="true"></i>
        <strong>No habits yet.</strong>
        <span>Use templates or create a custom habit.</span>
      </div>
    `;
    return;
  }

  dom.habitLibrary.innerHTML = `
    <div class="mini-head">
      <strong>Habit library</strong>
      <small>${app.state.habits.length} active</small>
    </div>
    ${app.state.habits
      .map((habit) => {
        const streak = getHabitStreak(app.state, habit.id);
        const habitName = escapeHtml(habit.name);
        return `
          <article class="library-row">
            <span class="habit-icon" style="--habit-color: ${habit.color}">${escapeHtml(habit.icon)}</span>
            <div>
              <strong>${habitName}</strong>
              <small>${plural(streak.longest, "day")} best streak</small>
            </div>
            <button class="icon-button tiny" data-action="edit" data-id="${habit.id}" type="button" aria-label="Edit ${habitName}">
              <i data-lucide="pencil" aria-hidden="true"></i>
            </button>
            <button class="icon-button tiny danger" data-action="delete" data-id="${habit.id}" type="button" aria-label="Delete ${habitName}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          </article>
        `;
      })
      .join("")}
  `;
}

function renderAnalytics() {
  const weekly = getWeeklyAnalytics(app.state);
  const monthly = getMonthlyAnalytics(app.state, app.viewDate);
  const heatmap = getHeatmapData(app.state);
  const history = weekly.slice(-7);
  const unlocked = new Set(Object.keys(app.state.achievements));
  const weeklyDone = weekly.reduce((sum, item) => sum + item.completed, 0);

  dom.weeklyCompleted.textContent = `${weeklyDone} completed`;
  dom.weeklyChart.innerHTML = weekly
    .map((item) => `
      <div class="bar-item" title="${formatLongDate(item.date)}: ${item.percent}%">
        <span class="bar-track"><i style="height: ${Math.max(4, item.percent)}%"></i></span>
        <small>${formatWeekday(item.date)}</small>
      </div>
    `)
    .join("");

  dom.monthInsight.textContent = `${monthly.perfectDays} perfect days`;
  dom.monthRing.style.setProperty("--month-score", monthly.percent);
  dom.monthRingLabel.textContent = `${monthly.percent}%`;

  dom.heatmapGrid.innerHTML = heatmap
    .map((item) => `
      <button class="heat-cell" data-level="${item.level}" type="button" title="${formatShortDate(item.date)}: ${item.completed}/${item.total} complete"></button>
    `)
    .join("");

  dom.badgeCount.textContent = `${unlocked.size} unlocked`;
  dom.badgeGrid.innerHTML = ACHIEVEMENTS.map((achievement) => {
    const isUnlocked = unlocked.has(achievement.id);
    return `
      <article class="badge-card ${isUnlocked ? "unlocked" : ""}">
        <span>${achievement.icon}</span>
        <strong>${escapeHtml(achievement.title)}</strong>
        <small>${escapeHtml(achievement.description)}</small>
      </article>
    `;
  }).join("");

  dom.historyList.innerHTML = history
    .reverse()
    .map((item) => `
      <article class="history-row">
        <span>${formatShortDate(item.date)}</span>
        <strong>${item.completed}/${item.total}</strong>
        <i style="width: ${item.percent}%"></i>
      </article>
    `)
    .join("");
}

function renderStreaks() {
  if (!app.state.habits.length) {
    dom.streakGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="flame" aria-hidden="true"></i>
        <strong>No streaks yet.</strong>
        <span>Add a habit to start a run.</span>
      </div>
    `;
    return;
  }

  dom.streakGrid.innerHTML = app.state.habits
    .map((habit) => {
      const streak = getHabitStreak(app.state, habit.id);
      const recovery = getRecoveryState(app.state, habit.id);
      const badge = streak.current >= 30 ? "Legend" : streak.current >= 14 ? "Elite" : streak.current >= 7 ? "Weekly" : streak.current >= 3 ? "Spark" : "Starter";

      return `
        <article class="streak-card" style="--habit-color: ${habit.color}">
          <span class="habit-icon">${escapeHtml(habit.icon)}</span>
          <div>
            <strong>${escapeHtml(habit.name)}</strong>
            <small class="${recovery.tone}">${escapeHtml(recovery.label)}</small>
          </div>
          <div class="streak-numbers">
            <span><b>${streak.current}</b> current</span>
            <span><b>${streak.longest}</b> longest</span>
          </div>
          <em>${badge}</em>
        </article>
      `;
    })
    .join("");
}

function render() {
  renderOverview();
  renderCalendar();
  renderSelectedDay();
  renderColorPresets();
  renderTemplates();
  renderHabitLibrary();
  renderAnalytics();
  renderStreaks();
  applyTheme();
  refreshIcons();
}

function resetHabitForm() {
  dom.habitForm.reset();
  dom.habitId.value = "";
  dom.habitColor.value = HABIT_COLORS[0];
  dom.habitFormTitle.textContent = "Create a habit";
  dom.saveHabitButton.textContent = "Save habit";
}

function editHabit(habitId) {
  const habit = app.state.habits.find((item) => item.id === habitId);
  if (!habit) return;

  dom.habitId.value = habit.id;
  dom.habitName.value = habit.name;
  dom.habitIcon.value = habit.icon;
  dom.habitColor.value = habit.color;
  dom.habitFormTitle.textContent = "Edit habit";
  dom.saveHabitButton.textContent = "Update habit";
  dom.habitName.focus();
}

async function deleteHabit(habitId) {
  if (app.busy || !app.user) return;

  const habit = app.state.habits.find((item) => item.id === habitId);
  if (!habit) return;

  const confirmed = window.confirm(`Delete "${habit.name}" and its completion history?`);
  if (!confirmed) return;

  setBusy(true, "Deleting habit");

  try {
    await deleteHabitRow(supabase, app.user.id, habitId);
    app.state.habits = app.state.habits.filter((item) => item.id !== habitId);
    Object.keys(app.state.completions).forEach((dateKey) => {
      delete app.state.completions[dateKey][habitId];
      if (Object.keys(app.state.completions[dateKey]).length === 0) {
        delete app.state.completions[dateKey];
      }
    });
    resetHabitForm();
    renderWithAchievements();
    showToast("Habit deleted", `${habit.name} was removed.`);
  } catch (error) {
    showError(error, "Could not delete this habit.");
  } finally {
    setBusy(false);
  }
}

async function saveHabit(event) {
  event.preventDefault();
  if (app.busy || !app.user) return;

  const name = dom.habitName.value.trim();
  const icon = dom.habitIcon.value.trim();
  const color = dom.habitColor.value;

  if (!name || !icon) {
    showToast("Missing habit detail", "Add a name and an emoji before saving.");
    return;
  }

  const editingId = dom.habitId.value;
  const duplicate = app.state.habits.some(
    (habit) => habit.name.toLowerCase() === name.toLowerCase() && habit.id !== editingId,
  );

  if (duplicate) {
    showToast("Already exists", "That habit is already in your tracker.");
    return;
  }

  setBusy(true, editingId ? "Updating habit" : "Creating habit");

  try {
    if (editingId) {
      const savedHabit = await updateHabitRow(supabase, app.user.id, {
        id: editingId,
        name,
        icon,
        color,
      });

      app.state.habits = app.state.habits.map((habit) => (habit.id === editingId ? savedHabit : habit));
    } else {
      const savedHabit = await createHabitRow(supabase, app.user.id, { name, icon, color });
      app.state.habits.push(savedHabit);
    }

    resetHabitForm();
    renderWithAchievements();
  } catch (error) {
    showError(error, "Could not save this habit.");
  } finally {
    setBusy(false);
  }
}

async function addTemplate(templateName) {
  if (app.busy || !app.user) return;

  const template = STUDENT_TEMPLATES.find((item) => item.name === templateName);
  if (!template) return;

  const exists = app.state.habits.some((habit) => habit.name.toLowerCase() === template.name.toLowerCase());
  if (exists) return;

  setBusy(true, "Adding template");

  try {
    const savedHabit = await createHabitRow(supabase, app.user.id, template);
    app.state.habits.push(savedHabit);
    renderWithAchievements();
    showToast("Template added", `${template.icon} ${template.name} is ready.`);
  } catch (error) {
    showError(error, "Could not add this template.");
  } finally {
    setBusy(false);
  }
}

async function toggleCompletion(habitId) {
  if (app.busy || !app.user) return;

  const dateKey = toDateKey(app.selectedDate);
  const wasComplete = isHabitComplete(app.state, habitId, dateKey);
  const nextValue = !wasComplete;

  setBusy(true, "Saving completion");

  try {
    await setCompletionRow(supabase, app.user.id, habitId, dateKey, nextValue);
    setHabitCompletion(app.state, habitId, dateKey, nextValue);
    const stats = getDayStats(app.state, dateKey);
    renderWithAchievements();

    if (stats.total > 0 && stats.completed === stats.total && !app.celebratedPerfectDays.has(dateKey)) {
      app.celebratedPerfectDays.add(dateKey);
      showToast("Perfect day", "Every habit is complete for this date.");
      burstConfetti();
    }
  } catch (error) {
    showError(error, "Could not save this completion.");
  } finally {
    setBusy(false);
  }
}

function exportBackup() {
  const backup = serializeBackup(app.state);
  const blob = new Blob([backup], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `momentum-habit-backup-${toDateKey(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Backup exported", "Your Supabase habit data backup is ready.");
}

function importBackup(file) {
  if (app.busy || !app.user) return;

  const reader = new FileReader();

  reader.addEventListener("load", async () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      normalizeState(parsed);
      const confirmed = window.confirm("Import this backup and replace current Supabase habit data?");
      if (!confirmed) return;

      setBusy(true, "Importing backup");
      app.state = await replaceUserStateFromBackup(supabase, app.user.id, parsed, app.state.settings);
      app.viewDate = new Date();
      app.selectedDate = new Date();
      renderWithAchievements({ silent: true });
      showToast("Backup imported", "Your previous habit data has been restored in Supabase.");
    } catch (error) {
      showError(error, "Choose a valid Momentum JSON backup.");
    } finally {
      setBusy(false);
      dom.importFile.value = "";
    }
  });

  reader.readAsText(file);
}

async function handleOAuthCallback() {
  const callback = readOAuthCallback();
  logAuthStep("callback:inspect", {
    currentUrl: summarizeCurrentUrl(),
    callback: summarizeOAuthCallback(callback),
    redirect: getOAuthRedirectContext(),
    pkce: readPkceStorageState(),
  });

  if (!callback.hasCallback) return null;

  if (callback.error) {
    logAuthStep("callback:provider-error", {
      currentUrl: summarizeCurrentUrl(),
      callback: summarizeOAuthCallback(callback),
    });
    clearOAuthCallbackFromUrl();
    throw new Error(callback.errorDescription || callback.errorCode || callback.error);
  }

  if (callback.code) {
    logAuthStep("callback:exchange-code:start", {
      currentUrl: summarizeCurrentUrl(),
      codeParameter: summarizeAuthValue(callback.code),
      stateParameter: summarizeAuthValue(callback.state),
      pkce: readPkceStorageState(),
    });
    const { data, error } = await supabase.auth.exchangeCodeForSession(callback.code);
    logAuthStep("callback:exchange-code:result", {
      hasError: Boolean(error),
      error: error ? summarizeError(error) : null,
      session: summarizeSession(data?.session),
      redirectType: data?.redirectType || null,
      pkce: readPkceStorageState(),
    });
    clearOAuthCallbackFromUrl();

    if (error) {
      logAuthError("callback:exchange-code:error", error);
      throw error;
    }

    logAuthStep("callback:exchange-code:success", summarizeSession(data.session));
    return data.session;
  }

  if (callback.accessToken && callback.refreshToken) {
    logAuthStep("callback:set-hash-session:start", {
      currentUrl: summarizeCurrentUrl(),
      hasAccessToken: true,
      hasRefreshToken: true,
    });
    const { data, error } = await supabase.auth.setSession({
      access_token: callback.accessToken,
      refresh_token: callback.refreshToken,
    });
    logAuthStep("callback:set-hash-session:result", {
      hasError: Boolean(error),
      error: error ? summarizeError(error) : null,
      session: summarizeSession(data?.session),
    });
    clearOAuthCallbackFromUrl();

    if (error) {
      logAuthError("callback:set-hash-session:error", error);
      throw error;
    }

    logAuthStep("callback:set-hash-session:success", summarizeSession(data.session));
    return data.session;
  }

  clearOAuthCallbackFromUrl();
  logAuthStep("callback:ignored", summarizeOAuthCallback(callback));
  return null;
}

async function signInWithGoogle() {
  if (!hasSupabaseConfig || !supabase) {
    setAuthMessage("Missing SUPABASE_URL or SUPABASE_ANON_KEY. Add them to .env.local and Vercel.");
    return;
  }

  const redirect = getOAuthRedirectContext();
  const redirectTo = redirect.redirectTo;
  const redirectOrigin = new URL(redirectTo).origin;

  dom.googleSignIn.disabled = true;
  dom.googleSignIn.querySelector("span").textContent = "Opening Google...";
  setAuthMessage("Redirecting to Google...", false);
  logAuthStep("oauth:sign-in:start", {
    provider: "google",
    currentUrl: summarizeCurrentUrl(),
    redirect,
    pkceBeforeSignIn: readPkceStorageState(),
  });
  if (redirectOrigin !== window.location.origin) {
    logAuthStep("oauth:redirect-origin-mismatch", {
      currentOrigin: window.location.origin,
      redirectOrigin,
      note: "PKCE requires the callback origin to have the stored code verifier.",
    });
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error) {
    resetGoogleSignInButton();
    logAuthError("oauth:sign-in:error", error, { redirect });
    setAuthMessage(error.message);
    return;
  }

  logAuthStep("oauth:sign-in:authorize-url", {
    redirect,
    authorizeUrl: summarizeAuthorizeUrl(data?.url, redirectTo),
    pkceAfterSignIn: readPkceStorageState(),
  });

  if (!data?.url) {
    resetGoogleSignInButton();
    logAuthError("oauth:sign-in:missing-provider-url", new Error("Supabase did not return an OAuth URL."), {
      redirect,
    });
    setAuthMessage("Supabase did not return a Google sign-in URL. Please try again.");
    return;
  }
}

async function signOut() {
  if (!supabase) return;

  setBusy(true, "Signing out");
  logAuthStep("sign-out:start", summarizeSession({ user: app.user }));

  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    logAuthStep("sign-out:success");
    showLogin("");
  } catch (error) {
    logAuthError("sign-out:error", error);
    showError(error, "Could not sign out.");
  } finally {
    setBusy(false);
  }
}

async function loadProtectedApp(session, source = "unknown") {
  logAuthStep("load-protected:start", { source, session: summarizeSession(session) });

  if (!session?.user) {
    logAuthStep("load-protected:no-session", { source });
    showLogin("");
    return;
  }

  if (app.authLoadUserId === session.user.id && dom.body.classList.contains("authenticated")) {
    logAuthStep("load-protected:skip-existing-user", { source, userId: session.user.id });
    return;
  }

  app.authLoadUserId = session.user.id;
  app.user = session.user;
  showApp();
  renderUser();
  setBusy(true, "Loading your habits");

  try {
    app.state = await ensureStarterHabits(supabase, app.user.id, app.state.settings);
    renderWithAchievements({ silent: true });
    logAuthStep("load-protected:success", { source, userId: app.user.id });
  } catch (error) {
    app.state = createEmptyState(app.state.settings);
    renderWithAchievements({ silent: true });
    logAuthError("load-protected:data-error", error, { source, userId: app.user.id });
    showError(error, "Could not load your Supabase habit data.");
  } finally {
    setBusy(false);
  }
}

async function initAuth() {
  applyTheme();
  refreshIcons();
  logAuthStep("init:start", {
    currentUrl: summarizeCurrentUrl(),
    supabase: describeSupabaseClientConfig(),
    callback: summarizeOAuthCallback(readOAuthCallback()),
    redirect: getOAuthRedirectContext(),
    pkce: readPkceStorageState(),
  });

  if (!hasSupabaseConfig || !supabase) {
    logAuthStep("init:missing-config", describeSupabaseClientConfig());
    showLogin("Missing SUPABASE_URL or SUPABASE_ANON_KEY. Add them to .env.local and Vercel.");
    return;
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    logAuthStep("auth-state-change", {
      event,
      session: summarizeSession(session),
    });

    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      if (session?.user) {
        app.user = session.user;
        if (dom.body.classList.contains("authenticated")) renderUser();
      }
      return;
    }

    if (event === "SIGNED_OUT" || !session?.user) {
      showLogin("");
      return;
    }

    void loadProtectedApp(session, `auth-state:${event}`);
  });
  logAuthStep("auth-state:subscribed", { hasSubscription: Boolean(subscription) });

  setBusy(true, "Checking session");

  try {
    const callbackSession = await handleOAuthCallback();
    if (callbackSession?.user) {
      await loadProtectedApp(callbackSession, "oauth-callback");
      return;
    }

    logAuthStep("session:get:start");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    logAuthStep("session:get:result", {
      hasError: Boolean(error),
      error: error ? summarizeError(error) : null,
      session: summarizeSession(data.session),
    });
    await loadProtectedApp(data.session, "getSession");
  } catch (error) {
    logAuthError("init:error", error);
    showLogin(error?.message || "Could not read your session. Please sign in again.");
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  dom.googleSignIn.addEventListener("click", signInWithGoogle);
  dom.logoutButton.addEventListener("click", signOut);

  dom.prevMonth.addEventListener("click", () => {
    app.viewDate = addMonths(app.viewDate, -1);
    render();
  });

  dom.nextMonth.addEventListener("click", () => {
    app.viewDate = addMonths(app.viewDate, 1);
    render();
  });

  dom.todayButton.addEventListener("click", () => {
    app.viewDate = new Date();
    app.selectedDate = new Date();
    render();
  });

  dom.calendarGrid.addEventListener("click", (event) => {
    const day = event.target.closest("[data-date]");
    if (!day) return;

    app.selectedDate = new Date(`${day.dataset.date}T00:00:00`);
    app.viewDate = new Date(app.selectedDate.getFullYear(), app.selectedDate.getMonth(), 1);
    render();
  });

  dom.habitList.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    if (actionButton.dataset.action === "toggle") void toggleCompletion(actionButton.dataset.id);
    if (actionButton.dataset.action === "edit") editHabit(actionButton.dataset.id);
  });

  dom.habitLibrary.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    if (actionButton.dataset.action === "edit") editHabit(actionButton.dataset.id);
    if (actionButton.dataset.action === "delete") void deleteHabit(actionButton.dataset.id);
  });

  dom.habitForm.addEventListener("submit", saveHabit);
  dom.resetHabitForm.addEventListener("click", resetHabitForm);

  dom.colorPresets.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-color]");
    if (chip) dom.habitColor.value = chip.dataset.color;
  });

  dom.templateGrid.addEventListener("click", (event) => {
    const templateButton = event.target.closest("[data-template]");
    if (templateButton) void addTemplate(templateButton.dataset.template);
  });

  dom.searchHabits.addEventListener("input", render);
  dom.habitFilter.addEventListener("change", render);

  dom.themeToggle.addEventListener("click", () => {
    app.state.settings.theme = app.state.settings.theme === "dark" ? "light" : "dark";
    render();
  });

  dom.exportButton.addEventListener("click", exportBackup);
  dom.importButton.addEventListener("click", () => dom.importFile.click());
  dom.importFile.addEventListener("change", () => {
    const [file] = dom.importFile.files;
    if (file) importBackup(file);
  });
}

bindEvents();
resetHabitForm();
render();
void initAuth();
