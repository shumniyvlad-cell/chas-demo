// Уведомления Владу в Telegram. Токен живёт только в .env на сервере.

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createTelegram({ token, chatId, fetchImpl = fetch, log = console }) {
  const enabled = Boolean(token && chatId);

  async function send(html, buttons = []) {
    if (!enabled) return { ok: false, skipped: true };
    const body = { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    // Telegram не принимает кнопки на localhost и http — только публичный https
    const links = buttons.filter((b) => /^https:\/\//.test(b.url));
    if (links.length) body.reply_markup = { inline_keyboard: [links.map((b) => ({ text: b.text, url: b.url }))] };
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) log.error(`[telegram] ${data.description || res.status}`);
      return { ok: Boolean(data.ok), error: data.ok ? null : data.description || `HTTP ${res.status}` };
    } catch (err) {
      log.error(`[telegram] ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  return { enabled, send };
}
