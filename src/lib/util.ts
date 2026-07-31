import { addDays, format, isWeekend, parseISO, startOfWeek } from "date-fns";

let _seq = 1;
/** Monotonic id — fine for an in-memory session. */
export function newId(prefix = "id"): string {
  _seq += 1;
  return `${prefix}_${_seq.toString(36)}${(performance.now() | 0).toString(36)}`;
}

export const ISO = "yyyy-MM-dd";
export const toISO = (d: Date): string => format(d, ISO);
export const fromISO = (s: string): Date => parseISO(s);
export const nowISO = (): string => new Date().toISOString();

/** Mon–Fri working days of the week containing `date`. */
export function workWeek(date: Date): string[] {
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  return Array.from({ length: 5 }, (_, i) => toISO(addDays(monday, i)));
}

/** Next N working days (skips weekends), starting from `from` inclusive. */
export function nextWorkingDays(from: Date, n: number): string[] {
  const out: string[] = [];
  let d = from;
  while (out.length < n) {
    if (!isWeekend(d)) out.push(toISO(d));
    d = addDays(d, 1);
  }
  return out;
}

export function fmtShort(iso: string): string {
  return format(fromISO(iso), "EEE M/d");
}
export function fmtDate(iso: string): string {
  return format(fromISO(iso), "M/d/yy");
}
export function fmtHrs(h: number): string {
  return `${(Math.round(h * 100) / 100).toString()} hr${h === 1 ? "" : "s"}`;
}
export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** Excel serial date (1900 system) → ISO. Used when reading seed values. */
export function excelSerialToISO(serial: number): string {
  const ms = (serial - 25569) * 86400 * 1000; // days from 1970-01-01
  return toISO(new Date(ms));
}
