// Генерация iCalendar (RFC 5545): файл «добавить в календарь» для клиента,
// подписка webcal для Влада и объекты для CalDAV.

// Любой перевод строки (в том числе одиночный CR) становится \n, остальные управляющие
// символы выкидываются: иначе из темы встречи можно дописать в событие свои свойства.
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

const encoder = new TextEncoder();
const byteLength = (s) => encoder.encode(s).length;

// Строки длиннее 75 октетов переносятся, продолжение начинается с пробела.
export function foldLine(line) {
  if (byteLength(line) <= 75) return line;
  const parts = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = byteLength(ch);
    if (size + bytes > 75) {
      parts.push(current);
      current = ' ' + ch;
      size = 1 + bytes;
    } else {
      current += ch;
      size += bytes;
    }
  }
  parts.push(current);
  return parts.join('\r\n');
}

export function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function eventLines(e, stamp) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(stamp)}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(e.end)}`,
    `SUMMARY:${escapeText(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push(`STATUS:${e.status || 'CONFIRMED'}`, `SEQUENCE:${e.sequence || 0}`, 'TRANSP:OPAQUE');
  for (const minutes of e.alarms || []) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-PT${minutes}M`,
      `DESCRIPTION:${escapeText(e.summary)}`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

export function buildCalendar({ name, events, method = null, refreshMinutes = null, stamp = Date.now() }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//chas//booking//RU', 'CALSCALE:GREGORIAN'];
  if (method) lines.push(`METHOD:${method}`);
  if (name) lines.push(`X-WR-CALNAME:${escapeText(name)}`);
  if (refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${refreshMinutes}M`, `X-PUBLISHED-TTL:PT${refreshMinutes}M`);
  }
  for (const e of events) lines.push(...eventLines(e, stamp));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
