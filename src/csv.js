// Parser CSV mapowania adresatów. Obsługuje:
//  - separator kolumn ; lub , (gdy jest ;, przecinek jest tylko wewnątrzkomórkowy),
//  - opcjonalny wiersz nagłówka,
//  - kilka SID-ów i/lub kilka maili w jednej komórce (po przecinku/średniku/spacji).
// Wynik jest PŁASKI: jeden wiersz = jeden SID + jeden mail (iloczyn kartezjański),
// żeby resolveRecipient, mergeMapping i tabela adresatów nie zmieniały struktury.

// Rozbija komórkę z wieloma wartościami (SID-y lub maile) na listę.
function splitCell(cell) {
  return String(cell ?? '')
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function parseMappingCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  // Gdy w pierwszej linii jest średnik → ; jest separatorem kolumn
  // (przecinek wtedy wyłącznie wewnątrzkomórkowy, np. lista SID-ów).
  const sep = lines[0].includes(';') ? ';' : ',';
  const firstCells = lines[0].split(sep).map(c => c.trim());
  // Nagłówek, jeśli 3. kolumna nie wygląda na e-mail.
  const isHeader = !/\S+@\S+/.test(firstCells[2] ?? '');
  const rows = isHeader ? lines.slice(1) : lines;

  const out = [];
  for (const line of rows) {
    const cols = line.split(sep).map(c => c.trim());
    const organizacja = cols[0] ?? '';
    const sidy = splitCell(cols[1]);
    const emails = splitCell(cols[2]).filter(e => /\S+@\S+/.test(e));
    if (!sidy.length || !emails.length) continue;
    for (const sid of sidy) {
      for (const email of emails) {
        out.push({ organizacja, sid, email });
      }
    }
  }
  return out;
}
