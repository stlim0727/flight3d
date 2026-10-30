/** Best effort only: privacy settings can hide browser identity. */
export async function detectGyroBrowser(nav) {
  const ua = nav.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && nav.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) {
    try { if (await nav.brave?.isBrave?.()) return 'brave'; } catch { /* Manual selection remains available. */ }
    if (/Chrome\//i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua)) return 'chrome';
  }
  return 'other';
}
