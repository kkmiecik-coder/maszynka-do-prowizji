// Wykrywanie kodowania pliku CSV z Excela. Excel zapisuje "CSV" w Windows-1250
// (polski Windows), a "CSV UTF-8" w UTF-8 (opcjonalnie z BOM). Czytamy surowe
// bajty i dobieramy dekoder, żeby polskie znaki nie zamieniały się w "�".
export function decodeCsvBytes(bytes) {
  // Akceptujemy Uint8Array/Buffer oraz goły ArrayBuffer (z `file.arrayBuffer()`),
  // bo ArrayBuffer nie jest array-like — `Uint8Array.from` dałoby pustą tablicę.
  const buf = bytes instanceof Uint8Array ? bytes
    : bytes instanceof ArrayBuffer ? new Uint8Array(bytes)
    : Uint8Array.from(bytes);
  // 1) UTF-8 BOM (EF BB BF) → UTF-8 bez BOM.
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  // 2) Spróbuj UTF-8 strict — jeśli bajty są poprawnym UTF-8, to jest UTF-8.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // 3) Niepoprawny UTF-8 → to Windows-1250 (Excel "CSV").
    return new TextDecoder('windows-1250').decode(buf);
  }
}
