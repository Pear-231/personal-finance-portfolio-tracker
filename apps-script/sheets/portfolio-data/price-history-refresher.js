class PriceHistoryRefresher {
  static get log() {
    return Logger.create("Sheets.PortfolioData.PriceHistoryRefresher");
  }

  constructor(ledgerRows, assets, existingObservations, targetDate) {
    this.ledgerRows = ledgerRows;
    this.assets = assets;
    this.existingObservations = existingObservations;
    this.targetDate = targetDate;
    this.errors = [];
    this.coverage = new Map();
  }

  build() {
    // A dividend paid after a position closed does not need a price of its own.
    const periodsByAsset = HoldingPeriods.findPeriodsByAsset(this.ledgerRows.filter((event) => event.category !== LedgerReplay.incomeCategory));
    const observations = [];
    for (const { assetName, asset, isOpen } of this.findQuotedAssets_()) {
      const periods = periodsByAsset.get(assetName) || [];
      observations.push(...this.findMissingObservations_(assetName, asset, isOpen, periods));
    }
    return { observations, errors: this.errors, coverage: this.coverage };
  }

  findMissingObservations_(assetName, asset, isOpen, periods) {
    const targetKey = Dates.toDayKey(this.targetDate);

    const known = this.existingObservations
      .filter((observation) => observation.asset === assetName && observation.close > 0)
      .sort((left, right) => right.date - left.date);

    const knownKeys = new Set(known.map((observation) => Dates.toDayKey(observation.date)));
    const ranges = this.findMissingRanges_(periods, knownKeys, targetKey);

    const hasLiveValue = isOpen && asset.currentValue > 0;
    const usesLivePrice = hasLiveValue && targetKey === Dates.toDayKey(new Date()) && !knownKeys.has(targetKey);

    if (ranges.length === 0 && !usesLivePrice) return [];

    const currency = String(asset.currency || known[0]?.currency || "").trim();
    const source = asset.customIdentifier ? null : this.getSource_(assetName, asset);
    if (!source && !this.isCustomIdentifierValid_(assetName, asset)) return [];

    const observations = source
      ? this.fetchMissingCloses_(assetName, source, currency, ranges, {
          knownKeys,
          lastKey: usesLivePrice ? targetKey - Dates.millisecondsPerDay : targetKey
        })
      : [];

    if (usesLivePrice) observations.push(this.buildLiveObservation_(assetName, asset, currency));
    return observations;
  }

  fetchMissingCloses_(assetName, source, currency, ranges, { knownKeys, lastKey }) {
    const observations = [];

    for (const { start, end } of ranges) {
      const rangeEnd = Math.min(end, lastKey);
      if (start > rangeEnd) continue;

      const canEstimate = PriceHistoryRefresher.hasPriceToCarry_(knownKeys, start);
      const closes = this.fetchCloses_(assetName, source, currency, start, rangeEnd, canEstimate);
      if (closes === null) continue;

      this.coverage.set(assetName, [...(this.coverage.get(assetName) ?? []), new DayRange(start, rangeEnd)]);

      observations.push(...PriceHistoryRefresher.takeNewObservations_(closes, assetName, currency, knownKeys));
    }

    return observations;
  }

  /** A span can open on a weekend, which never has a price, so it is the first weekday that counts. */
  static hasPriceToCarry_(knownKeys, startKey) {
    let firstWeekday = startKey;
    while (Dates.isWeekend(firstWeekday)) firstWeekday += Dates.millisecondsPerDay;

    return [...knownKeys].some((knownKey) => knownKey <= firstWeekday);
  }

  static takeNewObservations_(closes, assetName, currency, knownKeys) {
    const observations = [];

    for (const { date, close } of closes) {
      const dayKey = Dates.toDayKey(date);
      if (knownKeys.has(dayKey)) continue;

      knownKeys.add(dayKey);
      observations.push({ date, asset: assetName, currency, close });
    }

    return observations;
  }

  buildLiveObservation_(assetName, asset, currency) {
    PriceHistoryRefresher.log.information("buildLiveObservation_", `${assetName}: today's price ${asset.currentValue} taken from Assets.`);

    return { date: this.targetDate, asset: assetName, currency, close: asset.currentValue };
  }

  getSource_(assetName, asset) {
    const ticker = String(asset.ticker || "").trim();
    if (ticker === "") {
      this.report_(`${assetName}: Assets has no Google Finance Ticker, Yahoo Finance Ticker or Custom Identifier to fetch prices with.`);
      return null;
    }

    const symbol = asset.yahooTicker || YahooFinance.getSymbolForTicker(ticker);
    return {
      name: "Yahoo Finance",
      label: symbol,
      fetch: (start, end) => YahooFinance.fetchHistoricalCloses(symbol, start, end)
    };
  }

  isCustomIdentifierValid_(assetName, asset) {
    const { customIdentifier } = asset;
    if (LegalAndGeneral.isFundPage(customIdentifier)) return true;
    if (LondonStockExchange.isInstrumentPage(customIdentifier)) return true;
    this.report_(
      `${assetName}: the Custom Identifier is neither the address of a Legal & General fund page ` +
        "nor the full address of a London Stock Exchange page."
    );
    return false;
  }

  report_(message) {
    this.errors.push(message);
    PriceHistoryRefresher.log.error("report_", message);
  }

  /**
   * The closes, or null if there are none to use. The days left without a price are provisional, but only if an earlier price exists to carry, so
   * without one a source out of reach is an error.
   */
  fetchCloses_(assetName, source, currency, startKey, endKey, canEstimate) {
    const history = source.fetch(Dates.fromDayKey(startKey), Dates.fromDayKey(endKey));
    if (!history) {
      const message = `${assetName}: ${source.name} could not be reached for ${source.label}.`;
      if (canEstimate) PriceHistoryRefresher.log.warning("fetchCloses_", message);
      else this.report_(message);
      return null;
    }

    // A price quoted in another currency (or in pounds for pence) is not converted here, so it would be recorded in the wrong currency.
    if (history.currency && history.currency !== currency) {
      this.report_(`${assetName}: ${source.name} quotes ${source.label} in ${history.currency} but Assets lists ${currency}.`);
      return null;
    }

    PriceHistoryRefresher.log.information("fetchCloses_", `${assetName}: ${history.closes.length} closes from ${source.name} (${source.label}).`);

    return history.closes;
  }

  findMissingRanges_(periods, knownKeys, targetKey) {
    return periods
      .filter(({ start }) => start <= targetKey)
      .map(({ start, end }) => PriceHistoryRefresher.findMissingSpan_(start, Math.min(end, targetKey), knownKeys))
      .filter((span) => span !== null);
  }

  /** From the first day without a price to the last one, or null if every day has one. */
  static findMissingSpan_(first, last, knownKeys) {
    let firstMissing = first;
    while (firstMissing <= last && knownKeys.has(firstMissing)) firstMissing += Dates.millisecondsPerDay;
    if (firstMissing > last) return null;

    let lastMissing = last;
    while (knownKeys.has(lastMissing)) lastMissing -= Dates.millisecondsPerDay;

    return new DayRange(firstMissing, lastMissing);
  }

  findQuotedAssets_() {
    return [...HoldingPeriods.findLatestEventByAsset(this.ledgerRows).entries()]
      .map(([assetName, event]) => ({
        assetName,
        asset: this.assets.get(assetName),
        isOpen: Numbers.isHolding(event.closingQuantity)
      }))
      .filter(({ asset }) => asset && Assets.hasMarketPrice(asset));
  }

  static fetchMissingExchangeRates(observations) {
    const errors = [];
    const exchangeRates = [];
    const coverage = new Map();
    const observationsByAsset = Collections.groupBy(observations, (observation) => observation.asset);

    for (const [currency, days] of PriceHistoryRefresher.findRequiredRateDays_(observations)) {
      const series = Currencies.getFxSeries(currency);
      const existingKeys = new Set((observationsByAsset.get(series.asset) || []).map((observation) => Dates.toDayKey(observation.date)));

      const missingDays = [...days].filter(([dayKey]) => !existingKeys.has(dayKey));
      if (missingDays.length === 0) continue;

      const canEstimate = PriceHistoryRefresher.hasPriceToCarry_(existingKeys, Math.min(...missingDays.map(([dayKey]) => dayKey)));
      const fetched = PriceHistoryRefresher.fetchRates_(series, missingDays, canEstimate);
      errors.push(...fetched.errors);
      exchangeRates.push(...fetched.observations);
      if (fetched.coverage) coverage.set(series.asset, [fetched.coverage]);
    }

    return { observations: exchangeRates, errors, coverage };
  }

  /** For each foreign currency, the days (key to date) on which an asset is priced in it. */
  static findRequiredRateDays_(observations) {
    const daysByCurrency = new Map();

    for (const observation of observations) {
      const { currency } = observation;
      if (!Currencies.getFxSeries(currency)) continue;

      const days = daysByCurrency.get(currency) ?? new Map();
      days.set(Dates.toDayKey(observation.date), observation.date);
      daysByCurrency.set(currency, days);
    }

    return daysByCurrency;
  }

  static fetchRates_(series, missingDays, canEstimate) {
    const dayKeys = missingDays.map(([dayKey]) => dayKey);
    const span = new DayRange(Math.min(...dayKeys), Math.max(...dayKeys));
    const history = YahooFinance.fetchHistoricalCloses(series.yahooSymbol, new Date(span.start), new Date(span.end));

    if (!history) {
      const message = `${series.asset}: Yahoo Finance returned no exchange-rate history for ${series.yahooSymbol}.`;
      if (canEstimate) PriceHistoryRefresher.log.warning("fetchRates_", message);
      return { observations: [], errors: canEstimate ? [] : [message], coverage: null };
    }

    const closeByKey = new Map(history.closes.map(({ date, close }) => [Dates.toDayKey(date), close]));

    const observations = missingDays
      .filter(([dayKey]) => Number.isFinite(closeByKey.get(dayKey)))
      .map(([dayKey, date]) => ({
        date,
        asset: series.asset,
        currency: Currencies.pounds,
        close: closeByKey.get(dayKey)
      }));

    return { observations, errors: [], coverage: span };
  }
}
