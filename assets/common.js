// Общие помощники для страниц сайта.

// Демо-сборка для GitHub Pages: сервера нет, API отвечает из браузера (demo-api.js)
export const DEMO = document.documentElement.dataset.demo === '1';
export const HOME = DEMO ? './' : '/';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Анимации: уважаем «Уменьшить движение», но ?motion=1 включает их принудительно
// (и запоминается), ?motion=0 — выключает.
export function setupMotion() {
  const param = new URLSearchParams(location.search).get('motion');
  try {
    if (param === '1' || param === '0') localStorage.setItem('motion', param);
  } catch {}
  let forced = null;
  try {
    forced = localStorage.getItem('motion');
  } catch {}
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = forced === '1' || (forced !== '0' && !reduced);
  document.documentElement.dataset.motion = on ? 'on' : 'off';
  return on;
}

export async function api(path, { method = 'GET', body } = {}) {
  if (DEMO) {
    const demo = await import('./demo-api.js');
    return demo.request(path, { method, body });
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw Object.assign(new Error('Нет связи с сервером. Проверь интернет и попробуй ещё раз'), { code: 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || `Ошибка ${res.status}`), { status: res.status, code: data.error });
  }
  return data;
}

const rubFormat = new Intl.NumberFormat('ru-RU');
export const rub = (n) => `${rubFormat.format(n)}\u00A0₽`;

// Знака рубля нет в плакатном шрифте — он набирается текстовым
export function setMoney(node, text) {
  const m = /^(.*?)\s?₽$/.exec(text || '');
  if (!m) {
    node.textContent = text || '—';
    return;
  }
  const cur = document.createElement('span');
  cur.className = 'cur';
  cur.textContent = '₽';
  node.replaceChildren(document.createTextNode(`${m[1]} `), cur);
}

export function durationText(min) {
  if (min % 60 === 0) {
    const h = min / 60;
    return `${h} ${h === 1 ? 'час' : h < 5 ? 'часа' : 'часов'}`;
  }
  if (min > 60) return `${Math.floor(min / 60)} ч ${min % 60} мин`;
  return `${min} минут`;
}

// Форматтеры в поясе владельца (по умолчанию Москва)
export function makeFormat(tz) {
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const weekday = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, weekday: 'short' });
  const weekdayLong = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, weekday: 'long' });
  const dayMonth = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' });
  const monthShort = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, month: 'short' });
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric' });
  return {
    time: (ms) => time.format(ms),
    range: (a, b) => `${time.format(a)}–${time.format(b)}`,
    weekday: (ms) => weekday.format(ms).replace('.', ''),
    weekdayLong: (ms) => weekdayLong.format(ms),
    dayMonth: (ms) => dayMonth.format(ms),
    monthShort: (ms) => monthShort.format(ms).replace('.', ''),
    day: (ms) => day.format(ms),
    // «вт, 6 октября»
    date: (ms) => `${weekday.format(ms).replace('.', '')}, ${dayMonth.format(ms)}`,
  };
}

export function tzShort(tz) {
  return tz === 'Europe/Moscow' ? 'мск' : tz;
}

// Подписи для календарной даты 'YYYY-MM-DD' (без часовых поясов)
const keyWeekday = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short' });
const keyMonth = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short' });
const keyLong = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
export function dayLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  return {
    weekday: keyWeekday.format(noon).replace('.', ''),
    day: String(d),
    month: keyMonth.format(noon).replace('.', ''),
    long: keyLong.format(noon),
  };
}

// Отправка формы оплаты: ЮMoney ждёт обычный POST формы, не fetch
export function submitPayment(payment) {
  const form = document.createElement('form');
  form.method = payment.method || 'POST';
  form.action = payment.action;
  for (const [name, value] of Object.entries(payment.fields || {})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

// Декоративный штрихкод из кода брони: одинаковый код — одинаковый рисунок
export function drawBarcode(svg, seed) {
  const ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  let h = 2166136261;
  const text = seed || 'CHAS';
  let x = 0;
  while (x < 116) {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i) ^ x, 16777619);
    const w = 1 + ((h >>> 3) % 3);
    const gap = 1 + ((h >>> 7) % 3);
    if (x + w > 116) break;
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', x);
    r.setAttribute('y', 0);
    r.setAttribute('width', w);
    r.setAttribute('height', 52);
    svg.append(r);
    x += w + gap;
  }
}
