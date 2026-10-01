import { $, api, DEMO, drawBarcode, durationText, HOME, makeFormat, rub, setMoney, setupMotion, submitPayment, tzShort } from './common.js';

const demo = DEMO ? await import('./demo-api.js') : null;

const config = JSON.parse($('#config').textContent);
setupMotion();

const fmt = makeFormat(config.timezone);
const tz = tzShort(config.timezone);
const params = new URLSearchParams(location.search);
const id = params.get('id') || location.pathname.split('/').filter(Boolean).at(-1) || '';
const token = params.get('k') || '';
const cameFromPayment = params.get('paid') === '1';
const POLL_MS = 2500;
const POLL_LIMIT_MS = 120_000;
const pollStarted = Date.now();
let countdownTimer = null;

if (config.testMode) $('[data-testbar]').hidden = false;
if (!config.telegram) $('[data-tg]')?.remove();

const tgUrl = config.telegram ? `https://t.me/${config.telegram}` : null;

function button(text, { href, onClick, ghost = false, download = null } = {}) {
  const node = document.createElement(href ? 'a' : 'button');
  node.className = ghost ? 'btn btn-ghost' : 'btn';
  node.textContent = text;
  if (href) {
    node.href = href;
    if (download) node.setAttribute('download', download);
    if (/^https?:/.test(href)) {
      node.target = '_blank';
      node.rel = 'noopener';
    }
  } else {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }
  return node;
}

function setStatus(title, text, actions = []) {
  $('[data-title]').textContent = title;
  const t = $('[data-text]');
  t.replaceChildren(...(Array.isArray(text) ? text : [text]).map((x) => (typeof x === 'string' ? document.createTextNode(x) : x)));
  $('[data-actions]').replaceChildren(...actions);
}

function fact(label, content) {
  const li = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = label;
  li.append(b, ...(Array.isArray(content) ? content : [content]).map((x) => (typeof x === 'string' ? document.createTextNode(x) : x)));
  return li;
}

function link(text, href) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function renderTicket(t) {
  const node = $('[data-ticket]');
  node.hidden = false;
  node.classList.toggle('void', t.status === 'expired' || t.status === 'cancelled');
  $('[data-t-num]').textContent = `№ ${t.id}`;
  $('[data-t="format"]').textContent = `${t.formatTitle.toLowerCase()}, ${durationText(t.duration)}`;
  $('[data-t="date"]').textContent = fmt.date(t.start);
  $('[data-t="time"]').textContent = `${fmt.range(t.start, t.end)} ${tz}`;
  $('[data-t="guest"]').textContent = t.name;
  setMoney($('[data-t="total"]'), rub(t.price));
  $('[data-t-total-label]').textContent = ['confirmed', 'attention', 'conflict'].includes(t.status) ? 'оплачено' : 'к оплате';
  const stamped = ['confirmed', 'attention', 'conflict', 'expired', 'cancelled'].includes(t.status);
  $('[data-t-stub]').textContent = stamped ? '' : 'Билет действует после оплаты.';
  drawBarcode($('[data-barcode]'), t.id);

  const stamp = $('[data-stamp]');
  const stamps = { confirmed: 'Оплачено', attention: 'Оплачено', conflict: 'Оплачено', expired: 'Сгорел', cancelled: 'Отменён' };
  stamp.hidden = !stamps[t.status];
  stamp.textContent = (stamps[t.status] || '').toUpperCase();
}

async function pay(t) {
  const btn = this instanceof HTMLElement ? this : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Готовлю оплату…';
  }
  try {
    const res = await api(`/api/bookings/${encodeURIComponent(t.id)}/pay`, { method: 'POST', body: { k: token } });
    submitPayment(res.payment);
  } catch (err) {
    setStatus('Оплатить не получилось', err.message, [button('Выбрать другое время', { href: `${HOME}#book` })]);
  }
}

async function release(t) {
  try {
    await api(`/api/bookings/${encodeURIComponent(t.id)}/release`, { method: 'POST', body: { k: token } });
  } catch {}
  location.href = `${HOME}#book`;
}

// На сервере .ics отдаёт сервер; в демо файл собирается прямо в браузере
function calendarHref(t) {
  if (demo) return URL.createObjectURL(new Blob([demo.ics(t.id, token)], { type: 'text/calendar' }));
  return `/t/${t.id}/calendar.ics?k=${encodeURIComponent(token)}`;
}

