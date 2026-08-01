const TRANSLATED_NAME_SEPARATOR = "\n";

export function combinedTravelPlaceName(
  originalName: string,
  translatedName?: string | null,
) {
  const original = originalName.trim();
  const translated = translatedName?.trim();
  if (!translated || translated === original) return original;
  return `${original}${TRANSLATED_NAME_SEPARATOR}${translated}`;
}

export function splitTravelPlaceName(value: string) {
  const [originalName = "", ...translatedParts] = value.split(
    TRANSLATED_NAME_SEPARATOR,
  );
  return {
    originalName: originalName.trim(),
    translatedName: translatedParts.join(" ").trim() || null,
  };
}

export function needsKoreanTravelPlaceName(value: string) {
  const { originalName, translatedName } = splitTravelPlaceName(value);
  if (!originalName || translatedName || /[가-힣]/.test(originalName)) {
    return false;
  }
  return /[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(originalName);
}
