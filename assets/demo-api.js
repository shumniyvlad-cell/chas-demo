// Демо для GitHub Pages: тот же API, что у сервера, только в браузере.
// Логика слотов, цен и билета — общие модули из src/ (lib/), записи — в localStorage.
// Оплата тестовая; у каждого посетителя свои записи.
import { buildCalendar } from './lib/calendar/ics.js';
import { clientEvent, ticketView } from './lib/present.js';
import { normalizeSettings, priceFor } from './lib/settings.js';
import { buildSlots, isBookableStart } from './lib/slots.js';
import { effectiveStatus } from './lib/status.js';
import { addDays, dateKey, isoWeekday, zonedToUtc } from './lib/time.js';

const KEY = 'chas-demo:bookings';
const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MIN = 60_000;
// В демо — настройки по умолчанию (те же, что у свежего сервера)
const settings = normalizeSettings({});

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function random(length, alphabet) {
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (v) => alphabet[v % alphabet.length]).join('');
}

// Чтобы календарь выглядел живым: часть времени «занята». Детерминированно по дате,
// одинаково у всех посетителей.
function demoBusy(fromDate, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const [window] = settings.schedule[isoWeekday(date)] || [];
    if (!window) continue;
    let h = 7;
    for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    if (h % 4 === 0) continue;
    const first = Number(window[0].slice(0, 2));
    const span = Math.max(1, Number(window[1].slice(0, 2)) - first - 1);
    const start = zonedToUtc(date, `${String(first + (h % span)).padStart(2, '0')}:00`, settings.timezone);
    out.push({ start, end: start + (h % 2 ? 90 : 60) * MIN });
    if (h % 3 === 0) out.push({ start: start + 180 * MIN, end: start + 240 * MIN });
  }
  return out;
}

function busy(now, excludeId = null) {
  const own = load()
    .filter((b) => b.id !== excludeId && ['confirmed', 'hold'].includes(effectiveStatus(b, now)))
    .map((b) => ({ start: b.start_at, end: b.end_at }));
  return own.concat(demoBusy(dateKey(now, settings.timezone), settings.horizonDays + 2));
}

function find(id, token) {
  const b = load().find((x) => x.id === id);
  if (!b || !token || b.token !== token) fail(404, 'not_found', 'Билет не найден');
  return b;
}

function update(id, patch) {
  const list = load();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch };
  save(list);
  return list[i];
}

const payment = (b) => ({ action: 'mock-pay.html', method: 'GET', fields: { id: b.id, k: b.token } });

function createBooking(input, now) {
  const format = String(input.format || '');
  const duration = Number(input.duration);
  const start = Number(input.start);
  const name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const contact = String(input.contact || '').trim().slice(0, 80);
  if (!settings.formats[format]?.enabled) fail(400, 'bad_format', 'Такого формата встречи нет');
  if (!settings.durations.includes(duration)) fail(400, 'bad_duration', 'Такой длительности нет');
  if (name.length < 2) fail(400, 'bad_name', 'Как тебя зовут?');
  if (contact.length < 3) fail(400, 'bad_contact', 'Оставь Telegram или телефон для связи');
  if (input.consent !== true) fail(400, 'no_consent', 'Нужно согласие на обработку данных');

  const old = input.replace?.id && load().find((x) => x.id === input.replace.id);
  if (old && old.token === input.replace.token && old.status === 'hold') update(old.id, { status: 'expired' });
  if (!isBookableStart({ settings, now, start, duration, busy: busy(now) })) {
    fail(409, 'slot_taken', 'Этот слот только что заняли — выбери другой');
  }
  const b = {
    id: random(6, CODE),
    token: random(24, TOKEN),
    status: 'hold',
    format,
    start_at: start,
    end_at: start + duration * MIN,
    duration_min: duration,
    price: priceFor(settings, format, duration),
    name,
    contact,
    topic: String(input.topic || '').slice(0, 1000),
    hold_until: now + settings.holdMinutes * MIN,
    created_at: now,
  };
  save([...load(), b]);
  return {
    id: b.id,
    token: b.token,
    price: b.price,
    holdUntil: b.hold_until,
    ticketUrl: `ticket.html?id=${b.id}&k=${b.token}`,
    payment: payment(b),
  };
}

export async function request(path, { method = 'GET', body } = {}) {
  const url = new URL(path, location.href);
  const route = url.pathname.slice(url.pathname.indexOf('/api/'));
  const now = Date.now();

  if (method === 'GET' && route === '/api/slots') {
    const format = url.searchParams.get('format');
    const duration = Number(url.searchParams.get('duration'));
    if (!settings.formats[format]?.enabled || !settings.durations.includes(duration)) {
      fail(400, 'bad_request', 'Неверный формат или длительность');
    }
    const days = Math.min(Number(url.searchParams.get('days')) || 14, settings.horizonDays + 1);
    const fromDate = url.searchParams.get('from') || dateKey(now, settings.timezone);
    const own = url.searchParams.get('hold');
    return {
      timezone: settings.timezone,
      days: buildSlots({ settings, now, fromDate, days, duration, busy: busy(now, own) }),
    };
  }

  if (method === 'POST' && route === '/api/bookings') return createBooking(body || {}, now);

  const m = route.match(/^\/api\/bookings\/([A-Z2-9]{6})(\/pay|\/release)?$/);
  if (m) {
    const [, id, action] = m;
    if (!action && method === 'GET') return ticketView(find(id, url.searchParams.get('k')), settings, now);
    const b = find(id, body?.k);
    if (action === '/release') {
      if (b.status === 'hold') update(id, { status: 'expired' });
      return { ok: true };
    }
    if (action === '/pay') {
      const status = effectiveStatus(b, now);
      if (status === 'expired') {
        if (!isBookableStart({ settings, now, start: b.start_at, duration: b.duration_min, busy: busy(now, b.id) })) {
          fail(409, 'slot_taken', 'Это время уже недоступно — выбери другое');
        }
        update(id, { status: 'hold', hold_until: now + settings.holdMinutes * MIN });
      } else if (status !== 'hold') {
        fail(409, 'not_payable', 'Эту бронь уже нельзя оплатить');
      }
      return { holdUntil: now + settings.holdMinutes * MIN, payment: payment(b) };
    }
  }
  fail(404, 'not_found', 'Нет такого запроса');
}

// «Оплата» на тестовой странице
export function pay(id, token) {
  const b = find(id, token);
  if (['hold', 'expired'].includes(b.status)) {
    update(id, { status: 'confirmed', paid_at: Date.now(), paid_amount: b.price.toFixed(2) });
  }
}

// .ics для кнопки «Добавить в календарь»
export function ics(id, token) {
  const b = find(id, token);
  const base = location.href.replace(/\/[^/]*$/, '');
  return buildCalendar({ method: 'PUBLISH', events: [clientEvent(b, settings, base)] });
}