function startCountdown(until, node) {
  clearInterval(countdownTimer);
  const tick = () => {
    const left = Math.max(0, until - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    node.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (left === 0) {
      clearInterval(countdownTimer);
      load();
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function render(t) {
  renderTicket(t);
  $('[data-facts]').hidden = true;
  const tgButton = tgUrl ? [button('Написать в Telegram', { href: tgUrl, ghost: true })] : [];

  // Вернулись с оплаты: уведомление ЮMoney может прийти чуть позже, даже если
  // удержание уже сгорело — платёж всё равно подтвердит бронь, ждём его.
  const waiting = t.status === 'hold' || t.status === 'expired';
  if (waiting && cameFromPayment && Date.now() - pollStarted < POLL_LIMIT_MS) {
    const spin = document.createElement('span');
    spin.className = 'spinner';
    setStatus('Проверяю оплату', [spin, ' ЮMoney сообщает об оплате за несколько секунд. Страница обновится сама.']);
    setTimeout(load, POLL_MS);
    return;
  }

  if (t.status === 'hold') {
    const left = document.createElement('span');
    left.className = 'countdown';
    const text = cameFromPayment
      ? ['Подтверждение оплаты задерживается. Если деньги списались, бронь подтвердится сама — загляни сюда чуть позже. Слот держится ещё ', left, '.']
      : ['Слот держится за тобой ещё ', left, '. Без оплаты бронь сгорит, и время вернётся в календарь.'];
    setStatus(cameFromPayment ? 'Ждём подтверждение' : 'Бронь ждёт оплаты', text, [
      button(`Оплатить ${rub(t.price)}`, { onClick: function () { pay.call(this, t); } }),
      button('Выбрать другое время', { ghost: true, onClick: () => release(t) }),
    ]);
    startCountdown(t.holdUntil, left);
    return;
  }

  clearInterval(countdownTimer);

  if (t.status === 'confirmed') {
    setStatus('Встреча оплачена', 'Это твой билет. Сохрани ссылку на эту страницу или добавь встречу в календарь.', [
      button('Добавить в календарь', { href: calendarHref(t), download: `vstrecha-${t.id}.ics` }),
      ...tgButton,
    ]);
    const facts = [fact('Когда', `${fmt.weekdayLong(t.start)}, ${fmt.dayMonth(t.start)}, ${fmt.range(t.start, t.end)} ${tz}`)];
    if (t.format === 'online') {
      facts.push(
        t.link
          ? fact('Ссылка на созвон', link(t.link, t.link))
          : fact('Ссылка на созвон', 'Пришлю в Telegram перед встречей.'),
      );
    } else {
      facts.push(fact('Где', t.place || 'Место пришлю в Telegram.'));
    }
    facts.push(fact('Перенос', 'Напиши в Telegram заранее — подберём другое время.'));
    $('[data-facts]').replaceChildren(...facts);
    $('[data-facts]').hidden = false;
    try {
      sessionStorage.removeItem('chas:hold');
    } catch {}
    return;
  }

  if (t.status === 'underpaid') {
    setStatus(
      'Оплата пришла не полностью',
      'Сумма меньше стоимости встречи, поэтому бронь пока не подтверждена. Напиши мне — доплатишь разницу или верну деньги.',
      tgButton,
    );
    return;
  }

  if (t.status === 'attention' || t.status === 'conflict') {
    setStatus(
      'Оплата получена',
      'Есть нюанс с бронью — я свяжусь с тобой в Telegram и всё решим: перенесём встречу или верну деньги.',
      tgButton,
    );
    return;
  }

  if (t.status === 'expired' && cameFromPayment) {
    setStatus(
      'Оплата пока не дошла',
      'Если деньги списались, бронь подтвердится, как только придёт уведомление от ЮMoney, — обнови страницу чуть позже. Если что-то пошло не так, напиши мне.',
      [button('Обновить', { onClick: () => location.reload() }), ...tgButton],
    );
    return;
  }

  if (t.status === 'expired') {
    setStatus('Бронь сгорела', 'Оплата не пришла вовремя, и слот вернулся в календарь. Можно выбрать время заново.', [
      button('Выбрать время', { href: `${HOME}#book` }),
    ]);
    return;
  }

  if (t.status === 'cancelled') {
    setStatus('Встреча отменена', 'Если это неожиданно — напиши мне, разберёмся.', tgButton);
  }
}

async function load() {
  try {
    render(await api(`/api/bookings/${encodeURIComponent(id)}?k=${encodeURIComponent(token)}`));
  } catch (err) {
    if (err.status === 404) {
      setStatus('Билет не найден', 'Проверь ссылку: в ней должен быть код брони и ключ после «?k=».', [
        button('На главную', { href: HOME }),
      ]);
    } else {
      setStatus('Не получилось загрузить билет', err.message, [button('Обновить', { onClick: () => load() })]);
    }
  }
}

load();
