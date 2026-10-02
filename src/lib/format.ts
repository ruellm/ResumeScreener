const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(date: Date) {
  return dateFormat.format(date);
}

export function formatDateTime(date: Date) {
  return dateTimeFormat.format(date);
}
