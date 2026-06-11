// Jednorazowa anonimizacja PLIKÓW TEKSTOWYCH (testy, docs, UI) przed upublicznieniem repo.
// Zamienia realne dane (nazwiska, SID-y, firmy, telefony, numery umów) na fikcyjne —
// KONSEKWENTNIE (ten sam token → ta sama zamiana wszędzie), więc dopasowania w testach
// i apostrofy w SID-ach pozostają spójne, a testy dalej przechodzą.
//
// Kolejność reguł ma znaczenie: dłuższe wzorce PRZED krótszymi (ML-MARIUSZ LIGAJ
// przed MARIUSZ LIGAJ), by nie robić częściowych podmian.
//
// Uruchom: node scripts/sanitize-sources.js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Pliki do wyczyszczenia (śledzone, trafią do publicznego repo).
const FILES = [
  'test/config.test.js',
  'test/csv.test.js',
  'test/engine.test.js',
  'test/integration.test.js',
  'test/reader.test.js',
  'renderer/config.html',
  'scripts/build-templates.js',
  'docs/superpowers/plans/2026-06-10-maszynka-prowizji.md',
  'docs/superpowers/specs/2026-06-10-maszynka-prowizji-design.md',
];

// Mapa zamian — UWAGA na kolejność (dłuższe pierwsze). SID-y zachowują długość/apostrof.
const REPLACEMENTS = [
  // Nazwiska / firmy (najwrażliwsze — dane osobowe)
  ['ML-MARIUSZ LIGAJ', 'FIRMA ALFA'],
  ['MARIUSZ LIGAJ', 'FIRMA ALFA'],
  ['MONIKA CIEMIENIOWSKA', 'FIRMA BETA'],
  ['Monika Ciemieniowska', 'Firma Beta'],
  ['BARTŁOMIEJ KRAJEWSKI', 'FIRMA GAMMA'],
  ['PlayArt ARTUR RUDNICKI', 'FIRMA DELTA'],
  ['PlayArt', 'FirmaDelta'],
  ['360 Circus Brzozów', 'Przykładowa Nazwa'],
  ['360 Circus', 'Przykładowa Nazwa'],
  ['360CIRCUS', 'PRZYKLAD'],

  // SID-y — zachowujemy strukturę i apostrofy, podmieniamy korpus cyfr.
  // Dłuższe (z sufiksem) PRZED krótszymi, by zamiana była pełna.
  ["D004470028'", "D000444028'"],
  ['D004470028', 'D000444028'],
  ["D004470'", "D000444'"],
  ['D004470', 'D000444'],
  ["D004758001'", "D000475001'"],
  ["D004758'", "D000475'"],
  ['D004758001', 'D000475001'],
  ['D004758', 'D000475'],
  ['D001790001', 'D000179001'],
  ['D001790', 'D000179'],
  ['D004092006', 'D000111006'],
  ['D004092', 'D000111'],
  ['D003033399', 'D000222399'],
  ['D003033024', 'D000222024'],
  ['D003033', 'D000222'],

  // Telefony / numery umów / identyfikatory
  ['69602475773', '00000000000'],
  ['48536389573', '00000000000'],
  ['UM44/D004092006/001832523', 'UM00/D000111006/000000000'],
  ['UM22/D003033399/550292415', 'UM00/D000222399/000000000'],
  ['001832523', '000000000'],
  ['550292415', '000000000'],
  ['121291682', '000000000'],
];

let totalChanges = 0;
for (const rel of FILES) {
  const path = join(root, rel);
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch { console.log(`POMIJAM (brak): ${rel}`); continue; }

  let count = 0;
  for (const [from, to] of REPLACEMENTS) {
    const parts = text.split(from);
    if (parts.length > 1) { count += parts.length - 1; text = parts.join(to); }
  }
  if (count > 0) { writeFileSync(path, text, 'utf8'); totalChanges += count; }
  console.log(`${count > 0 ? 'OK' : '--'} ${rel}: ${count} zamian`);
}
console.log(`\nRazem: ${totalChanges} zamian w ${FILES.length} plikach.`);
