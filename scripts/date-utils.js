const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, "0");
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function toDateKey(date = new Date()) {
  const day = startOfDay(date);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

export function fromDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date, amount) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function isSameDay(first, second) {
  return toDateKey(first) === toDateKey(second);
}

export function isSameMonth(date, monthDate) {
  return date.getFullYear() === monthDate.getFullYear() && date.getMonth() === monthDate.getMonth();
}

export function getMonthMatrix(monthDate) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = addDays(firstDay, -firstDay.getDay());

  // A fixed 6-week matrix keeps the calendar stable while navigating months.
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function getMonthDates(monthDate) {
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  return Array.from(
    { length: daysInMonth },
    (_, index) => new Date(monthDate.getFullYear(), monthDate.getMonth(), index + 1),
  );
}

export function getDateRange(endDate, count) {
  const end = startOfDay(endDate);
  const start = addDays(end, -(count - 1));
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function eachDateBetween(startDate, endDate) {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  const total = Math.max(0, Math.round((end - start) / DAY_MS));

  return Array.from({ length: total + 1 }, (_, index) => addDays(start, index));
}

export function daysBetween(startDate, endDate) {
  return Math.round((startOfDay(endDate) - startOfDay(startDate)) / DAY_MS);
}

export function formatMonthYear(date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

export function formatLongDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function formatWeekday(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

export function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((startOfDay(date) - start) / DAY_MS);
}
