import { effectiveStatus } from './status.js';
import { escapeHtml } from './notify/telegram.js';
import { humanRange, tzLabel } from './time.js';

const rub = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatRub(value) {
  return `${rub.format(Number(value))} ₽`;
}

function durationText(min) {
  if (min % 60 === 0) {
    const h = min / 60;
    return `${h} ${h === 1 ? 'час' : h < 5 ? 'часа' : 'часов'}`;
  }
  return `${min} мин`;
}

export function ticketUrl(publicUrl, b) {
  return `${publicUrl}/t/${b.id}?k=${b.token}`;
}

export function adminUrl(publicUrl, b) {
  return `${publicUrl}/admin#${b.id}`;
}

// Место встречи после оплаты: ссылка на созвон или адрес. Описание онлайн-формата
// («ссылка придёт после оплаты») сюда не годится — оно для страницы записи.
function place(b, settings) {
  const f = settings.formats[b.format];
  if (b.format === 'online') return f.link || f.title;
  return f.place || f.title;
}

// Событие в календаре Влада: всё, что нужно, чтобы не лезть в админку.
export function ownerEvent(b, settings, publicUrl) {
  const f = settings.formats[b.format];
  const lines = [
    `Контакт: ${b.contact}`,
    b.email && `Почта: ${b.email}`,
    b.topic && `Тема: ${b.topic}`,
    `${f.title}, ${durationText(b.duration_min)}, ${formatRub(b.paid_amount ?? b.price)}`,
    b.status === 'attention' && `Внимание: ${b.attention_reason}`,
    `Код: ${b.id}`,
  ].filter(Boolean);
  return {
    uid: `${b.id}@chas`,
    start: b.start_at,
    end: b.end_at,
    summary: `${b.name} · ${f.title.toLowerCase()}`,
    description: lines.join('\n'),
    location: place(b, settings),
    url: adminUrl(publicUrl, b),
    alarms: [60, 15],
  };
}

// Событие для клиента (файл .ics из билета).
export function clientEvent(b, settings, publicUrl) {
  const f = settings.formats[b.format];
  const contact = settings.telegram ? `Связь: https://t.me/${settings.telegram}` : '';
  const lines = [
    `${f.title}, ${durationText(b.duration_min)}`,
    b.format === 'online' && !f.link && 'Ссылку на созвон пришлю в Telegram перед встречей',
    b.format === 'offline' && f.place,
    contact,
    `Билет: ${ticketUrl(publicUrl, b)}`,
    `Код брони: ${b.id}`,
  ].filter(Boolean);
  return {
    uid: `${b.id}@chas`,
    start: b.start_at,
    end: b.end_at,
    summary: `Встреча: ${settings.ownerName}`,
    description: lines.join('\n'),
    location: place(b, settings),
    url: ticketUrl(publicUrl, b),
    alarms: [60],
  };
}

// Что отдаётся странице билета. Ссылка на созвон — только после оплаты.
export function ticketView(b, settings, now) {
  const f = settings.formats[b.format] || { title: b.format, place: '' };
  const status = effectiveStatus(b, now);
  const paid = status === 'confirmed';
  return {
    id: b.id,
    status,
    format: b.format,
    formatTitle: f.title,
    start: b.start_at,
    end: b.end_at,
    duration: b.duration_min,
    price: b.price,
    name: b.name,
    holdUntil: status === 'hold' ? b.hold_until : null,
    place: paid ? place(b, settings) : f.place,
    link: paid && b.format === 'online' ? f.link || null : null,
    ownerName: settings.ownerName,
    telegram: settings.telegram,
    timezone: settings.timezone,
  };
}

export function confirmedMessage(b, settings) {
  const tz = settings.timezone;
  const f = settings.formats[b.format];
  return [
    `<b>Новая встреча — оплачено ${escapeHtml(formatRub(b.paid_amount ?? b.price))}</b>`,
    `${escapeHtml(humanRange(b.start_at, b.end_at, tz))} ${tzLabel(tz)} · ${escapeHtml(f.title)}`,
    '',
    `${escapeHtml(b.name)} · ${escapeHtml(b.contact)}`,
    b.email && escapeHtml(b.email),
    b.topic && `О чём: ${escapeHtml(b.topic)}`,
    `Код: <code>${b.id}</code>`,
  ].filter((l) => l !== null && l !== undefined && l !== false).join('\n');
}

export function attentionMessage(b, reason, settings) {
  const tz = settings.timezone;
  return [
    '<b>Оплата требует внимания</b>',
    escapeHtml(reason),
    '',
    `${escapeHtml(humanRange(b.start_at, b.end_at, tz))} ${tzLabel(tz)}`,
    `${escapeHtml(b.name)} · ${escapeHtml(b.contact)}`,
    `Код: <code>${b.id}</code>`,
  ].join('\n');
}

export function strayPaymentMessage(p, verdict) {
  const what = verdict === 'double_payment' ? 'Повторная оплата по уже оплаченной брони' : 'Платёж без брони';
  return [
    `<b>${what}</b>`,
    `Сумма: ${escapeHtml(formatRub(p.paid))}`,
    `Метка: <code>${escapeHtml(p.label || '—')}</code>`,
    `Операция: <code>${escapeHtml(p.operationId)}</code>`,
    'Проверь историю ЮMoney и при необходимости верни деньги.',
  ].join('\n');
}
