import {
  $,
  $$,
  api,
  dayLabel,
  drawBarcode,
  durationText,
  makeFormat,
  rub,
  setMoney,
  setupMotion,
  submitPayment,
  tzShort,
} from './common.js';

const config = JSON.parse($('#config').textContent);
setupMotion();

const fmt = makeFormat(config.timezone);
const tz = tzShort(config.timezone);
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const HOLD_KEY = 'chas:hold';

const formatKeys = Object.keys(config.formats);
const state = {
  format: formatKeys[0],
  duration: config.durations.includes(60) ? 60 : config.durations[0],
  days: [],
  date: null,
  slot: null,
  request: 0,
};

const el = {
  form: $('[data-form]'),
  formats: $('[data-formats]'),
  durations: $('[data-durations]'),
  days: $('[data-days]'),
  times: $('[data-times]'),
  empty: $('[data-empty]'),
  tzHint: $('[data-tz-hint]'),
  pay: $('[data-pay]'),
  error: $('[data-error]'),
  nextSlot: $('[data-next-slot]'),
};

const price = () => Math.round((config.formats[state.format].pricePerHour * state.duration) / 60);

function radio(name, value, faceHtml, { checked = false, disabled = false } = {}) {
  const label = document.createElement('label');
  label.className = 'choice';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.disabled = disabled;
  const face = document.createElement('span');
  face.className = 'face';
  face.append(...faceHtml);
  label.append(input, face);
  return label;
}

function span(className, text) {
  const s = document.createElement('span');
  if (className) s.className = className;
  s.textContent = text;
  return s;
}

// ---------- шапка и статичные подписи ----------

if (config.testMode) $('[data-testbar]').hidden = false;
if (!config.telegram) $$('[data-tg]').forEach((a) => a.remove());
if (config.paymentTypes.includes('PC')) $('[data-pay-type]').hidden = false;

{
  const parts = formatKeys.map((key, i) => {
    const f = config.formats[key];
    const title = i === 0 ? f.title : f.title.toLowerCase();
    return `${title} — ${rub(f.pricePerHour)} за час`;
  });
  $('[data-rates]').textContent = `${parts.join(', ')}.`;
  $('[data-hold-note]').textContent = `После нажатия «Оплатить» слот держится за тобой ${config.holdMinutes} минут.`;
  $('[data-how-hold]').textContent =
    `Пока идёт оплата, время держится за тобой ${config.holdMinutes} минут. Без оплаты бронь сгорает сама.`;
  drawBarcode($('[data-barcode]'), 'CHAS');
}

// ---------- шаги ----------

function renderFormats() {
  el.formats.replaceChildren(
    ...formatKeys.map((key) => {
      const f = config.formats[key];
      return radio(
        'format',
        key,
        [span('format-title', f.title), span('format-price', `${rub(f.pricePerHour)} за час`), span('format-place', f.place)],
        { checked: key === state.format },
      );
    }),
  );
}

function renderDurations() {
  const perHour = config.formats[state.format].pricePerHour;
  el.durations.replaceChildren(
    ...config.durations.map((d) => {
      const b = document.createElement('b');
      b.textContent = durationText(d);
      return radio('duration', d, [b, document.createTextNode(`  ${rub(Math.round((perHour * d) / 60))}`)], {
        checked: d === state.duration,
      });
    }),
  );
}

function renderDays() {
  el.days.replaceChildren(
    ...state.days.map((day) => {
      const l = dayLabel(day.date);
      const node = radio('day', day.date, [span('day-wd', l.weekday), span('day-num', l.day), span('day-mon', l.month)], {
        checked: day.date === state.date,
        disabled: day.slots.length === 0,
      });
      node.title = day.slots.length ? `${day.slots.length} свободных окон` : 'Нет свободных окон';
      node.querySelector('input').setAttribute('aria-label', day.slots.length ? l.long : `${l.long}, нет свободных окон`);
      return node;
    }),
  );
  const any = state.days.some((d) => d.slots.length);
  el.empty.hidden = any;
  el.days.hidden = !any;
  if (!any) {
    el.empty.textContent = config.telegram
      ? 'Свободных окон пока нет. Напиши в Telegram — подберём время.'
      : 'Свободных окон пока нет. Загляни позже.';
  }
}

function renderTimes() {
  const day = state.days.find((d) => d.date === state.date);
  el.times.replaceChildren(
    ...(day ? day.slots : []).map((s) =>
      radio('time', s.start, [document.createTextNode(fmt.time(s.start))], { checked: state.slot?.start === s.start }),
    ),
  );
  renderTzHint();
}

function renderTzHint() {
  if (!state.slot) {
    el.tzHint.textContent = browserTz === config.timezone || !browserTz ? `Время ${tz === 'мск' ? 'московское' : tz}.` : `Время указано по ${tz === 'мск' ? 'Москве' : tz}.`;
    return;
  }
  if (browserTz && browserTz !== config.timezone) {
    el.tzHint.textContent = `${fmt.time(state.slot.start)} ${tz} — это ${localTime.format(state.slot.start)} по твоему времени.`;
  } else {
    el.tzHint.textContent = `Время ${tz === 'мск' ? 'московское' : tz}.`;
  }
}

async function loadSlots() {
  const request = ++state.request;
  el.times.setAttribute('aria-busy', 'true');
  const hold = readHold();
  const own = hold ? `&hold=${encodeURIComponent(hold.id)}&k=${encodeURIComponent(hold.token)}` : '';
  try {
    const data = await api(
      `/api/slots?format=${encodeURIComponent(state.format)}&duration=${state.duration}&days=${config.horizonDays + 1}${own}`,
    );
    if (request !== state.request) return;
    state.days = data.days;
  } catch (err) {
    if (request !== state.request) return;
    state.days = [];
    el.error.textContent = err.message;
  } finally {
    el.times.removeAttribute('aria-busy');
  }
  const withSlots = state.days.filter((d) => d.slots.length);
  if (!withSlots.some((d) => d.date === state.date)) state.date = withSlots[0]?.date ?? null;
  const day = state.days.find((d) => d.date === state.date);
  if (state.slot && !day?.slots.some((s) => s.start === state.slot.start)) state.slot = null;
  renderDays();
  renderTimes();
  updateTicket();
  updateNextSlot();
}

