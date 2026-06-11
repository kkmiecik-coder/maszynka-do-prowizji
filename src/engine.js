import { DETAIL_KEY_COL, SUMMARY } from './constants.js';

export function buildFiles(summaryRows, detailRows, kanal) {
  const keyCol = DETAIL_KEY_COL[kanal]; // 1 (POS) lub 2 (DB)
  // index szczegółów po kluczu (dokładny string)
  const byKey = new Map();
  for (const row of detailRows) {
    const k = String(row[keyCol - 1] ?? '');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(row);
  }
  // grupowanie podsumowań po Organizacji (dokładny string)
  const groups = new Map();
  for (const row of summaryRows) {
    const org = row[SUMMARY.ORG - 1];
    if (org == null || org === '') continue;
    if (!groups.has(org)) groups.set(org, []);
    groups.get(org).push(row);
  }
  const files = [];
  for (const [organizacja, summaries] of groups) {
    const sidy = summaries.map(r => String(r[SUMMARY.SID - 1] ?? ''));
    const details = [];
    for (const sid of sidy) {
      const matched = byKey.get(sid);   // dokładny match, z apostrofem
      if (matched) details.push(...matched);
    }
    files.push({ organizacja, kanal, sidy, summaries, details });
  }
  return files;
}
