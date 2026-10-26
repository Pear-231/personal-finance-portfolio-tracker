class ValuationHistory {
  constructor(ledgerRows, assets, observations) {
    this.ledgerRows = ledgerRows;
    this.assets = assets;
    this.observations = observations;
    this.errors = [];
  }

  static describeErrors(errors) {
    return `Portfolio Data was not written because ${errors.length} valuation issue(s) need review:\n${Logger.buildPreview(errors)}`;
  }

  static buildUpToLatestValuation(ledgerRows, assets, observations) {
    const calendar = {
      asset: "__Valuation Calendar",
      currency: Currencies.pounds,
      date: Dates.findLatestCompletedValuation(),
      close: 1
    };
    return new ValuationHistory(ledgerRows, assets, [...observations, calendar]).run();
  }

  run() {
    const latest = this.findLatestObservationDate_();
    this.horizonKey = Dates.toDayKey(latest);
    const pricesByAsset = this.groupPricesByAsset_();
    const eventsByAsset = this.groupEventsByAsset_();
    const priceFill = new PriceFill(this.ledgerRows, this.assets, latest);

    const valuations = [...eventsByAsset].flatMap(([assetName, events]) => this.valueAsset_(assetName, events, pricesByAsset, priceFill));

    if (this.errors.length > 0) return { valuations: [], errors: this.errors };

    valuations.sort((left, right) => left.date.getTime() - right.date.getTime() || left.asset.localeCompare(right.asset));

    return { valuations, errors: [] };
  }

  /** Records what stops the asset being valued, and gives no valuations then. */
  valueAsset_(assetName, events, pricesByAsset, priceFill) {
    const asset = this.assets.get(assetName);
    if (!asset) {
      this.errors.push(`Transactions lists the asset "${assetName}", which is not in Assets: add it there.`);
      return [];
    }

    const quotedPrices = pricesByAsset.get(assetName) || [];
    const mismatchedUnit = ValuationHistory.findMismatchedUnit_(asset, quotedPrices);
    if (mismatchedUnit) {
      this.errors.push(
        `${assetName}: Portfolio Data prices are in ${mismatchedUnit.currency} but Assets ` +
          `lists ${asset.currency}. Correct the unit in Assets or Portfolio Data.`
      );
      return [];
    }

    const prices = this.getPrices_(assetName, asset, events, quotedPrices, priceFill);
    if (prices.length === 0) {
      this.checkOpenPositionHasPrices_(assetName, events);
      return [];
    }

    return this.buildValuationsForAsset_(assetName, asset, events, prices, pricesByAsset);
  }

  static findMismatchedUnit_(asset, quotedPrices) {
    const isQuoted = Assets.hasMarketPrice(asset) || Assets.isDatedValuation(asset);
    return quotedPrices.find((price) => isQuoted && price.currency !== asset.currency);
  }

  checkOpenPositionHasPrices_(assetName, events) {
    const isWaiting = events.every((event) => Dates.toDayKey(event.date) > this.horizonKey);
    if (isWaiting || !events.some((event) => Numbers.isHolding(event.closingQuantity))) return;

    this.errors.push(
      `${assetName}: no price history is available while the position is ` +
        "open. Give it a ticker or Custom Identifier in Assets, or add its prices to " +
        "Portfolio Data by hand (see the README)."
    );
  }

  getPrices_(assetName, asset, events, quotedPrices, priceFill) {
    if (!Assets.isDatedValuation(asset) && quotedPrices.length > 0) return quotedPrices;
    return priceFill.buildUnquotedPrices(assetName, asset, events, quotedPrices);
  }

  findLatestObservationDate_() {
    return this.observations.reduce((latest, { date }) => (date > latest ? date : latest), this.observations[0].date);
  }

  groupPricesByAsset_() {
    const prices = new Map();

    for (const observation of this.observations) {
      const days = prices.get(observation.asset) ?? new Map();
      const dayKey = Dates.toDayKey(observation.date);
      this.checkSingleClose_(days.get(dayKey), observation);
      days.set(dayKey, observation);
      prices.set(observation.asset, days);
    }

    return new Map([...prices].map(([asset, byDate]) => [asset, [...byDate.values()].sort((left, right) => left.date - right.date)]));
  }

  checkSingleClose_(previous, observation) {
    if (!previous || Numbers.isNearlyEqual(previous.close, observation.close)) return;

    this.errors.push(`${observation.asset}: Portfolio Data has more than one closing price for ${Dates.formatDisplay(observation.date)}. Keep one.`);
  }

  groupEventsByAsset_() {
    const eventsByAsset = HoldingPeriods.groupEventsByAsset(this.ledgerRows);
    for (const events of eventsByAsset.values()) {
      events.sort(Dates.compareChronologically);
    }

    return eventsByAsset;
  }

  buildValuationsForAsset_(assetName, asset, allEvents, prices, pricesByAsset) {
    const events = allEvents.filter((event) => event.category !== LedgerReplay.incomeCategory);
    const incomeByDay = ValuationHistory.groupIncomeByPriceDay_(allEvents, prices);

    const position = {
      eventIndex: 0,
      quantity: 0,
      value: 0,
      grossExposure: 0,
      openCost: 0,
      openCostLocal: 0,
      accruedInterestPaid: 0
    };

    const valuations = [];

    for (const price of prices) {
      const priceDay = Dates.toDayKey(price.date);
      const activity = ValuationHistory.applyActivityOn_(events, position, priceDay, incomeByDay.get(priceDay));

      const rate = this.findExchangeRate_(assetName, price, pricesByAsset);
      if (!rate) continue;

      const { valuation, grossExposure } = this.buildValuationOn_({ assetName, asset, price, rate }, position, activity);

      valuations.push(valuation);
      position.quantity = activity.closeQuantity;
      position.value = valuation.closeValue;
      position.grossExposure = grossExposure;
    }

    this.checkEventsPriced_(assetName, events.slice(position.eventIndex));
    return valuations;
  }

  static applyActivityOn_(events, position, priceDay, income) {
    const activity = {
      closeQuantity: position.quantity,
      netCashFlow: 0,
      distributions: income || 0,
      fees: 0,
      managementCharges: 0,
      realisedPnl: 0
    };

    while (position.eventIndex < events.length && Dates.toDayKey(events[position.eventIndex].date) <= priceDay) {
      ValuationHistory.applyEvent_(position, activity, events[position.eventIndex]);
      position.eventIndex += 1;
    }

    return activity;
  }

  static applyEvent_(position, activity, event) {
    activity.closeQuantity = event.closingQuantity;
    position.openCost = event.closingOpenCost;
    position.openCostLocal = event.closingOpenCostLocal;
    activity.fees += event.fees;
    activity.managementCharges += Numbers.toNumber(event.managementCharge);
    activity.realisedPnl += event.realisedPnl;
    ValuationHistory.applyAccruedInterestPaid_(position, event);

    if (event.category !== LedgerReplay.tradeCategory) return;
    activity.netCashFlow -= event.gbpCashFlow + event.fees;
  }

  static applyAccruedInterestPaid_(position, event) {
    if (event.category !== LedgerReplay.tradeCategory) return;

    if (TransactionTypes.purchaseTypes.includes(event.transactionType)) {
      position.accruedInterestPaid += Numbers.toNumber(event.accruedInterestPaid);
    } else if (TransactionTypes.saleTypes.includes(event.transactionType)) {
      const unitsBefore = event.closingQuantity - event.quantityChange;
      const share = Numbers.isPositive(unitsBefore) ? Math.min(1, Math.abs(event.quantityChange) / unitsBefore) : 1;
      position.accruedInterestPaid *= 1 - share;
    }

    if (!Numbers.isHolding(event.closingQuantity)) position.accruedInterestPaid = 0;
  }

  buildValuationOn_({ assetName, asset, price, rate }, position, activity) {
    const exchangeRate = rate.close;
    const isDerivative = Assets.isDerivative(asset);
    const localUnitValue = price.close;
    const closeValue = this.calculateClosingValue_(
      asset,
      activity.closeQuantity,
      localUnitValue,
      exchangeRate,
      position.openCost,
      position.openCostLocal,
      price.date
    );

    const priceInPounds = localUnitValue * exchangeRate;
    const grossExposure = isDerivative ? Math.abs(activity.closeQuantity * priceInPounds) : 0;
    const { netCashFlow } = activity;
    const { returnAmount, returnBase } = ValuationHistory.calculateReturn_(isDerivative, {
      position,
      activity,
      closeValue,
      grossExposure
    });

    return {
      grossExposure,
      valuation: {
        date: Dates.getStartOfDay(price.date),
        asset: assetName,
        currency: price.currency,
        openQuantity: position.quantity,
        closeQuantity: activity.closeQuantity,
        localUnitValue,
        exchangeRate,
        openValue: position.value,
        netCashFlow,
        distributions: activity.distributions,
        fees: activity.fees + activity.managementCharges,
        closeValue,
        returnAmount,
        dailyReturn: Numbers.isPositive(returnBase) ? returnAmount / returnBase : 0,
        margin: grossExposure / Math.max(asset.leverage, 1),
        accruedInterest: isDerivative ? 0 : activity.closeQuantity * Assets.calculatePerUnit(asset, price.date),
        accruedInterestPaid: position.accruedInterestPaid,
        isProvisional: Boolean(price.isProvisional || rate.isProvisional)
      }
    };
  }

  /** A derivative is measured against its exposure, and is not funded by its cash flow. */
  static calculateReturn_(isDerivative, { position, activity, closeValue, grossExposure }) {
    if (isDerivative) {
      return {
        returnAmount: closeValue - position.value + activity.realisedPnl + activity.distributions,
        returnBase: Numbers.isPositive(position.grossExposure) ? position.grossExposure : grossExposure
      };
    }

    const { netCashFlow } = activity;
    return {
      returnAmount: closeValue - position.value - netCashFlow + activity.distributions - activity.fees,
      returnBase: position.value + Math.max(netCashFlow, 0)
    };
  }

  checkEventsPriced_(assetName, unpricedEvents) {
    const unpriced = unpricedEvents
      .filter((event) => Dates.toDayKey(event.date) <= this.horizonKey)
      .filter((event) => Numbers.isHolding(event.closingQuantity) || event.category === LedgerReplay.tradeCategory);

    if (unpriced.length > 0) {
      this.errors.push(
        `${assetName}: its latest price is older than its trade on ` +
          `${Dates.formatDisplay(unpriced[0].date)}, so it cannot be valued then. Check its ticker ` +
          "in Assets, or add the missing prices to Portfolio Data."
      );
    }
  }

  static groupIncomeByPriceDay_(events, prices) {
    const priceDays = prices.map((price) => Dates.toDayKey(price.date));
    const byDay = new Map();
    for (const event of events.filter((event) => event.category === LedgerReplay.incomeCategory)) {
      const day = Dates.toDayKey(event.incomeDate || event.date);
      const before = priceDays.filter((priceDay) => priceDay <= day);
      const target = before.length > 0 ? before[before.length - 1] : priceDays[0];
      byDay.set(target, (byDay.get(target) || 0) + event.income);
    }
    return byDay;
  }

  calculateClosingValue_(asset, quantity, localPrice, exchangeRate, openCost, openCostLocal, date) {
    if (Assets.isDerivative(asset) && Currencies.isForeign(asset.currency)) {
      const localProfit = asset.isShort ? openCostLocal - quantity * localPrice : quantity * localPrice - openCostLocal;
      return localProfit * exchangeRate;
    }

    const notional = quantity * (localPrice * exchangeRate);

    if (Assets.isDerivative(asset)) {
      return asset.isShort ? openCost - notional : notional - openCost;
    }

    return notional + quantity * Assets.calculatePerUnit(asset, date);
  }

  findExchangeRate_(assetName, price, pricesByAsset) {
    const sterlingFactor = Currencies.getSterlingFactor(price.currency);
    if (sterlingFactor !== null) return { close: sterlingFactor, isProvisional: false };

    const rates = pricesByAsset.get(Currencies.getFxAssetName(price.currency)) || [];
    const dayKey = Dates.toDayKey(price.date);
    const matching = rates.find((rate) => Dates.toDayKey(rate.date) === dayKey);
    if (matching) return matching;

    this.errors.push(
      `${assetName}: no ${price.currency}/GBP exchange rate is available for ` +
        `${Dates.formatDisplay(price.date)}. Run it again to fetch it, or ` +
        "add the rate to Portfolio Data."
    );
    return null;
  }
}
