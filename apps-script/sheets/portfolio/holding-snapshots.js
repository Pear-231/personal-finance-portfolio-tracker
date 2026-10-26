class HoldingSnapshots {
  constructor(ledgerRows, assets, observations, transactions) {
    this.valuationDate = new Date();
    this.ledgerRows = ledgerRows;
    this.assets = assets;
    this.observations = observations;
    this.transactions = transactions;
  }

  snapshotCurrentHoldings() {
    return [...HoldingPeriods.groupEventsByAsset(this.ledgerRows)].map(([asset, events]) =>
      this.snapshotAsset_(asset, events, this.getApportionment_(events).remaining)
    );
  }

  snapshotSales() {
    return [...HoldingPeriods.groupEventsByAsset(this.ledgerRows)].flatMap(([asset, events]) =>
      this.getApportionment_(events).sales.map((sale) => this.snapshotSale_(asset, sale))
    );
  }

  getApportionment_(events) {
    return new HoldingApportionment(events, this.transactions).run();
  }

  snapshotAsset_(asset, events, remaining) {
    const inOrder = HoldingSnapshots.sortChronologically_(events);
    const latest = inOrder[inOrder.length - 1];
    const metadata = this.findMetadata_(asset, latest.assetType);
    const quantity = latest.closingQuantity;
    const { income, fees, accruedInterestPaid } = remaining;

    const isClosed = !Numbers.isHolding(quantity);
    const isCash = metadata.assetType === AssetTypes.cash;
    const { price, exchangeRate, priceValue, value } = this.valueHolding_(asset, metadata, latest);
    const openCost = latest.closingOpenCost;

    const localOpenCost = this.calculateLocalOpenCost_(asset);

    const localAverageCost = quantity !== 0 ? localOpenCost / quantity : 0;
    const attribution = isClosed
      ? { assetReturn: 0, currencyEffect: 0 }
      : HoldingSnapshots.attributeOpen_(metadata, {
          quantity,
          price,
          localAverageCost,
          averageExchangeRate: localOpenCost > 0 ? Math.max(0, openCost - fees) / localOpenCost : exchangeRate,
          capitalReturn: priceValue - openCost,
          fees
        });

    const isShownAsOne = isCash && !isClosed;
    return {
      asset,
      assetType: metadata.assetType || latest.assetType,
      currency: metadata.currency || Currencies.pounds,
      openDate: HoldingSnapshots.findOpenDate_(inOrder),
      closeDate: "",
      quantity: isShownAsOne ? 1 : quantity,
      costBasis: openCost,
      income,
      fees,
      realisedPnl: 0,
      price: isShownAsOne ? value : price,
      value,
      totalReturn: value + income - openCost - accruedInterestPaid,
      localAverageCost: isShownAsOne ? openCost : localAverageCost,
      assetReturn: attribution.assetReturn,
      currencyEffect: attribution.currencyEffect
    };
  }

  findMetadata_(asset, fallbackAssetType) {
    return this.assets.get(asset) || { assetType: fallbackAssetType, currency: Currencies.pounds };
  }

  /** A closed holding has no value, and is not priced. */
  valueHolding_(asset, metadata, latest) {
    const quantity = latest.closingQuantity;
    if (!Numbers.isHolding(quantity)) return { price: 0, exchangeRate: 1, priceValue: 0, value: 0 };

    const price = this.getCurrentPrice_(asset, metadata, latest);
    const exchangeRate = this.findLatestExchangeRate_(metadata.currency);
    const priceValue = quantity * price * exchangeRate;
    const accruedInterest = quantity * Assets.calculatePerUnit(metadata, this.valuationDate);
    return { price, exchangeRate, priceValue, value: priceValue + accruedInterest };
  }

  snapshotSale_(asset, sale) {
    const { event } = sale;
    const metadata = this.findMetadata_(asset, event.assetType);
    const fees = sale.fees + event.fees;
    const capitalReturn = event.realisedPnl;
    const accruedInterestPaid = sale.accruedInterestPaid + Numbers.toNumber(event.accruedInterestPaid);

    const attribution = this.attributeSale_(metadata.currency, sale, capitalReturn, fees, metadata.isShort);

    const localCost = sale.localCost > 0 ? sale.localCost : event.costReleased;
    return {
      asset,
      assetType: metadata.assetType || event.assetType,
      currency: metadata.currency || Currencies.pounds,
      openDate: sale.openDate || event.date,
      closeDate: event.date,
      quantity: sale.quantity,
      costBasis: event.costReleased,
      income: sale.income,
      fees,
      realisedPnl: capitalReturn,
      price: 0,
      value: 0,
      totalReturn: capitalReturn + sale.income - accruedInterestPaid,
      localAverageCost: localCost / sale.quantity,
      assetReturn: attribution.assetReturn,
      currencyEffect: attribution.currencyEffect
    };
  }

  attributeSale_(currency, sale, capitalReturn, fees, isShort) {
    const withoutCurrencyEffect = { assetReturn: capitalReturn + fees, currencyEffect: 0 };
    const { localCost: localEntryValue, localProceeds: localCloseValue } = sale;
    const entryPoundValue = sale.poundCost;
    if (
      Currencies.isSterling(currency) ||
      !Numbers.isPositive(localEntryValue) ||
      !Numbers.isPositive(localCloseValue) ||
      !Numbers.isPositive(entryPoundValue)
    ) {
      return withoutCurrencyEffect;
    }

    const localCapitalReturn = isShort ? localEntryValue - localCloseValue : localCloseValue - localEntryValue;

    const assetReturn = (localCapitalReturn * entryPoundValue) / localEntryValue;
    return { assetReturn, currencyEffect: capitalReturn + fees - assetReturn };
  }

  static attributeOpen_({ isShort, currency }, { quantity, price, localAverageCost, averageExchangeRate, capitalReturn, fees }) {
    if (Currencies.isSterling(currency)) {
      return { assetReturn: capitalReturn + fees, currencyEffect: 0 };
    }

    const priceChange = isShort ? localAverageCost - price : price - localAverageCost;
    const assetReturn = quantity * priceChange * averageExchangeRate;
    return { assetReturn, currencyEffect: capitalReturn + fees - assetReturn };
  }

  static findOpenDate_(events) {
    let quantityBefore = 0;
    let openDate = "";

    for (const event of events) {
      const isOpening = !Numbers.isHolding(quantityBefore) && Numbers.isHolding(event.closingQuantity);
      openDate = isOpening ? event.date : openDate;
      quantityBefore = event.closingQuantity;
    }

    return openDate;
  }

  getCurrentPrice_(asset, metadata, latest) {
    const calculateCostPerUnit = () =>
      !Numbers.isHolding(latest.closingQuantity)
        ? 0
        : latest.closingOpenCost / latest.closingQuantity / this.findLatestExchangeRate_(metadata.currency);

    const market = this.findLatestClose_(asset);
    if (Assets.isDatedValuation(metadata)) return market || calculateCostPerUnit();
    if (metadata.assetType === AssetTypes.cash) return 1;

    return metadata.currentValue > 0 ? metadata.currentValue : market || calculateCostPerUnit();
  }

  findLatestExchangeRate_(currency) {
    const sterlingFactor = Currencies.getSterlingFactor(currency);
    if (sterlingFactor !== null) return sterlingFactor;
    return this.findLatestClose_(Currencies.getFxAssetName(currency)) || 1;
  }

  findLatestClose_(series) {
    const closes = this.observations
      .filter((observation) => observation.asset === series && observation.close > 0)
      .sort((left, right) => right.date - left.date);
    return closes.length > 0 ? closes[0].close : null;
  }

  calculateLocalOpenCost_(asset) {
    const position = { quantity: 0, localCost: 0 };
    const transactions = this.transactions.filter((transaction) => transaction.asset === asset);

    for (const transaction of HoldingSnapshots.sortChronologically_(transactions)) {
      HoldingSnapshots.applyToLocalPosition_(position, transaction);
    }

    return Math.max(0, position.localCost);
  }

  static applyToLocalPosition_(position, transaction) {
    const quantity = Numbers.toNumber(transaction.quantity);
    const type = transaction.transactionType;

    if (TransactionTypes.purchaseTypes.includes(type) && quantity > 0) {
      position.quantity += quantity;
      position.localCost += Numbers.getAbsolute(transaction.localValue);
    } else if (type === TransactionTypes.managementCharge && quantity > 0) {
      position.quantity -= Math.min(quantity, position.quantity);
    } else if (TransactionTypes.saleTypes.includes(type) && quantity > 0) {
      HoldingSnapshots.releaseLocalCost_(position, quantity);
    } else if (type === TransactionTypes.stockSplit && Numbers.isPositive(position.quantity)) {
      position.quantity *= TransactionTypes.getSplitRatio(transaction.details) || 1;
    }
  }

  static releaseLocalCost_(position, quantity) {
    if (!Numbers.isPositive(position.quantity)) return;

    const quantitySold = Math.min(quantity, position.quantity);
    position.localCost -= (position.localCost * quantitySold) / position.quantity;
    position.quantity -= quantity;
  }

  static sortChronologically_(events) {
    return events.slice().sort(Dates.compareChronologically);
  }
}
