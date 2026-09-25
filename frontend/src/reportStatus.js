export function isAscendedWeek(week, windows = []) {
  return windows.some(({ start_week: start, end_week: end }) =>
    start <= week && (end == null || week <= end))
}
