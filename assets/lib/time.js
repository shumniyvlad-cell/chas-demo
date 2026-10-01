// Работа с часовыми поясами без внешних библиотек: всё хранится в UTC (мс),
// стенные часы владельца считаются через Intl.

const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function zonedParts(ms, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second };
}

export function tzOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

export function isDateKey(s) {
  return typeof s === 'string' && DATE_RE.test(s);
}

export function isTime(s) {
  return typeof s === 'string' && TIME_RE.test(s) && (s !== '24:00' ? +s.slice(0, 2) < 24 : true);
}

export function minutesOf(time) {
  const [, h, m] = time.match(TIME_RE);
  return +h * 60 + +m;
}

// Стенное время в поясе tz -> UTC мс. Для поясов с переводом часов
// берётся смещение, действующее в получившийся момент.
export function zonedToUtc(dateKey, time, tz) {
  const [, y, mo, d] = dateKey.match(DATE_RE);
  const mins = minutesOf(time);
  const guess = Date.UTC(+y, +mo - 1, +d, 0, mins);
  const off1 = tzOffsetMs(guess, tz);
  const res = guess - off1;
  const off2 = tzOffsetMs(res, tz);
  return off2 === off1 ? res : guess - off2;
}

export function dateKey(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function addDays(key, n) {
  const [, y, m, d] = key.match(DATE_RE);
  const t = new Date(Date.UTC(+y, +m - 1, +d + n));
  return t.toISOString().slice(0, 10);
}

// 1 = понедельник ... 7 = воскресенье
export function isoWeekday(key) {
  const [, y, m, d] = key.match(DATE_RE);
  const wd = new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function hhmm(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

const WEEKDAYS = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// «пт, 3 октября, 15:00–16:00»
export function humanRange(start, end, tz) {
  const key = dateKey(start, tz);
  const p = zonedParts(start, tz);
  return `${WEEKDAYS[isoWeekday(key)]}, ${p.d} ${MONTHS[p.m]}, ${hhmm(start, tz)}–${hhmm(end, tz)}`;
}

export function tzLabel(tz) {
  if (tz === 'Europe/Moscow') return 'МСК';
  return tz;
}
