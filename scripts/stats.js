import { ACHIEVEMENTS } from "./constants.js";
import {
  addDays,
  eachDateBetween,
  fromDateKey,
  getDateRange,
  getMonthDates,
  toDateKey,
} from "./date-utils.js";

export function isHabitComplete(state, habitId, dateKey) {
  return Boolean(state.completions?.[dateKey]?.[habitId]);
}

export function setHabitCompletion(state, habitId, dateKey, isComplete) {
  state.completions[dateKey] = state.completions[dateKey] || {};

  if (isComplete) {
    state.completions[dateKey][habitId] = true;
  } else {
    delete state.completions[dateKey][habitId];
  }

  if (Object.keys(state.completions[dateKey]).length === 0) {
    delete state.completions[dateKey];
  }
}

export function getDayStats(state, dateKey) {
  const total = state.habits.length;
  const completed = state.habits.filter((habit) => isHabitComplete(state, habit.id, dateKey)).length;

  return {
    total,
    completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };
}

export function getTotalCompletions(state) {
  const validIds = new Set(state.habits.map((habit) => habit.id));

  return Object.values(state.completions).reduce((total, day) => {
    return total + Object.keys(day).filter((id) => validIds.has(id) && day[id]).length;
  }, 0);
}

export function getFirstTrackedDate(state) {
  const habitDates = state.habits.map((habit) => habit.createdAt).filter(Boolean);
  const completionDates = Object.keys(state.completions);
  const allDates = [...habitDates, ...completionDates].filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey));

  if (!allDates.length) return new Date();

  return fromDateKey(allDates.sort()[0]);
}

export function getCompletionRate(state, dates = null) {
  const trackedDates = dates || eachDateBetween(getFirstTrackedDate(state), new Date());
  const totalSlots = trackedDates.length * state.habits.length;
  const completed = trackedDates.reduce((sum, date) => sum + getDayStats(state, toDateKey(date)).completed, 0);

  return {
    completed,
    total: totalSlots,
    percent: totalSlots ? Math.round((completed / totalSlots) * 100) : 0,
  };
}

export function getOverallStreaks(state) {
  const today = new Date();
  const dates = eachDateBetween(getFirstTrackedDate(state), today);
  let current = 0;
  let longest = 0;
  let run = 0;

  // Overall streaks are based on perfect days, while habit cards show per-habit streaks.
  dates.forEach((date) => {
    const stats = getDayStats(state, toDateKey(date));
    const isPerfect = stats.total > 0 && stats.completed === stats.total;
    run = isPerfect ? run + 1 : 0;
    longest = Math.max(longest, run);
  });

  for (let date = today; ; date = addDays(date, -1)) {
    const stats = getDayStats(state, toDateKey(date));
    if (!stats.total || stats.completed !== stats.total) break;
    current += 1;
  }

  return { current, longest };
}

export function getHabitStreak(state, habitId) {
  const today = new Date();
  const dates = eachDateBetween(getFirstTrackedDate(state), today);
  let current = 0;
  let longest = 0;
  let run = 0;

  dates.forEach((date) => {
    const complete = isHabitComplete(state, habitId, toDateKey(date));
    run = complete ? run + 1 : 0;
    longest = Math.max(longest, run);
  });

  for (let date = today; ; date = addDays(date, -1)) {
    if (!isHabitComplete(state, habitId, toDateKey(date))) break;
    current += 1;
  }

  return { current, longest };
}

export function getRecoveryState(state, habitId) {
  const today = toDateKey(new Date());
  const yesterday = toDateKey(addDays(new Date(), -1));
  const twoDaysAgo = toDateKey(addDays(new Date(), -2));
  const doneToday = isHabitComplete(state, habitId, today);
  const doneYesterday = isHabitComplete(state, habitId, yesterday);
  const doneTwoDaysAgo = isHabitComplete(state, habitId, twoDaysAgo);

  if (doneToday && !doneYesterday && doneTwoDaysAgo) {
    return { label: "Recovered today", tone: "success" };
  }

  if (doneToday) {
    return { label: "On track", tone: "success" };
  }

  if (doneYesterday) {
    return { label: "Protect today", tone: "warning" };
  }

  if (!doneYesterday && doneTwoDaysAgo) {
    return { label: "Recovery window", tone: "warning" };
  }

  return { label: "Ready to build", tone: "neutral" };
}

export function getWeeklyAnalytics(state) {
  const dates = getDateRange(new Date(), 7);

  return dates.map((date) => {
    const dateKey = toDateKey(date);
    return {
      date,
      dateKey,
      ...getDayStats(state, dateKey),
    };
  });
}

export function getMonthlyAnalytics(state, monthDate = new Date()) {
  const dates = getMonthDates(monthDate);
  const rate = getCompletionRate(state, dates);
  const perfectDays = dates.filter((date) => {
    const stats = getDayStats(state, toDateKey(date));
    return stats.total > 0 && stats.completed === stats.total;
  }).length;

  return {
    dates,
    completed: rate.completed,
    total: rate.total,
    percent: rate.percent,
    perfectDays,
  };
}

export function getConsistencyScore(state) {
  const last14 = getDateRange(new Date(), 14);
  const rate = getCompletionRate(state, last14);
  return rate.percent;
}

export function getProductivityScore(state) {
  const weekly = getCompletionRate(state, getDateRange(new Date(), 7)).percent;
  const monthly = getMonthlyAnalytics(state, new Date()).percent;
  const streak = getOverallStreaks(state).current;
  const streakBoost = Math.min(15, streak * 3);

  return Math.min(100, Math.round(weekly * 0.58 + monthly * 0.32 + streakBoost));
}

export function getHeatmapData(state, weeks = 18) {
  return getDateRange(new Date(), weeks * 7).map((date) => {
    const dateKey = toDateKey(date);
    const stats = getDayStats(state, dateKey);
    const level = stats.percent === 0 ? 0 : Math.min(4, Math.ceil(stats.percent / 25));

    return {
      date,
      dateKey,
      level,
      ...stats,
    };
  });
}

export function hasPerfectDay(state) {
  return Object.keys(state.completions).some((dateKey) => {
    const stats = getDayStats(state, dateKey);
    return stats.total > 0 && stats.completed === stats.total;
  });
}

export function getUnlockedAchievementIds(state) {
  const total = getTotalCompletions(state);
  const streaks = getOverallStreaks(state);
  const month = getMonthlyAnalytics(state, new Date());
  const unlocked = new Set();

  if (state.habits.length > 0) unlocked.add("first-habit");
  if (total >= 1) unlocked.add("first-completion");
  if (hasPerfectDay(state)) unlocked.add("perfect-day");
  if (total >= 7) unlocked.add("seven-checks");
  if (total >= 25) unlocked.add("twenty-five-checks");
  if (streaks.longest >= 7) unlocked.add("seven-day-streak");
  if (month.total > 0 && month.percent >= 80) unlocked.add("monthly-80");

  return ACHIEVEMENTS.filter((achievement) => unlocked.has(achievement.id)).map((achievement) => achievement.id);
}
