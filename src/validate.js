// Walidacja plików źródłowych po STRUKTURZE (nagłówkach kolumn), nie po nazwie
// zakładki — różne pliki mogą mieć zakładki o podobnych nazwach.

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

// Arkusz szczegółów Play_dealer: kolumny „SID POS", „SID Sprzed.", „Nazwa Firmy".
export function looksLikePlay(sheets) {
  return (sheets || []).some((s) => {
    const h = (s.headers || []).map(norm);
    return h[0] === 'sid pos' && h[1] === 'sid sprzed.' && h[2] === 'nazwa firmy';
  });
}

// Arkusz podsumowania (Analiza POS/DB): „Organizacja", „SID ID", „Nazwa", „KANAŁ".
export function looksLikeAnaliza(sheets) {
  return (sheets || []).some((s) => {
    const h = (s.headers || []).map(norm);
    return h[0] === 'organizacja' && h[1] === 'sid id' && h[2] === 'nazwa' && h[3] === 'kanał';
  });
}

// Zwraca { ok } albo { ok:false, error } z neutralnym komunikatem.
export function validateSource(kind, sheets) {
  if (kind === 'play') {
    if (looksLikePlay(sheets)) return { ok: true };
    return { ok: false, error: 'Ten plik nie pasuje do pola „Plik Play_dealer". Upewnij się, że wskazujesz właściwy plik.' };
  }
  // kind === 'anal'
  if (looksLikeAnaliza(sheets)) return { ok: true };
  return { ok: false, error: 'Ten plik nie pasuje do pola „Plik Analiza". Upewnij się, że wskazujesz właściwy plik.' };
}
