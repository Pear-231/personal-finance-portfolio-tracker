class YahooFinance {
  static get log() {
    return Logger.create("Shared.Services.YahooFinance");
  }

  static getSymbolForTicker(ticker) {
    const value = String(ticker).replace(/\s/g, "");
    if (value.startsWith("LON:") || value.startsWith("LSE:")) return `${value.slice(4)}.L`;

    if (value.startsWith("NYSE:") || value.startsWith("NASDAQ:")) {
      return value.slice(value.indexOf(":") + 1);
    }

    if (value === "NZD:USD") return "NZDUSD=X";
    if (/^CURRENCY:[A-Z]{6}$/.test(value)) return `${value.slice("CURRENCY:".length)}=X`;
    return value;
  }

  /**
   * Closes are on the historic share basis: Yahoo restates every close for later splits, so each close is multiplied back by the splits that followed
   * it.
   */
  static fetchHistoricalCloses(symbol, start, end) {
    const periodStart = Math.floor(start.getTime() / Dates.millisecondsPerSecond);
    // One day past the end, so that the end date's own bar is included.
    const periodEnd = Math.floor(Math.max(end.getTime(), Date.now()) / Dates.millisecondsPerSecond) + Dates.secondsPerDay;
    const url = YahooFinance.buildChartUrl_(symbol, `period1=${periodStart}&period2=${periodEnd}&interval=1d&events=split`);

    const chart = YahooFinance.fetchChart_(`Yahoo Finance history for ${symbol}`, url, 3);
    const result = chart?.chart?.result?.[0];
    if (chart && !result) YahooFinance.log.warning("fetchHistoricalCloses", `No chart for ${symbol}.`);
    if (!result) return null;

    const history = YahooFinance.readHistoryFromChart(result, end);
    YahooFinance.log.information(
      "fetchHistoricalCloses",
      `${symbol}: ${history.closes.length} closes in ${history.currency} from ${Dates.formatDisplay(start)} to ${Dates.formatDisplay(end)}.`
    );

    return history;
  }

  static fetchChart_(description, url, attempts) {
    try {
      const response = HttpFetch.get(description, url, {
        options: HttpFetch.browserOptions,
        attempts
      });
      if (response.getResponseCode() !== HttpFetch.successStatus) return null;
      return JSON.parse(response.getContentText());
    } catch (error) {
      YahooFinance.log.error("fetchChart_", `${description} could not be read`, error);
      return null;
    }
  }

  static readHistoryFromChart(result, end) {
    const splits = Object.values(result.events?.splits || {}).map((split) => ({
      date: Dates.getStartOfDay(new Date(split.date * Dates.millisecondsPerSecond)),
      ratio: split.numerator / split.denominator
    }));

    const timestamps = result.timestamp || [];
    const quotedCloses = result.indicators?.quote?.[0]?.close || [];
    const lastDay = Dates.getStartOfDay(end);
    const closes = timestamps
      .map((timestamp, index) => ({
        date: Dates.getStartOfDay(new Date(timestamp * Dates.millisecondsPerSecond)),
        close: quotedCloses[index]
      }))
      .filter(({ date, close }) => Number.isFinite(close) && date <= lastDay)
      .map(({ date, close }) => ({
        date,
        close: splits.filter((split) => split.date > date).reduce((price, split) => price * split.ratio, close)
      }));

    return { currency: YahooFinance.getCurrency_(result), closes };
  }

  static fetchLatestQuote(symbol) {
    const url = YahooFinance.buildChartUrl_(symbol, "range=5d&interval=1d");
    const chart = YahooFinance.fetchChart_(`Yahoo Finance quote for ${symbol}`, url, HttpFetch.cellFunctionSettings.attempts);
    const quote = chart ? YahooFinance.readQuoteFromChart(chart) : null;
    if (chart && !quote) {
      YahooFinance.log.warning("fetchLatestQuote", `Yahoo Finance has no price for ${symbol}.`);
    }

    return quote;
  }

  static readQuoteFromChart(chart) {
    const result = chart?.chart?.result?.[0];
    if (!result?.meta) return null;
    let price = Number(result.meta.regularMarketPrice);
    if (!(price > 0)) {
      const closes = (result.indicators?.quote?.[0].close || []).filter((close) => close > 0);
      price = closes.length > 0 ? closes[closes.length - 1] : 0;
    }

    if (!(price > 0)) return null;
    return { price, currency: YahooFinance.getCurrency_(result) };
  }

  static fetchPriceInCurrency(ticker, currency) {
    const symbol = YahooFinance.getSymbolForTicker(ticker);
    if (!symbol) {
      throw YahooFinance.log.createFailure(
        "fetchPriceInCurrency",
        `YAHOO_FINANCE_PRICE needs a ticker, but received "${ticker}". Point its first argument at the Yahoo Finance Ticker cell.`
      );
    }

    const quote = HttpFetch.remember(`yahoo-price-${symbol}`, () => YahooFinance.fetchLatestQuote(symbol));
    if (!quote) {
      throw YahooFinance.log.createFailure("fetchPriceInCurrency", `Yahoo Finance has no price for ${ticker}.`);
    }

    const assetCurrency = String(currency || quote.currency).trim();
    if (Currencies.isUnconvertible(quote.currency, assetCurrency)) {
      throw YahooFinance.log.createFailure("fetchPriceInCurrency", `${ticker} is quoted in ${quote.currency} but Assets lists ${assetCurrency}.`);
    }

    return Currencies.convertPrice(quote.price, quote.currency, assetCurrency);
  }

  static buildChartUrl_(symbol, query) {
    const base = "https://query1.finance.yahoo.com/v8/finance/chart";
    return `${base}/${encodeURIComponent(symbol)}?${query}`;
  }

  /** Yahoo's pence code is GBp; the workbook's is GBX. */
  static getCurrency_(result) {
    const currency = String(result.meta?.currency || "");
    return currency === "GBp" ? Currencies.pence : currency;
  }
}
