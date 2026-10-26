class HoldingApportionment {
  static get shareNames() {
    return ["fees", "localCost", "poundCost", "income", "accruedInterestPaid"];
  }

  constructor(events, transactions) {
    this.events = events;

    this.transactions = new Map(transactions.map((transaction) => [transaction.sourceRow, transaction]));

    this.pools = new Map();
    this.sales = [];
    this.pending = HoldingApportionment.createEmptyShares_();
  }

  run() {
    for (const event of this.orderEvents_()) this.apportion_(event);

    return { sales: this.sales, remaining: this.getRemaining_() };
  }

  apportion_(event) {
    if (event.category === LedgerReplay.incomeCategory) this.apportionIncome_(event);
    else this.apportionTrade_(event);
  }

  orderEvents_() {
    const trades = this.events.filter((event) => event.category !== LedgerReplay.incomeCategory).sort(Dates.compareChronologically);

    const incomes = this.events
      .filter((event) => event.category === LedgerReplay.incomeCategory)
      .sort(
        (left, right) => HoldingApportionment.getIncomeDay_(left) - HoldingApportionment.getIncomeDay_(right) || left.sourceRow - right.sourceRow
      );

    const incomesBefore = trades.map(() => []);
    const afterAll = [];
    for (const income of incomes) {
      const index = HoldingApportionment.findTradeAfter_(trades, income);
      (index < 0 ? afterAll : incomesBefore[index]).push(income);
    }

    return [...trades.flatMap((trade, index) => [...incomesBefore[index], trade]), ...afterAll];
  }

  /** The first trade later than the income's day, or a sale or charge on it. */
  static findTradeAfter_(trades, income) {
    const day = HoldingApportionment.getIncomeDay_(income);

    return trades.findIndex((trade) => {
      const tradeDay = Dates.toDayKey(trade.date);
      return tradeDay > day || (tradeDay === day && trade.quantityChange < 0);
    });
  }

  apportionTrade_(event) {
    const change = event.quantityChange;
    const type = event.transactionType;

    if (TransactionTypes.purchaseTypes.includes(type)) {
      this.apportionPurchase_(event, change);
    } else if (TransactionTypes.saleTypes.includes(type)) {
      this.apportionSale_(event, change);
    } else if (type === TransactionTypes.managementCharge) {
      this.apportionCharge_(event, change);
    } else if (event.category === LedgerReplay.corporateActionCategory) {
      this.apportionSplit_(event, change);
    }
  }

  apportionPurchase_(event, change) {
    const transaction = this.findTransaction_(event);
    const pool = this.getOrCreatePool_(transaction.positionId);
    if (!Numbers.isHolding(pool.quantity)) {
      pool.openDate = event.date;
      HoldingApportionment.add_(pool, this.pending);
      this.pending = HoldingApportionment.createEmptyShares_();
    }

    pool.quantity += change;
    pool.fees += event.fees;
    pool.localCost += Numbers.getAbsolute(transaction.localValue);
    pool.poundCost += Numbers.getAbsolute(transaction.value);
    pool.accruedInterestPaid += Numbers.toNumber(event.accruedInterestPaid);
  }

  apportionSale_(event, change) {
    const transaction = this.findTransaction_(event);
    const pool = this.getOrCreatePool_(transaction.positionId);
    const quantity = Math.abs(change);
    const share = Numbers.isPositive(pool.quantity) ? Math.min(1, quantity / pool.quantity) : 1;
    const released = HoldingApportionment.createEmptyShares_();
    for (const name of HoldingApportionment.shareNames) {
      released[name] = pool[name] * share;
      pool[name] -= released[name];
    }

    const sale = {
      event,
      openDate: pool.openDate,
      quantity,
      localProceeds: Numbers.getAbsolute(transaction.localValue),
      ...released
    };

    pool.quantity -= quantity;
    if (!Numbers.isHolding(pool.quantity)) this.clearPool_(pool);
    this.sales.push(sale);
  }

  apportionCharge_(event, change) {
    const pool = this.getOrCreatePool_(this.findTransaction_(event).positionId);
    pool.quantity += change;
    pool.fees += Numbers.toNumber(event.managementCharge);
  }

  apportionSplit_(event, change) {
    const before = event.closingQuantity - change;
    if (!Numbers.isPositive(before) || change === 0) return;
    const ratio = event.closingQuantity / before;
    for (const pool of this.pools.values()) {
      pool.quantity *= ratio;
    }
  }

  apportionIncome_(event) {
    const holders = this.findHolders_(this.findTransaction_(event).positionId);
    const units = Numbers.sum(holders.map((pool) => pool.quantity));

    if (holders.length === 0) {
      const latestSale = this.sales[this.sales.length - 1];
      HoldingApportionment.add_(latestSale || this.pending, {
        income: event.income
      });
      return;
    }

    for (const pool of holders) {
      const share = pool.quantity / units;
      pool.income += event.income * share;
    }
  }

  findHolders_(positionId) {
    const held = [...this.pools.values()].filter((pool) => Numbers.isPositive(pool.quantity));
    const identified = positionId ? this.pools.get(positionId) : null;
    return identified && Numbers.isPositive(identified.quantity) ? [identified] : held;
  }

  getRemaining_() {
    const total = HoldingApportionment.createEmptyShares_();
    HoldingApportionment.add_(total, this.pending);
    for (const pool of this.pools.values()) {
      HoldingApportionment.add_(total, pool);
    }
    const { income, fees, accruedInterestPaid } = total;
    return { income, fees, accruedInterestPaid };
  }

  clearPool_(pool) {
    pool.quantity = 0;
    pool.openDate = null;
    for (const name of HoldingApportionment.shareNames) {
      pool[name] = 0;
    }
  }

  getOrCreatePool_(positionId) {
    const key = positionId || "";
    if (!this.pools.has(key)) {
      this.pools.set(key, {
        quantity: 0,
        openDate: null,
        ...HoldingApportionment.createEmptyShares_()
      });
    }

    return this.pools.get(key);
  }

  findTransaction_(event) {
    return this.transactions.get(event.sourceRow) || {};
  }

  static createEmptyShares_() {
    return Object.fromEntries(HoldingApportionment.shareNames.map((name) => [name, 0]));
  }

  static add_(target, shares) {
    for (const name of HoldingApportionment.shareNames) {
      target[name] += shares[name] || 0;
    }
  }

  static getIncomeDay_(event) {
    return Dates.toDayKey(event.incomeDate || event.date);
  }
}
