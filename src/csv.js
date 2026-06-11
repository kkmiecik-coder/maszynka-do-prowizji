export function parseMappingCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const firstCells = lines[0].split(sep).map(c => c.trim());
  const isHeader = !/\S+@\S+/.test(firstCells[2] ?? '');
  const rows = isHeader ? lines.slice(1) : lines;
  return rows.map(line => {
    const [organizacja = '', sid = '', email = ''] = line.split(sep).map(c => c.trim());
    return { organizacja, sid, email };
  }).filter(r => /\S+@\S+/.test(r.email));
}
