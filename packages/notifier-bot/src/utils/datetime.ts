export function getTimestampWithoutTimezone(date = new Date()) {
  return date.toISOString().slice(0, -1);
}
