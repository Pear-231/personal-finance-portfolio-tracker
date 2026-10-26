class Cpi {
  static get address() {
    return "https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/d7bt/mm23";
  }

  static get log() {
    return Logger.create("Shared.Services.Cpi");
  }

  static fetchMonths() {
    const months = HttpFetch.getParsed("The CPI request", Cpi.address, (response) => Cpi.parseCsv(response.getContentText()), {
      options: HttpFetch.browserOptions
    });
    Cpi.log.information("fetchMonths", Cpi.summarise_(months));
    return months;
  }

  static calculateInflationBetween(months, startDate, endDate) {
    const start = Cpi.findMonth_(months, startDate);
    const end = Cpi.findMonth_(months, endDate);
    return start && end && start !== end ? end.index / start.index - 1 : null;
  }

  static calculateDailyInflation(months, date) {
    const month = Cpi.findMonth_(months, date);
    if (!month) return null;

    const previous = Cpi.findMonth_(months, new Date(date.getFullYear(), date.getMonth() - 1, 1));
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return Math.pow(month.index / previous.index, 1 / daysInMonth) - 1;
  }

  static findMonth_(months, date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const found = months.find((candidate) => candidate.year === year && candidate.month === month);
    if (found) return found;
    const latest = months[months.length - 1];
    if (!latest || Dates.toMonthKey(year, month) > Dates.toMonthKey(latest.year, latest.month)) {
      return null;
    }

    throw new Error(`The CPI index has no value for ${Dates.formatMonthName(month - 1)} ${year}, which a period being written needs.`);
  }

  static summarise_(months) {
    const latest = months[months.length - 1];
    const yearBefore = months.find((month) => month.year === latest.year - 1 && month.month === latest.month);
    const rate = yearBefore ? `, ${Numbers.toPercent(latest.index / yearBefore.index - 1).toFixed(2)}% above a year earlier` : "";
    return (
      `Read ${months.length} months of the CPI index, the latest ` +
      `${Dates.formatMonthName(latest.month - 1)} ${latest.year} at ${latest.index}${rate}.`
    );
  }

  /** The monthly rows of the ONS CSV look like ("2026 SEP", 144.1). */
  static parseCsv(csv) {
    const months = Utilities.parseCsv(csv)
      .map(([label, value]) => {
        const written = String(label || "")
          .trim()
          .match(/^(\d{4})\s+([A-Za-z]{3})$/);

        if (!written) return null;

        const month = Dates.monthAbbreviations.findIndex((name) => name.toLowerCase() === written[2].toLowerCase());

        const index = Number(value);
        return month < 0 || !(index > 0) ? null : { year: Number(written[1]), month: month + 1, index };
      })
      .filter((month) => month !== null)
      .sort((left, right) => Dates.toMonthKey(left.year, left.month) - Dates.toMonthKey(right.year, right.month));

    if (months.length === 0) {
      const beginning = HttpFetch.excerpt(csv);
      throw new Error(`The CPI response had no monthly rows. It began: "${beginning}"`);
    }

    return months;
  }
}
