import { $, api, DEMO, makeFormat, rub } from './common.js';

const params = new URLSearchParams(location.search);
const id = params.get('id') || location.pathname.split('/').filter(Boolean).at(-1) || '';
const token = params.get('k') || '';

$('[data-form]').action = `/mock-pay/${encodeURIComponent(id)}`;
$('[data-k]').value = token;

// В демо сервера нет: «оплата» отмечается в браузере и ведёт на билет
if (DEMO) {
  $('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const paid = e.submitter?.value === 'pay';
    if (paid) (await import('./demo-api.js')).pay(id, token);
    const q = `id=${encodeURIComponent(id)}&k=${encodeURIComponent(token)}`;
    location.href = `ticket.html?${q}${paid ? '&paid=1' : ''}`;
  });
}

try {
  const t = await api(`/api/bookings/${encodeURIComponent(id)}?k=${encodeURIComponent(token)}`);
  const fmt = makeFormat(t.timezone);
  $('[data-summary]').textContent = `Бронь ${t.id}: ${t.formatTitle.toLowerCase()}, ${fmt.date(t.start)}, ${fmt.range(t.start, t.end)}. К оплате ${rub(t.price)}.`;
  $('[data-pay]').textContent = `Оплатить ${rub(t.price)}`;
} catch (err) {
  $('[data-summary]').textContent = err.message;
}
