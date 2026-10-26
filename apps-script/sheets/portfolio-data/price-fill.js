class PriceFill {
  constructor(ledgerRows, assets, targetDate, coverage = new Map()) {
    this.ledgerRows = ledgerRows;
    this.assets = assets;
    this.targetKey = Dates.toDayKey(targetDate);
    this.coverage = coverage;
  }

  build(observations) {
    const observationsBySeries = PriceFill.groupObservationsBySeries_(observations);

    const periodsByAsset = HoldingPeriods.findPeriodsByAsset(this.ledgerRows.filter((event) => event.category !== LedgerReplay.incomeCategory));

    const added = [];
    for (const [series, periods] of this.buildSeries_(periodsByAsset)) {
      const observationByDay = observationsBySeries.get(series) || new Map();
      added.push(...this.fillSeries_(series, periods, observationByDay));
    }

    added.push(...this.findUnquotedAssetDays_(observationsBySeries));
    return { observations: added };
  }

  findUnquotedAssetDays_(observationsBySeries) {
    const added = [];
    for (const [assetName, events] of HoldingPeriods.groupEventsByAsset(this.ledgerRows)) {
      const asset = this.assets.get(assetName);
      if (!asset || Assets.hasMarketPrice(asset)) continue;

      const recorded = observationsBySeries.get(assetName) || new Map();
      const valuations = [...recorded.values()].sort((left, right) => left.date - right.date);
      const prices = this.buildUnquotedPrices(assetName, asset, events, valuations);
      added.push(...prices.filter((price) => !recorded.has(Dates.toDayKey(price.date)) && price.close > 0));
    }

    return added;
  }

  buildUnquotedPrices(assetName, asset, events, valuations) {
    return Assets.isDatedValuation(asset)
      ? this.buildDatedValuations(assetName, asset, events, valuations)
      : this.buildCostValuations(assetName, asset, events);
  }

  buildCostValuations(assetName, asset, events) {
    if (Assets.hasMarketPrice(asset)) return [];
    return this.findHoldingDays_(events).map(({ date, unitCost }) => ({
      asset: assetName,
      currency: Currencies.pounds,
      date,
      close: unitCost
    }));
  }

  buildDatedValuations(assetName, asset, events, valuations) {
    const valuationDays = valuations.map((valuation) => Dates.toDayKey(valuation.date));

    return this.findHoldingDays_(events).map(({ date, unitCost }) => {
      const latest = PriceFill.findLastIndexOnOrBefore_(valuationDays, Dates.toDayKey(date));
      return {
        asset: assetName,
        currency: asset.currency,
        date,
        close: latest >= 0 ? valuations[latest].close : unitCost
      };
    });
  }

  findHoldingDays_(events) {
    const eventsByDay = Collections.groupBy(events, (event) => Dates.toDayKey(event.date));
    const eventDays = [...eventsByDay.keys()].sort((left, right) => left - right);

    const lastDate = Dates.fromDayKey(this.targetKey);
    const position = { quantity: 0, unitCost: 0 };
    const days = [];

    for (let date = Dates.fromDayKey(eventDays[0]); date <= lastDate; date = Dates.addDays(date, 1)) {
      const quantityBefore = position.quantity;
      PriceFill.applyDayEvents_(position, eventsByDay.get(Dates.toDayKey(date)) || []);

      const isOpen = Numbers.isHolding(position.quantity);
      const closedToday = Numbers.isHolding(quantityBefore) && !isOpen;
      if (!isOpen && !closedToday) continue;

      days.push({ date: Dates.getStartOfDay(date), unitCost: position.unitCost });
    }

    return days;
  }

  static applyDayEvents_(position, events) {
    for (const event of events) {
      position.quantity = event.closingQuantity;
      if (!Numbers.isHolding(position.quantity)) continue;

      position.unitCost = event.closingOpenCost / position.quantity;
    }
  }

  buildSeries_(periodsByAsset) {
    const series = new Map();
    const foreignPeriods = new Map();

    for (const [assetName, periods] of periodsByAsset) {
      const asset = this.assets.get(assetName);
      if (!asset || !Assets.hasMarketPrice(asset)) continue;

      series.set(assetName, periods);
      if (!Currencies.isForeign(asset.currency)) continue;

      foreignPeriods.set(asset.currency, [...(foreignPeriods.get(asset.currency) ?? []), ...periods]);
    }

    for (const [currency, periods] of foreignPeriods) {
      series.set(Currencies.getFxAssetName(currency), DayRange.merge(periods));
    }

    return series;
  }

  fillSeries_(series, periods, observationByDay) {
    const knownDays = [...observationByDay.keys()].sort((left, right) => left - right);
    const added = [];

    for (const period of periods) {
      added.push(...this.fillPeriod_(series, period, { observationByDay, knownDays }));
    }

    return added;
  }

  /**
   * A day with no price takes the latest known one. It is provisional unless the market was closed.
   */
  fillPeriod_(series, { start, end }, { observationByDay, knownDays }) {
    const added = [];
    const lastDay = Math.min(end, this.targetKey);

    for (let day = start; day <= lastDay; day += Dates.millisecondsPerDay) {
      const latestKnown = PriceFill.findLastIndexOnOrBefore_(knownDays, day);
      if (observationByDay.has(day) || latestKnown < 0) continue;

      const latest = observationByDay.get(knownDays[latestKnown]);
      const isMarketClosed = this.isMarketClosed_(series, day, knownDays, latestKnown);
      added.push({
        date: Dates.fromDayKey(day),
        asset: series,
        currency: latest.currency,
        close: latest.close,
        isProvisional: Boolean(latest.isProvisional) || !isMarketClosed
      });
    }

    return added;
  }

  /**
   * A weekend after a Friday price, or a weekday that a source answered for without a price while a later day has one. A source that was not reached
   * says nothing about the day.
   */
  isMarketClosed_(series, day, knownDays, latestKnown) {
    if (PriceFill.isWeekendAfterFriday_(day, knownDays[latestKnown])) return true;

    const hasLaterPrice = latestKnown + 1 < knownDays.length;
    const ranges = this.coverage.get(series) ?? [];
    return hasLaterPrice && ranges.some(({ start, end }) => start <= day && day <= end);
  }

  static isWeekendAfterFriday_(day, latestKnownDay) {
    const isFriday = Dates.getWeekday(latestKnownDay) === 5;
    return isFriday && Dates.isWeekend(day) && day - latestKnownDay <= 2 * Dates.millisecondsPerDay;
  }

  static groupObservationsBySeries_(observations) {
    const bySeries = new Map();

    for (const observation of observations) {
      if (!PortfolioData.isUsableObservation(observation)) continue;

      const days = bySeries.get(observation.asset) ?? new Map();
      days.set(Dates.toDayKey(observation.date), observation);
      bySeries.set(observation.asset, days);
    }

    return bySeries;
  }

  /** The index of the last day on or before `day` in the ascending `sortedDays`, or -1. */
  static findLastIndexOnOrBefore_(sortedDays, day) {
    let low = 0;
    let high = sortedDays.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sortedDays[middle] <= day) low = middle + 1;
      else high = middle;
    }

    return low - 1;
  }
}
