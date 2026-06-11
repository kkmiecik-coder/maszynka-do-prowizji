export function formatPeriod(yyyymm) {
  const s = String(yyyymm).trim();
  if (!/^\d{6}$/.test(s)) throw new Error(`Nieprawidłowy okres: ${yyyymm}`);
  const mm = Number(s.slice(4, 6));
  if (mm < 1 || mm > 12) throw new Error(`Nieprawidłowy okres: ${yyyymm}`);
  return `${s.slice(4, 6)}.${s.slice(0, 4)}`;
}

export function detectPeriod(values) {
  const counts = new Map();
  for (const v of values) {
    const s = String(v).trim();
    if (/^\d{6}$/.test(s)) counts.set(s, (counts.get(s) || 0) + 1);
  }
  if (counts.size === 0) throw new Error('Brak prawidłowego okresu w danych');
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const breakdown = sorted.map(([okres, liczba]) => ({ okres, liczba }));
  return { period: sorted[0][0], multiple: counts.size > 1, breakdown };
}
