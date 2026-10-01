// Статус с учётом времени: удержание, которое никто не оплатил, считается сгоревшим
// ещё до того, как его отметит фоновая уборка. Без зависимостей — работает и в браузере.
export function effectiveStatus(b, now) {
  if (b.status === 'hold' && b.hold_until <= now) return 'expired';
  return b.status;
}
