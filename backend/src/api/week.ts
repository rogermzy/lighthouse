import { Hono } from "hono";

// The week glance shows Mon–Sun with the date number and a load bar.
// Computed from the current date so the "today" highlight lands correctly
// regardless of when the seed was first loaded. `load` is a stable placeholder
// pattern — a real value would come from task-density per day, which we don't
// yet model (every task has a relative "due" string, not a date).
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const LOAD_PATTERN = [0.7, 0.9, 0.6, 0.45, 0.8, 0.2, 0.1];

function computeWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // JS Date.getDay(): 0 = Sunday. Convert so Monday = 0.
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isToday = d.getTime() === today.getTime();
    const isPast = d.getTime() < today.getTime();
    return {
      day: DAY_LABELS[i],
      date: d.getDate(),
      count: 0,
      load: LOAD_PATTERN[i],
      today: isToday,
      past: isPast,
    };
  });
}

export const weekApi = new Hono();

weekApi.get("/", (c) => c.json(computeWeek()));
