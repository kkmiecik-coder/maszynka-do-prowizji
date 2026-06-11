// Walidacja plików źródłowych po STRUKTURZE (nagłówkach kolumn), nie po nazwie
// zakładki — różne pliki mogą mieć zakładki o podobnych nazwach.

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

// Arkusz Play_dealer akceptowany na dwa sposoby:
//  • gotowa zakładka „dane do plików" — nagłówki w wierszu 1: „SID POS", „SID Sprzed.", „Nazwa Firmy";
//  • surowa zakładka „dane" — nagłówki w WIERSZU 3 (`headersRow3`): zawiera markery
//    „SID POS", „SID Sprzed." i „% Circus" (z niej program zbuduje „dane do plików").
export function looksLikePlay(sheets) {
  return (sheets || []).some((s) => {
    const h1 = (s.headers || []).map(norm);
    if (h1[0] === 'sid pos' && h1[1] === 'sid sprzed.' && h1[2] === 'nazwa firmy') return true;
    // surowa "dane": markery w dowolnym z odczytanych wierszy nagłówkowych
    const h3 = (s.headersRow3 || []).map(norm);
    const hasMarkers = (arr) =>
      arr.includes('sid pos') && arr.includes('sid sprzed.') && arr.includes('% circus');
    return hasMarkers(h3) || hasMarkers(h1);
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
