// Weryfikacja 1:1: generuje "dane do plików" z "dane" + słownik z Analiza
// i porównuje z istniejącą zakładką "dane do plików". Cel: 0 różnic.
// Uruchom: node scripts/verify-ddp.js
import ExcelJS from 'exceljs';
import { buildDaneDoPlikow } from '../src/daneDoPlikow.js';

function rawVal(cell) {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined) return v.text;
    if (v.result !== undefined) return v.result;
    if (v instanceof Date) return v;
    return v;
  }
  return v;
}
function norm(v) {
  if (v == null) return '';
  if (v instanceof Date) return 'D' + v.getTime();
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  return String(v).trim();
}
// raw=true → zwraca surowe cell.value (do przekazania modułowi, który sam rozwija formuły).
async function readSheet(path, name, headerRow, dataFrom, raw = false) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(name);
  const width = ws.actualColumnCount;
  const get = (cell) => raw ? cell.value : rawVal(cell);
  const header = []; for (let c = 1; c <= width; c++) header[c - 1] = rawVal(ws.getRow(headerRow).getCell(c));
  const rows = [];
  for (let r = dataFrom; r <= ws.rowCount; r++) {
    const row = []; let any = false;
    for (let c = 1; c <= width; c++) { const v = get(ws.getRow(r).getCell(c)); row[c - 1] = v; if (v != null && v !== '') any = true; }
    if (any) rows.push(row);
  }
  return { header, rows };
}
async function buildSlownik(analPath) {
  const { rows } = await readSheet(analPath, 'Strumienie per POS', 2, 3);
  const m = {};
  for (const r of rows) {
    const org = r[0], sid = r[1];
    if (sid != null) { const k = String(sid).replace(/'+$/, ''); if (!(k in m)) m[k] = org; }
  }
  return m;
}
async function verify(label, playPath, analPath) {
  const dane = await readSheet(playPath, 'dane', 3, 4, true); // surowe — moduł rozwija formuły
  const ddp = await readSheet(playPath, 'dane do plików', 1, 2);
  const slownik = await buildSlownik(analPath);
  const gen = buildDaneDoPlikow(dane.header, dane.rows, slownik);

  console.log('=== ' + label + ' ===');
  console.log('  wierszy: dane=' + dane.rows.length + ' ddp=' + ddp.rows.length + ' gen=' + gen.rows.length);
  console.log('  kolumn:  ddp=' + ddp.header.length + ' gen=' + gen.header.length);

  // Mapowanie kolumn istniejącej ddp → gen po NAZWIE (bo istniejąca może mieć Nazwa Partnera / inny układ).
  const genColOf = {}; gen.header.forEach((h, i) => { genColOf[norm(h)] = i; });
  const pairs = []; // [ddpColIdx, genColIdx, name]
  ddp.header.forEach((h, i) => { const gi = genColOf[norm(h)]; if (gi !== undefined) pairs.push([i, gi, norm(h)]); });
  const unmatched = ddp.header.filter(h => genColOf[norm(h)] === undefined && norm(h) !== '');
  if (unmatched.length) console.log('  kolumny ddp bez odpowiednika w gen: ' + unmatched.map(norm).join(', '));

  const N = Math.min(ddp.rows.length, gen.rows.length);
  let diff = 0, colHist = {}, examples = [];
  for (let r = 0; r < N; r++) {
    for (const [di, gi, name] of pairs) {
      const a = norm(ddp.rows[r][di]), b = norm(gen.rows[r][gi]);
      if (a !== b) { diff++; colHist[name] = (colHist[name] || 0) + 1; if (examples.length < 20) examples.push('r' + (r + 2) + ' „' + name + '": ist="' + a.slice(0, 18) + '" gen="' + b.slice(0, 18) + '"'); }
    }
  }
  console.log('  RÓŻNIC: ' + diff + (diff ? ' | kolumny: ' + Object.entries(colHist).sort((a, b) => b[1] - a[1]).map(([c, n]) => '„' + c + '"×' + n).join(' ') : ' ✓ IDENTYCZNE'));
  for (const e of examples) console.log('    ' + e);
  console.log('');
  return diff;
}

const M = await verify('MARZEC', 'Prowizje/Marzec/Play_dealer_za_okres_202603_2026-04-13-08-41-29 _.xlsx', 'Prowizje/Marzec/Analiza-strumieni-prowizji-POS-DB-202603.xlsx');
const K = await verify('KWIECIEŃ', 'Prowizje/Kwiecień/Play_dealer_za_okres_202604_2026-05-12-09-34-50 _.xlsx', 'Prowizje/Kwiecień/Analiza-strumieni-prowizji-POS-DB-202604.xlsx');
console.log(M === 0 && K === 0 ? '✅ OBA MIESIĄCE: 0 RÓŻNIC' : '❌ Są różnice (M=' + M + ' K=' + K + ')');
