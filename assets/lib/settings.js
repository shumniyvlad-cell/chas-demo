import { isTime, minutesOf } from './time.js';

// Всё, что Влад меняет руками из админки. Секретов здесь нет — они только в .env.
export const DEFAULT_SETTINGS = Object.freeze({
  ownerName: 'Влад Марченков',
  brand: 'Vlad March Media',
  headline: 'Час, который экономит месяц',
  about:
    'Продюсирую экспертов и личные бренды: стратегия, контент, боты, запуски. ' +
    'Приходишь с задачей — уходишь с планом, а не с «надо подумать».',
  telegram: 'marchvlv',
  timezone: 'Europe/Moscow',
  formats: {
    online: {
      enabled: true,
      title: 'Онлайн',
      pricePerHour: 5000,
      place: 'Созвон по видео — ссылка придёт после оплаты',
      link: '',
    },
    offline: {
      enabled: true,
      title: 'Офлайн',
      pricePerHour: 8000,
      place: 'Сочи. Точное место согласуем в Telegram',
      link: '',
    },
  },
  durations: [60, 120],
  // 1 = пн ... 7 = вс; пустой массив — выходной
  schedule: {
    1: [['11:00', '19:00']],
    2: [['11:00', '19:00']],
    3: [['11:00', '19:00']],
    4: [['11:00', '19:00']],
    5: [['11:00', '17:00']],
    6: [],
    7: [],
  },
  slotStep: 30,
  bufferMin: 15,
  minNoticeHours: 12,
  horizonDays: 21,
  holdMinutes: 20,
  policy:
    'Перенести встречу можно один раз, если написать за 24 часа. ' +
    'Если не приду я — верну деньги полностью или перенесём, как тебе удобнее.',
});

class SettingsError extends Error {}

function int(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new SettingsError(`${name}: нужно целое число от ${min} до ${max}`);
  }
  return n;
}

function str(v, name, max, { required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new SettingsError(`${name}: не может быть пустым`);
  if (s.length > max) throw new SettingsError(`${name}: длиннее ${max} символов`);
  return s;
}

function normalizeFormat(input, fallback, name) {
  const f = input && typeof input === 'object' ? input : {};
  const link = str(f.link ?? fallback.link, `${name}.link`, 500);
  if (link && !/^https?:\/\//i.test(link)) throw new SettingsError(`${name}: ссылка должна начинаться с http(s)://`);
  return {
    enabled: Boolean(f.enabled ?? fallback.enabled),
    title: str(f.title ?? fallback.title, `${name}.title`, 40, { required: true }),
    pricePerHour: int(f.pricePerHour ?? fallback.pricePerHour, `${name}: цена за час`, 0, 1_000_000),
    place: str(f.place ?? fallback.place, `${name}.place`, 300),
    link,
  };
}

function normalizeSchedule(input) {
  const out = {};
  for (let wd = 1; wd <= 7; wd++) {
    const ranges = Array.isArray(input?.[wd]) ? input[wd] : [];
    const clean = [];
    for (const r of ranges) {
      if (!Array.isArray(r) || r.length !== 2 || !isTime(r[0]) || !isTime(r[1])) {
        throw new SettingsError(`Расписание: неверный интервал в дне ${wd}`);
      }
      if (minutesOf(r[0]) >= minutesOf(r[1])) {
        throw new SettingsError(`Расписание: начало позже конца (${r[0]}–${r[1]})`);
      }
      clean.push([r[0], r[1]]);
    }
    clean.sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
    for (let i = 1; i < clean.length; i++) {
      if (minutesOf(clean[i][0]) < minutesOf(clean[i - 1][1])) {
        throw new SettingsError(`Расписание: интервалы дня ${wd} пересекаются`);
      }
    }
    out[wd] = clean;
  }
  return out;
}

export function normalizeSettings(input, base = DEFAULT_SETTINGS) {
  const s = input && typeof input === 'object' ? input : {};
  const durations = [...new Set((Array.isArray(s.durations) ? s.durations : base.durations).map((d) => int(d, 'Длительность', 15, 480)))].sort((a, b) => a - b);
  if (!durations.length) throw new SettingsError('Нужна хотя бы одна длительность');
  const timezone = str(s.timezone ?? base.timezone, 'Часовой пояс', 64, { required: true });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new SettingsError(`Неизвестный часовой пояс: ${timezone}`);
  }
  const formats = {
    online: normalizeFormat(s.formats?.online, base.formats.online, 'Онлайн'),
    offline: normalizeFormat(s.formats?.offline, base.formats.offline, 'Офлайн'),
  };
  if (!formats.online.enabled && !formats.offline.enabled) {
    throw new SettingsError('Хотя бы один формат должен быть включён');
  }
  return {
    ownerName: str(s.ownerName ?? base.ownerName, 'Имя', 80, { required: true }),
    brand: str(s.brand ?? base.brand, 'Бренд', 80),
    headline: str(s.headline ?? base.headline, 'Заголовок', 120, { required: true }),
    about: str(s.about ?? base.about, 'О себе', 1000),
    telegram: str(s.telegram ?? base.telegram, 'Telegram', 64).replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, ''),
    timezone,
    formats,
    durations,
    schedule: normalizeSchedule(s.schedule ?? base.schedule),
    slotStep: int(s.slotStep ?? base.slotStep, 'Шаг слотов', 5, 240),
    bufferMin: int(s.bufferMin ?? base.bufferMin, 'Буфер', 0, 240),
    minNoticeHours: int(s.minNoticeHours ?? base.minNoticeHours, 'Минимум заранее', 0, 24 * 14),
    horizonDays: int(s.horizonDays ?? base.horizonDays, 'Горизонт записи', 1, 120),
    holdMinutes: int(s.holdMinutes ?? base.holdMinutes, 'Время на оплату', 5, 120),
    policy: str(s.policy ?? base.policy, 'Правила', 1500),
  };
}

export function priceFor(settings, format, durationMin) {
  return Math.round((settings.formats[format].pricePerHour * durationMin) / 60);
}

// То, что видит посетитель: без ссылки на созвон (она только в оплаченном билете).
export function publicSettings(s) {
  const formats = {};
  for (const [key, f] of Object.entries(s.formats)) {
    if (!f.enabled) continue;
    formats[key] = { title: f.title, pricePerHour: f.pricePerHour, place: f.place };
  }
  return {
    ownerName: s.ownerName,
    brand: s.brand,
    headline: s.headline,
    about: s.about,
    telegram: s.telegram,
    timezone: s.timezone,
    formats,
    durations: s.durations,
    horizonDays: s.horizonDays,
    holdMinutes: s.holdMinutes,
    minNoticeHours: s.minNoticeHours,
    policy: s.policy,
  };
}

// Хранятся одной JSON-строкой; при чтении прогоняются через нормализацию,
// чтобы новые поля из DEFAULT_SETTINGS подхватывались без миграций.
export function createSettingsStore(db, now = Date.now) {
  const read = db.prepare('SELECT json FROM settings WHERE id = 1');
  const write = db.prepare(`
    INSERT INTO settings (id, json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT (id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`);

  let current;
  const row = read.get();
  try {
    current = row ? normalizeSettings(JSON.parse(row.json)) : normalizeSettings({});
  } catch {
    current = normalizeSettings({});
  }
  if (!row) write.run(JSON.stringify(current), now());

  return {
    get: () => current,
    save(input) {
      const next = normalizeSettings(input, current);
      write.run(JSON.stringify(next), now());
      current = next;
      return current;
    },
  };
}

export { SettingsError };
