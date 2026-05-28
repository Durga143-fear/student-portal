import { HABIT_COLORS, STUDENT_TEMPLATES } from "./constants.js";
import { createEmptyState, createId, normalizeState } from "./storage.js";

const DEFAULT_ICON = "✓";
const TITLE_SEPARATOR = " ";

function dateOnly(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function graphemes(value) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment);
  }

  return Array.from(value);
}

function looksLikeIcon(value) {
  return Boolean(value && /\p{Extended_Pictographic}/u.test(value));
}

export function encodeHabitTitle(habit) {
  return `${habit.icon || DEFAULT_ICON}${TITLE_SEPARATOR}${habit.name || habit.title || "Untitled habit"}`.trim();
}

export function decodeHabitTitle(title) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { icon: DEFAULT_ICON, name: "Untitled habit" };

  const [first, ...rest] = graphemes(cleanTitle);
  const restText = rest.join("").trim();

  if (looksLikeIcon(first) && restText) {
    return { icon: first, name: restText };
  }

  return { icon: DEFAULT_ICON, name: cleanTitle };
}

function rowToHabit(row, index = 0) {
  const decoded = decodeHabitTitle(row.title);

  return {
    id: row.id,
    name: decoded.name,
    icon: decoded.icon,
    color: row.color || HABIT_COLORS[index % HABIT_COLORS.length],
    createdAt: dateOnly(row.created_at),
    updatedAt: row.created_at || new Date().toISOString(),
  };
}

function rowsToCompletions(logRows) {
  return logRows.reduce((completions, row) => {
    if (!row.completed) return completions;

    const dateKey = dateOnly(row.date);
    completions[dateKey] = completions[dateKey] || {};
    completions[dateKey][row.habit_id] = true;
    return completions;
  }, {});
}

function throwIfMissingUser(userId) {
  if (!userId) {
    throw new Error("A signed-in Supabase user is required.");
  }
}

export async function fetchUserHabitState(client, userId, settings = {}) {
  throwIfMissingUser(userId);

  const [habitsResult, logsResult] = await Promise.all([
    client
      .from("habits")
      .select("id,user_id,title,color,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    client
      .from("habit_logs")
      .select("id,habit_id,user_id,completed,date")
      .eq("user_id", userId),
  ]);

  if (habitsResult.error) throw habitsResult.error;
  if (logsResult.error) throw logsResult.error;

  return {
    ...createEmptyState(settings),
    habits: habitsResult.data.map(rowToHabit),
    completions: rowsToCompletions(logsResult.data),
  };
}

export async function ensureStarterHabits(client, userId, settings = {}) {
  const current = await fetchUserHabitState(client, userId, settings);
  if (current.habits.length > 0) return current;

  const rows = STUDENT_TEMPLATES.slice(0, 4).map((template) => ({
    id: createId(),
    user_id: userId,
    title: encodeHabitTitle({ name: template.name, icon: template.icon }),
    color: template.color,
    created_at: new Date().toISOString(),
  }));

  const { error } = await client.from("habits").insert(rows);
  if (error) throw error;

  return fetchUserHabitState(client, userId, settings);
}

export async function createHabitRow(client, userId, habit) {
  throwIfMissingUser(userId);

  const { data, error } = await client
    .from("habits")
    .insert({
      id: createId(),
      user_id: userId,
      title: encodeHabitTitle(habit),
      color: habit.color,
      created_at: new Date().toISOString(),
    })
    .select("id,user_id,title,color,created_at")
    .single();

  if (error) throw error;
  return rowToHabit(data);
}

export async function updateHabitRow(client, userId, habit) {
  throwIfMissingUser(userId);

  const { data, error } = await client
    .from("habits")
    .update({
      title: encodeHabitTitle(habit),
      color: habit.color,
    })
    .eq("user_id", userId)
    .eq("id", habit.id)
    .select("id,user_id,title,color,created_at")
    .single();

  if (error) throw error;
  return rowToHabit(data);
}

export async function deleteHabitRow(client, userId, habitId) {
  throwIfMissingUser(userId);

  const logsResult = await client
    .from("habit_logs")
    .delete()
    .eq("user_id", userId)
    .eq("habit_id", habitId);
  if (logsResult.error) throw logsResult.error;

  const habitResult = await client
    .from("habits")
    .delete()
    .eq("user_id", userId)
    .eq("id", habitId);
  if (habitResult.error) throw habitResult.error;
}

export async function setCompletionRow(client, userId, habitId, dateKey, completed) {
  throwIfMissingUser(userId);

  const existing = await client
    .from("habit_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("habit_id", habitId)
    .eq("date", dateKey)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const { error } = await client
      .from("habit_logs")
      .update({ completed })
      .eq("user_id", userId)
      .eq("id", existing.data.id);
    if (error) throw error;
    return;
  }

  const { error } = await client.from("habit_logs").insert({
    id: createId(),
    habit_id: habitId,
    user_id: userId,
    completed,
    date: dateKey,
  });

  if (error) throw error;
}

export async function replaceUserStateFromBackup(client, userId, backup, settings = {}) {
  throwIfMissingUser(userId);

  const importedState = normalizeState(backup);
  const habitIdMap = new Map();

  const deleteLogs = await client.from("habit_logs").delete().eq("user_id", userId);
  if (deleteLogs.error) throw deleteLogs.error;

  const deleteHabits = await client.from("habits").delete().eq("user_id", userId);
  if (deleteHabits.error) throw deleteHabits.error;

  const habitRows = importedState.habits.map((habit) => {
    const id = createId();
    habitIdMap.set(habit.id, id);

    return {
      id,
      user_id: userId,
      title: encodeHabitTitle(habit),
      color: habit.color,
      created_at: new Date().toISOString(),
    };
  });

  if (habitRows.length) {
    const { error } = await client.from("habits").insert(habitRows);
    if (error) throw error;
  }

  const logRows = [];
  Object.entries(importedState.completions).forEach(([dateKey, day]) => {
    Object.entries(day).forEach(([oldHabitId, completed]) => {
      const habitId = habitIdMap.get(oldHabitId);
      if (!habitId || completed !== true) return;

      logRows.push({
        id: createId(),
        habit_id: habitId,
        user_id: userId,
        completed: true,
        date: dateKey,
      });
    });
  });

  if (logRows.length) {
    const { error } = await client.from("habit_logs").insert(logRows);
    if (error) throw error;
  }

  return fetchUserHabitState(client, userId, settings);
}