function updateNextSlot() {
  const first = state.days.find((d) => d.slots.length)?.slots[0];
  el.nextSlot.textContent = first ? `Ближайшее свободное окно: ${fmt.date(first.start)}, ${fmt.time(first.start)}\u00A0${tz}` : '';
}

// ---------- билет ----------

const shown = new Map();

// Значение «печатается» на билете; имя при наборе не перепечатывается на каждую букву
function printValue(node, value, { quiet = false } = {}) {
  const text = value || '—';
  const before = shown.get(node);
  if (before === text) return;
  shown.set(node, text);
  if (node.dataset.t === 'total') setMoney(node, value);
  else node.textContent = text;
  node.classList.toggle('blank', !value);
  if (quiet && before && before !== '—') return;
  node.classList.remove('printed');
  void node.offsetWidth; // перезапуск анимации печати
  if (value) node.classList.add('printed');
}



function updateTicket() {
  const f = config.formats[state.format];
  const name = el.form.elements.name.value.trim();
  printValue($('[data-t="format"]'), `${f.title.toLowerCase()}, ${durationText(state.duration)}`);
  printValue($('[data-t="date"]'), state.slot ? fmt.date(state.slot.start) : '');
  printValue($('[data-t="time"]'), state.slot ? `${fmt.range(state.slot.start, state.slot.end)}\u00A0${tz}` : '');
  printValue($('[data-t="guest"]'), name, { quiet: true });
  printValue($('[data-t="total"]'), rub(price()));
  el.pay.textContent = `Оплатить ${rub(price())}`;
}

// ---------- события ----------

el.form.addEventListener('change', (e) => {
  const t = e.target;
  el.error.textContent = '';
  if (t.name === 'format') {
    state.format = t.value;
    renderDurations();
    loadSlots();
  } else if (t.name === 'duration') {
    state.duration = Number(t.value);
    loadSlots();
  } else if (t.name === 'day') {
    state.date = t.value;
    state.slot = null;
    renderTimes();
  } else if (t.name === 'time') {
    const day = state.days.find((d) => d.date === state.date);
    state.slot = day.slots.find((s) => s.start === Number(t.value)) || null;
    renderTzHint();
    clearInvalid('when');
  } else if (t.name === 'consent') {
    $('[data-consent]').classList.remove('invalid');
  }
  updateTicket();
});

el.form.addEventListener('input', (e) => {
  el.error.textContent = '';
  if (e.target.name === 'name' || e.target.name === 'contact') {
    e.target.removeAttribute('aria-invalid');
    if (e.target.name === 'name') updateTicket();
  }
});

function clearInvalid(step) {
  $(`[data-step="${step}"]`).classList.remove('invalid');
}

function validate() {
  const problems = [];
  const f = el.form.elements;
  if (!state.slot) {
    $('[data-step="when"]').classList.add('invalid');
    problems.push({ focus: el.times.querySelector('input') || el.days.querySelector('input:not(:disabled)'), text: 'Выбери день и время' });
  }
  if (f.name.value.trim().length < 2) {
    f.name.setAttribute('aria-invalid', 'true');
    problems.push({ focus: f.name, text: 'Напиши, как тебя зовут' });
  }
  if (f.contact.value.trim().length < 3) {
    f.contact.setAttribute('aria-invalid', 'true');
    problems.push({ focus: f.contact, text: 'Оставь Telegram или телефон' });
  }
  if (!f.consent.checked) {
    $('[data-consent]').classList.add('invalid');
    problems.push({ focus: f.consent, text: 'Отметь согласие на обработку данных' });
  }
  return problems;
}

function readHold() {
  try {
    return JSON.parse(sessionStorage.getItem(HOLD_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeHold(hold) {
  try {
    if (hold) sessionStorage.setItem(HOLD_KEY, JSON.stringify(hold));
    else sessionStorage.removeItem(HOLD_KEY);
  } catch {}
}

el.pay.addEventListener('click', async () => {
  el.error.textContent = '';
  const problems = validate();
  if (problems.length) {
    el.error.textContent = problems.map((p) => p.text).join('. ') + '.';
    problems[0].focus?.focus();
    return;
  }
  const f = el.form.elements;
  const paymentType = $('[data-pay-type] input:checked')?.value || 'AC';
  el.pay.disabled = true;
  el.pay.textContent = 'Готовлю оплату…';
  try {
    const res = await api('/api/bookings', {
      method: 'POST',
      body: {
        format: state.format,
        duration: state.duration,
        start: state.slot.start,
        name: f.name.value,
        contact: f.contact.value,
        topic: f.topic.value,
        consent: f.consent.checked,
        paymentType,
        replace: readHold(),
      },
    });
    writeHold({ id: res.id, token: res.token });
    submitPayment(res.payment);
  } catch (err) {
    el.error.textContent = err.message;
    el.pay.disabled = false;
    updateTicket();
    if (err.code === 'slot_taken') {
      state.slot = null;
      loadSlots();
    }
  }
});

// Вернулись со страницы оплаты кнопкой «назад» — кнопка снова живая
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    el.pay.disabled = false;
    updateTicket();
    loadSlots();
  }
});

renderFormats();
renderDurations();
updateTicket();
renderTzHint();
loadSlots();
