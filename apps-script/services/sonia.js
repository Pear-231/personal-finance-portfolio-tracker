class Sonia {
  /**
   * The Bank of England's own database answers every request from Google's servers with HTTP 500, so its SONIA series (IUDSOIA) is read as FRED
   * republishes it.
   */
  static get address() {
    return "https://fred.stlouisfed.org/graph/fredgraph.csv?id=IUDSOIA";
  }

  /** SONIA accrues on an actual/365 basis. */
  static get daysInYear() {
    return 365;
  }

  /** The longest run of days without a published rate (a weekend and bank holidays) to bridge. */
  static get maxGapDays() {
    return 7;
  }

  static get log() {
    return Logger.create("Shared.Services.Sonia");
  }

  static findIndexOnOrBefore(rates, date) {
    const dayKey = Dates.toDayKey(date);
    let index = -1;

    while (index + 1 < rates.length && Dates.toDayKey(rates[index + 1].date) <= dayKey) {
      index += 1;
    }

    return index;
  }

  static findRateOnOrBefore(rates, date) {
    const index = Sonia.findIndexOnOrBefore(rates, date);
    return index < 0 ? null : rates[index];
  }

  /** The growth of 1 invested at the daily rate from startLimit to endLimit, minus 1. */
  static calculateCompoundedRate(rates, startLimit, endLimit) {
    const startIndex = Sonia.findIndexWithinGap_(rates, startLimit);
    const endIndex = Sonia.findIndexWithinGap_(rates, endLimit);
    let growth = 1;

    for (let index = startIndex; index < endIndex; index += 1) {
      const days = Dates.countDaysBetween(rates[index].date, rates[index + 1].date);
      if (days > Sonia.maxGapDays) {
        throw new Error(`SONIA has no rate between ${Dates.formatDisplay(rates[index].date)} and ${Dates.formatDisplay(rates[index + 1].date)}.`);
      }

      growth *= 1 + (Numbers.fromPercent(rates[index].annualRate) * days) / Sonia.daysInYear;
    }

    return growth - 1;
  }

  static findIndexWithinGap_(rates, limit) {
    const index = Sonia.findIndexOnOrBefore(rates, limit);
    if (index >= 0 && Dates.countDaysBetween(rates[index].date, limit) <= Sonia.maxGapDays) {
      return index;
    }

    const found = index < 0 ? "none" : `the latest is dated ${Dates.formatDisplay(rates[index].date)}`;
    throw new Error(`SONIA has no rate within ${Sonia.maxGapDays} days on or before ${Dates.formatDisplay(limit)}: ${found}.`);
  }

  static fetchRates(startDate, endDate) {
    const startKey = Dates.toDayKey(startDate);
    const endKey = Dates.toDayKey(endDate);
    const downloaded = Sonia.download_();
    const rates = downloaded.filter((rate) => {
      const rateKey = Dates.toDayKey(rate.date);
      return rateKey >= startKey && rateKey <= endKey;
    });

    const range = `${Dates.formatDisplay(startDate)} to ${Dates.formatDisplay(endDate)}`;

    if (rates.length === 0) {
      Sonia.log.warning("fetchRates", `FRED has no SONIA rate from ${range}.`);
    } else {
      const latest = rates[rates.length - 1];
      Sonia.log.information(
        "fetchRates",
        `${rates.length} SONIA rates from ${range}, the latest ${Dates.formatDisplay(latest.date)} at ${latest.annualRate}%.`
      );
    }

    return rates;
  }

  static download_() {
    return HttpFetch.getParsed("The SONIA request", Sonia.address, (response) => Sonia.parseCsv(response.getContentText()), {
      options: HttpFetch.browserOptions
    });
  }

  static parseCsv(csv) {
    const rows = Utilities.parseCsv(csv);
    const headerIndex = rows.findIndex(([firstCell]) =>
      ["DATE", "OBSERVATION_DATE"].includes(
        String(firstCell || "")
          .trim()
          .toUpperCase()
      )
    );

    if (headerIndex < 0) {
      const beginning = HttpFetch.excerpt(csv);
      throw new Error(`The SONIA response did not contain a DATE header. It began: "${beginning}"`);
    }

    return (
      rows
        .slice(headerIndex + 1)
        .map(([date, rate]) => ({ date: Dates.parseIsoDate(date), annualRate: Number(rate) }))
        // FRED lists UK bank holidays with a rate of 0, but SONIA is never zero.
        .filter(({ date, annualRate }) => date && Number.isFinite(annualRate) && annualRate > 0)
        .sort((left, right) => left.date - right.date)
    );
  }
}
