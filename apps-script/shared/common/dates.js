class Dates {
  static get millisecondsPerSecond() {
    return 1000;
  }

  static get millisecondsPerDay() {
    return 86400000;
  }

  static get secondsPerDay() {
    return Dates.millisecondsPerDay / Dates.millisecondsPerSecond;
  }

  static get monthsInYear() {
    return 12;
  }

  static get lastMonthIndex() {
    return Dates.monthsInYear - 1;
  }

  static get monthAbbreviations() {
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  }

  static get serialZero() {
    return new Date(1899, 11, 30);
  }

  static toDayKey(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  }

  static format(date, pattern) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), pattern);
  }

  static formatMonthName(monthIndex) {
    return Dates.format(new Date(2000, monthIndex, 1), "MMMM");
  }

  /** A date written 2024-01-02, or null. */
  static parseIsoDate(value) {
    const isoDate = String(value || "")
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!isoDate) return null;

    const [, year, month, day] = isoDate;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  static getStartOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  static fromSerial(serial) {
    return Dates.addDays(Dates.serialZero, Math.floor(serial));
  }

  static toSerial(date) {
    return Math.round((Dates.toDayKey(date) - Dates.toDayKey(Dates.serialZero)) / Dates.millisecondsPerDay);
  }

  static toDateTimeSerial(date) {
    const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
    return Dates.toSerial(date) + seconds / Dates.secondsPerDay;
  }

  static withTimeOf(date, time) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes(), time.getSeconds());
  }

  static countDaysBetween(from, to) {
    return Math.round((Dates.toDayKey(to) - Dates.toDayKey(from)) / Dates.millisecondsPerDay);
  }

  static fromDayKey(dayKey) {
    const day = new Date(dayKey);
    return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  }

  static getWeekday(dayKey) {
    return new Date(dayKey).getUTCDay();
  }

  static isWeekend(dayKey) {
    const weekday = Dates.getWeekday(dayKey);
    return weekday === 6 || weekday === 0;
  }

  static toMonthKey(year, monthIndex) {
    return year * Dates.monthsInYear + monthIndex;
  }

  static addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  static compareChronologically(left, right) {
    return left.date - right.date || left.sourceRow - right.sourceRow;
  }

  static formatDisplay(date) {
    return Dates.format(date, "dd/MM/yyyy");
  }

  static findLatestCompletedValuation() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getHours() >= 23 ? 0 : 1));
  }
}
