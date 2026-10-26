class LedgerReplay {
  static get tradeCategory() {
    return "Trade";
  }

  static get derivativeTradeCategory() {
    return "Derivative trade";
  }

  static get corporateActionCategory() {
    return "Corporate action";
  }

  static get managementChargeCategory() {
    return "Management charge";
  }

  static get incomeCategory() {
    return "Income";
  }

  static get log() {
    return Logger.create("Sheets.Transactions.LedgerReplay");
  }

  static load(spreadsheet, { isValidated = false } = {}) {
    const assets = new Assets(spreadsheet).read();
    const transactionsSheet = new Transactions(spreadsheet);
    const transactions = transactionsSheet.read();

    if (isValidated) transactionsSheet.validate(transactions, assets);

    const replay = new LedgerReplay(transactions, assets).run();
    LedgerReplay.log.throwIfAny("load", replay.errors, LedgerReplay.describeErrors);

    LedgerReplay.log.information(
      "load",
      `${assets.size} assets and ${transactions.length} transactions replayed into ` +
        `${replay.ledgerRows.length} ledger rows and ${replay.valuations.length} valuations.`
    );

    return {
      assets,
      sourceRows: replay.transactions,
      ledgerRows: replay.ledgerRows,
      valuations: replay.valuations
    };
  }

  static describeErrors(errors) {
    return `The ledger could not be built because ${errors.length} transaction row(s) need review:\n` + Logger.buildPreview(errors);
  }

  constructor(transactions, assets) {
    this.transactions = transactions;
    this.assets = assets;
    this.positions = new Map();
    this.errors = [];
    this.ledgerRows = [];
    this.valuations = [];
    this.derived = new Map();
    this.cashDays = new Set();
  }

  run() {
    for (const transaction of [...this.transactions].sort(Dates.compareChronologically)) {
      this.apply_(transaction);
    }
    return {
      ledgerRows: this.ledgerRows,
      valuations: this.valuations,
      // The transactions, with each cash Valuation replaced by the deposit or withdrawal it made.
      transactions: this.transactions.map((transaction) => this.derived.get(transaction) || transaction),
      errors: this.errors
    };
  }

  apply_(transaction) {
    if (!TransactionTypes.all.includes(transaction.transactionType)) {
      this.recordError_(
        transaction,
        `"${transaction.transactionType}" is not a transaction type the script supports (${TransactionTypes.all.join(", ")})`
      );
      return;
    }

    if (transaction.transactionType === TransactionTypes.valuation) {
      this.applyValuation_(transaction);
      return;
    }

    const asset = this.assets.get(transaction.asset) || { isShort: false, leverage: 1 };
    const position = this.getPosition_(transaction.asset);

    const effect = this.calculateEffect_(transaction, position, asset);
    if (!effect) return;

    this.ledgerRows.push(LedgerReplay.createEvent_(transaction, effect, position));
  }

  applyValuation_(transaction) {
    const asset = this.assets.get(transaction.asset);
    const problem = LedgerReplay.findValuationProblem_(transaction, asset);
    if (problem) {
      this.recordError_(transaction, problem);
      return;
    }

    const close = Numbers.toNumber(transaction.localUnitValue);

    if (asset.assetType === AssetTypes.cash) this.applyCashBalance_(transaction, asset, close);
    else this.applyAssetValuation_(transaction, asset, close);
  }

  static findValuationProblem_(transaction, asset) {
    if (!asset || !Assets.isValued(asset)) {
      return "a Valuation is only for an Other Asset or a cash account in Assets";
    }

    if (asset.assetType === AssetTypes.cash) {
      if (transaction.localUnitValue === "") {
        return "a Valuation requires the balance as its Local Unit Value (zero closes the account, and below zero is an overdraft)";
      }
    } else if (!(Numbers.toNumber(transaction.localUnitValue) > 0)) {
      return "a Valuation requires a Local Unit Value above zero";
    }

    if (transaction.currency && transaction.currency !== asset.currency) {
      return `its Currency must be ${asset.currency}, as in Assets`;
    }

    return null;
  }

  applyAssetValuation_(transaction, asset, close) {
    if (!Numbers.isHolding(this.getPosition_(transaction.asset).quantity)) {
      this.recordError_(transaction, "the asset is not held on that date (a Valuation follows its purchase)");
      return;
    }

    const day = Dates.toDayKey(transaction.date);
    const earlier = this.valuations.find((valuation) => valuation.asset === transaction.asset && Dates.toDayKey(valuation.date) === day);

    if (earlier) {
      this.recordError_(transaction, `the asset already has a Valuation on that date, in Transactions row ${earlier.sourceRow}`);
      return;
    }

    this.valuations.push({
      date: Dates.getStartOfDay(transaction.date),
      asset: transaction.asset,
      currency: asset.currency,
      close,
      sourceRow: transaction.sourceRow
    });
  }

  applyCashBalance_(transaction, asset, balance) {
    if (asset.currency !== Currencies.pounds) {
      this.recordError_(transaction, "a cash account is held in pounds, so its Currency must be GBP");
      return;
    }

    const position = this.getPosition_(transaction.asset);
    const accountDay = `${transaction.asset}|${Dates.toDayKey(transaction.date)}`;
    if (this.cashDays.has(accountDay)) {
      this.recordError_(transaction, "the account already has a Valuation on that date");
      return;
    }

    this.cashDays.add(accountDay);
    const change = balance - position.quantity;
    if (Numbers.isNearlyEqual(change, 0)) return;
    const trade = LedgerReplay.buildCashTrade_(transaction, change);

    const isOverdrawn = position.quantity < -Numbers.tolerance || balance < -Numbers.tolerance;
    const effect = isOverdrawn ? this.applyOverdrawnCashTrade_(position, change) : this.calculateEffect_(trade, position, asset);

    if (!effect) return;
    this.ledgerRows.push(LedgerReplay.createEvent_(trade, effect, position));
    this.derived.set(transaction, trade);
  }

  /** The deposit or withdrawal that moves the account to the balance a Valuation gives. */
  static buildCashTrade_(transaction, change) {
    const amount = Math.abs(change);
    const signedAmount = change > 0 ? amount : -amount;
    return {
      ...transaction,
      transactionType: change > 0 ? TransactionTypes.purchase : TransactionTypes.sale,
      details: "Derived from a Valuation",
      currency: Currencies.pounds,
      quantity: amount,
      value: signedAmount,
      localUnitValue: 1,
      localValue: signedAmount,
      exchangeRate: 1,
      fees: 0,
      accruedInterest: 0,
      positionId: ""
    };
  }

  applyOverdrawnCashTrade_(position, change) {
    const pool = this.getPool_(position, "");
    for (const holding of [pool, position]) {
      holding.quantity += change;
      holding.openCost = holding.quantity;
    }

    LedgerReplay.closeIfEmpty_(pool);
    LedgerReplay.closeIfEmpty_(position);
    const amount = Math.abs(change);
    return LedgerReplay.createEffect_({
      category: LedgerReplay.tradeCategory,
      quantityChange: change,
      gbpCashFlow: change > 0 ? -amount : amount,
      costReleased: change > 0 ? 0 : amount
    });
  }

  calculateEffect_(transaction, position, asset) {
    const type = transaction.transactionType;
    if (TransactionTypes.purchaseTypes.includes(type)) {
      return this.applyPurchase_(transaction, position, asset);
    }

    if (TransactionTypes.saleTypes.includes(type)) return this.applySale_(transaction, position, asset);

    if (type === TransactionTypes.managementCharge) {
      return this.applyManagementCharge_(transaction, position);
    }

    if (type === TransactionTypes.stockSplit) return this.applyStockSplit_(transaction, position);
    if (type === TransactionTypes.coupon) return this.applyCoupon_(transaction, position, asset);
    return this.applyIncome_(transaction, asset);
  }

  calculateForeignDerivativeProfit_(transaction, asset, { pool, position, saleQuantity, localValue, fees }) {
    const exchangeRate = Numbers.toNumber(transaction.exchangeRate);
    if (!(localValue > 0) || !(exchangeRate > 0)) {
      return this.recordError_(transaction, `a ${asset.currency} derivative requires a Local Value and an Exchange Rate`);
    }

    const fractionClosed = saleQuantity / pool.quantity;
    const localCostReleased = pool.localOpenCost * fractionClosed;
    const entryFeesReleased = pool.entryFees * fractionClosed;

    const localProfit = asset.isShort ? localCostReleased - localValue : localValue - localCostReleased;

    for (const holding of [pool, position]) {
      holding.localOpenCost -= localCostReleased;
      holding.entryFees -= entryFeesReleased;
    }

    return localProfit / exchangeRate - fees - entryFeesReleased;
  }

  applyCoupon_(transaction, position, asset) {
    const scheduled = Assets.findNearestCouponDate(asset, transaction.date);
    if (scheduled === null) return this.applyIncome_(transaction, asset);
    const daysApart = Math.abs(Dates.countDaysBetween(scheduled, transaction.date));
    if (daysApart > 5) {
      return this.recordError_(
        transaction,
        `a Coupon on ${Dates.formatDisplay(transaction.date)} is not near a scheduled coupon date ` +
          `(the nearest is ${Dates.formatDisplay(scheduled)}); the schedule is from the Coupon (%), ` +
          "Coupons per Year and Maturity Date in Assets, which only a bond should have"
      );
    }

    const expected = position.quantity * Assets.calculateCouponPerUnit(asset);
    const amount = Numbers.getAbsolute(transaction.value);
    if (Math.abs(amount - expected) > 0.02 + 0.0001 * expected) {
      return this.recordError_(transaction, `a Coupon of ${amount} is not the coupon of ${expected.toFixed(2)} due on ${position.quantity} held`);
    }

    return this.applyIncome_(transaction, asset);
  }

  applyPurchase_(transaction, position, asset) {
    const { quantity, amount, fees, accruedInterest, localValue, isDerivative, isForeignDerivative } = LedgerReplay.getTradeFigures_(
      transaction,
      asset
    );

    if (!(quantity > 0) || !(amount > 0)) {
      return this.recordError_(transaction, `a purchase requires a positive ${Transactions.quantityHeader} and ${Transactions.valueHeader}`);
    }

    if (!(localValue > 0)) {
      return this.recordError_(
        transaction,
        `a purchase requires a ${Transactions.localValueHeader} (the units times the price, in ${asset.currency})`
      );
    }

    const cost = isDerivative && asset.isShort ? amount - fees : amount + fees;
    const localCost = isForeignDerivative ? localValue : 0;
    const entryFees = isForeignDerivative ? fees : 0;
    const pool = this.getPool_(position, transaction.positionId);

    for (const holding of [pool, position]) {
      holding.quantity += quantity;
      holding.openCost += cost;
      holding.localOpenCost += localCost;
      holding.entryFees += entryFees;
    }

    return LedgerReplay.createEffect_({
      category: LedgerReplay.getTradeCategory_(isDerivative),
      quantityChange: quantity,
      gbpCashFlow: isDerivative ? -fees : -(amount + fees + accruedInterest),
      fees,
      accruedInterestPaid: accruedInterest
    });
  }

  applySale_(transaction, position, asset) {
    const figures = LedgerReplay.getTradeFigures_(transaction, asset);
    const { quantity: saleQuantity, amount, fees, accruedInterest, isDerivative } = figures;

    if (!(saleQuantity > 0) || !(amount > 0)) {
      return this.recordError_(transaction, `a sale requires a positive ${Transactions.quantityHeader} and ${Transactions.valueHeader}`);
    }

    const pool = this.getPool_(position, transaction.positionId);
    if (!Numbers.isPositive(pool.quantity) || Numbers.exceeds(saleQuantity, pool.quantity)) {
      const inPosition = transaction.positionId ? ` in position ${transaction.positionId}` : "";
      return this.recordError_(transaction, `sale quantity ${saleQuantity} exceeds the calculated holding of ${pool.quantity}${inPosition}`);
    }

    const costReleased = (pool.openCost * saleQuantity) / pool.quantity;
    const realisedPnl = this.calculateRealisedPnl_(transaction, asset, figures, {
      pool,
      position,
      costReleased
    });
    if (realisedPnl === null) return null;

    for (const holding of [pool, position]) {
      holding.quantity -= saleQuantity;
      holding.openCost -= costReleased;
    }

    LedgerReplay.closeIfEmpty_(pool);
    LedgerReplay.closeIfEmpty_(position);

    return LedgerReplay.createEffect_({
      category: LedgerReplay.getTradeCategory_(isDerivative),
      quantityChange: -saleQuantity,
      gbpCashFlow: isDerivative ? realisedPnl : amount - fees + accruedInterest,
      fees,
      costReleased,
      realisedPnl,
      accruedInterestPaid: -accruedInterest
    });
  }

  calculateRealisedPnl_(transaction, asset, figures, { pool, position, costReleased }) {
    const { quantity, amount, fees, localValue, isForeignDerivative } = figures;

    if (isForeignDerivative) {
      return this.calculateForeignDerivativeProfit_(transaction, asset, {
        pool,
        position,
        saleQuantity: quantity,
        localValue,
        fees
      });
    }

    return asset.isShort ? costReleased - amount - fees : amount - fees - costReleased;
  }

  applyStockSplit_(transaction, position) {
    const ratio = TransactionTypes.getSplitRatio(transaction.details);
    if (!ratio || !Numbers.isPositive(position.quantity)) {
      return this.recordError_(transaction, `a stock split requires a ratio such as 1:20 in ${Transactions.detailsHeader}, and units held to split`);
    }

    const quantityBefore = position.quantity;

    position.quantity *= ratio;

    for (const pool of position.pools.values()) {
      pool.quantity *= ratio;
    }

    return LedgerReplay.createEffect_({
      category: LedgerReplay.corporateActionCategory,
      quantityChange: position.quantity - quantityBefore
    });
  }

  applyManagementCharge_(transaction, position) {
    const units = Numbers.toNumber(transaction.quantity);
    const amount = Numbers.getAbsolute(transaction.value);
    if (!(units > 0) || !(amount > 0)) {
      return this.recordError_(
        transaction,
        `a management charge requires a positive ${Transactions.quantityHeader} (units) and ${Transactions.valueHeader}`
      );
    }

    const pool = this.getPool_(position, transaction.positionId);
    if (Numbers.exceeds(units, pool.quantity)) {
      return this.recordError_(transaction, `a management charge of ${units} units exceeds the calculated holding of ${pool.quantity}`);
    }

    for (const holding of [pool, position]) {
      holding.quantity -= units;
    }

    return LedgerReplay.createEffect_({
      category: LedgerReplay.managementChargeCategory,
      quantityChange: -units,
      managementCharge: amount
    });
  }

  applyIncome_(transaction, asset) {
    const amount = Numbers.getAbsolute(transaction.value);
    if (!(amount > 0)) {
      return this.recordError_(transaction, `${transaction.transactionType} requires a positive ${Transactions.valueHeader}`);
    }

    if (Numbers.getAbsolute(transaction.fees) > 0) {
      return this.recordError_(
        transaction,
        `${transaction.transactionType} must have no Fees (£): fees are the costs of buying and ` +
          "selling, so enter the amount received and leave the fee empty"
      );
    }

    return LedgerReplay.createEffect_({
      category: LedgerReplay.incomeCategory,
      gbpCashFlow: amount,
      income: amount,
      incomeDate: LedgerReplay.getIncomeDate_(transaction, asset)
    });
  }

  getPosition_(asset) {
    if (!this.positions.has(asset)) {
      this.positions.set(asset, {
        quantity: 0,
        openCost: 0,
        localOpenCost: 0,
        entryFees: 0,
        pools: new Map()
      });
    }

    return this.positions.get(asset);
  }

  getPool_(position, positionId) {
    const key = positionId || "";
    if (!position.pools.has(key)) {
      position.pools.set(key, { quantity: 0, openCost: 0, localOpenCost: 0, entryFees: 0 });
    }

    return position.pools.get(key);
  }

  recordError_(transaction, reason) {
    this.errors.push(`Transactions row ${transaction.sourceRow} (${transaction.asset}, ${transaction.transactionType}): ${reason}.`);
    return null;
  }

  static getIncomeDate_(transaction, asset) {
    const { exDate } = transaction;
    const isUsable = exDate instanceof Date && exDate <= transaction.date;
    return isUsable && !Assets.hasTerms(asset) ? exDate : transaction.date;
  }

  static getTradeCategory_(isDerivative) {
    return isDerivative ? LedgerReplay.derivativeTradeCategory : LedgerReplay.tradeCategory;
  }

  static getTradeFigures_(transaction, asset) {
    const isDerivative = Assets.isDerivative(asset);
    return {
      quantity: Numbers.toNumber(transaction.quantity),
      amount: Numbers.getAbsolute(transaction.value),
      fees: Numbers.getAbsolute(transaction.fees),
      accruedInterest: isDerivative ? 0 : Numbers.getAbsolute(transaction.accruedInterest),
      localValue: Numbers.getAbsolute(transaction.localValue),
      isDerivative,
      isForeignDerivative: isDerivative && Currencies.isForeign(asset.currency)
    };
  }

  static createEffect_({
    category,
    quantityChange = 0,
    gbpCashFlow = 0,
    income = 0,
    fees = 0,
    costReleased = 0,
    realisedPnl = 0,
    managementCharge = 0,
    accruedInterestPaid = 0,
    incomeDate = null
  }) {
    return {
      category,
      quantityChange,
      gbpCashFlow,
      income,
      fees,
      costReleased,
      realisedPnl,
      managementCharge,
      accruedInterestPaid,
      incomeDate
    };
  }

  static createEvent_(transaction, effect, position) {
    return {
      sourceRow: Numbers.toNumber(transaction.sourceRow),
      date: transaction.date,
      asset: String(transaction.asset || ""),
      transactionType: String(transaction.transactionType || ""),
      category: String(effect.category || ""),
      quantityChange: Numbers.toNumber(effect.quantityChange),
      gbpCashFlow: Numbers.toNumber(effect.gbpCashFlow),
      income: Numbers.toNumber(effect.income),
      fees: Numbers.toNumber(effect.fees),
      managementCharge: Numbers.toNumber(effect.managementCharge),
      accruedInterestPaid: Numbers.toNumber(effect.accruedInterestPaid),
      incomeDate: effect.incomeDate || transaction.date,
      costReleased: Numbers.toNumber(effect.costReleased),
      realisedPnl: Numbers.toNumber(effect.realisedPnl),
      closingQuantity: Numbers.toNumber(position.quantity),
      closingOpenCost: Numbers.toNumber(position.openCost),
      closingOpenCostLocal: Numbers.toNumber(position.localOpenCost)
    };
  }

  static closeIfEmpty_(position) {
    if (!Numbers.isHolding(position.quantity)) {
      position.quantity = 0;
      position.openCost = 0;
      position.localOpenCost = 0;
      position.entryFees = 0;
    }
  }
}
