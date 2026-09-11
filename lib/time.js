// Thailand is UTC+7 year-round (no daylight saving) — every Timestamp the
// app writes to CountRecord uses local Thai time instead of UTC, so it
// reads naturally for everyone using the sheet.
const THAILAND_OFFSET_MS = 7 * 60 * 60 * 1000;

export function nowThailandISOString() {
  const utcNow = new Date();
  // Shift the instant by +7h, then format — .toISOString() always labels
  // its output "Z", so after the shift those digits *are* Thai wall-clock
  // time; swapping the label to "+07:00" is what actually makes the string
  // correct (undoing the shift is what a "+07:00" reader would otherwise do).
  const shifted = new Date(utcNow.getTime() + THAILAND_OFFSET_MS);
  return shifted.toISOString().replace("Z", "+07:00");
}
