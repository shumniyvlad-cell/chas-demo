import { addDays, dateKey, isoWeekday, zonedToUtc } from './time.js';

const MIN = 60_000;

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// busy: [{ start, end }] в UTC мс — брони, удержания, блокировки, события календаря.
// Буфер раздвигает слот в обе стороны: между встречами остаётся воздух.
export function buildSlots({ settings, now, fromDate, days, duration, busy = [] }) {
  const tz = settings.timezone;
  const today = dateKey(now, tz);
  const lastDate = addDays(today, settings.horizonDays);
  const earliest = now + settings.minNoticeHours * 60 * MIN;
  const buffer = settings.bufferMin * MIN;
  const step = settings.slotStep * MIN;
  const length = duration * MIN;
  const result = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    if (date < today) continue;
    if (date > lastDate) break;
    const slots = [];
    for (const [from, to] of settings.schedule[isoWeekday(date)] || []) {
      const windowStart = zonedToUtc(date, from, tz);
      const windowEnd = zonedToUtc(date, to, tz);
      for (let start = windowStart; start + length <= windowEnd; start += step) {
        if (start < earliest) continue;
        const end = start + length;
        if (busy.some((b) => overlaps(start - buffer, end + buffer, b.start, b.end))) continue;
        slots.push({ start, end });
      }
    }
    result.push({ date, slots });
  }
  return result;
}

// Проверка конкретного старта: совпадает ли он с сеткой и свободен ли.
export function isBookableStart({ settings, now, start, duration, busy }) {
  const date = dateKey(start, settings.timezone);
  const [day] = buildSlots({ settings, now, fromDate: date, days: 1, duration, busy });
  return Boolean(day && day.slots.some((s) => s.start === start));
}
