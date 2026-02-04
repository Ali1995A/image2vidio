export function py(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";

  // Decompose precomposed tone vowels (ā/á/ǎ/à) into base+combining marks, then
  // force "a" → open a (ɑ, U+0251) to avoid platform-dependent glyph fallback.
  return s.normalize("NFD").replaceAll("a", "ɑ");
}

