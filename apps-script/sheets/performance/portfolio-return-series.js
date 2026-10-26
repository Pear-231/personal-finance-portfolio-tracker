class PortfolioReturnSeries {
  constructor(valuations, soniaRates) {
    this.valuations = valuations;
    this.soniaRates = soniaRates;
  }

  run() {
    const portfolioReturns = this.calculateDailyFigures();
    const problems = this.findProblems_(portfolioReturns);
    if (problems.length > 0) return { dailyReturns: [], errors: problems };

    const dailyReturns = portfolioReturns.map((portfolioReturn, index) => this.buildDailyReturn_(portfolioReturn, portfolioReturns[index - 1]));

    return { dailyReturns, errors: [] };
  }

  findProblems_(portfolioReturns) {
    const unmeasurable = this.findUnmeasurableProblem_(portfolioReturns);
    if (unmeasurable) return [unmeasurable];

    return portfolioReturns
      .filter(({ date }) => !Sonia.findRateOnOrBefore(this.soniaRates, date))
      .map(({ date }) => `No SONIA rate is available on or before ${Dates.formatDisplay(date)}.`);
  }

  buildDailyReturn_(portfolioReturn, previous) {
    const { date, dailyReturn } = portfolioReturn;
    const sonia = Sonia.findRateOnOrBefore(this.soniaRates, date);
    const dayCount = previous ? Math.max(1, Dates.countDaysBetween(previous.date, date)) : 0;
    const riskFreeReturn = PortfolioReturnSeries.calculateRiskFreeReturn_(sonia.annualRate, dayCount);

    return {
      ...portfolioReturn,
      date: Dates.getStartOfDay(date),
      riskFreeReturn
    };
  }

  findUnmeasurableProblem_(portfolioReturns) {
    if (portfolioReturns.length < 2) {
      return "Portfolio Data must hold at least two days of valuations to measure a return: run Record Portfolio Data on another day.";
    }

    if (this.soniaRates.length === 0) {
      return "FRED returned no SONIA rates for the Portfolio Data period.";
    }

    return null;
  }

  static calculateRiskFreeReturn_(annualRate, dayCount) {
    const dailyRate = Numbers.fromPercent(annualRate) / Sonia.daysInYear;
    return Math.pow(1 + dailyRate, dayCount) - 1;
  }

  calculateDailyFigures() {
    const valuationsByDay = Collections.groupBy(this.valuations, (valuation) => Dates.toDayKey(valuation.date));

    const openBalances = { values: new Map(), margins: new Map() };
    return [...valuationsByDay.keys()]
      .sort((left, right) => left - right)
      .map((day) => PortfolioReturnSeries.calculateDay_(valuationsByDay.get(day), openBalances));
  }

  /** The return of the day over what the portfolio held at its start, plus the capital added. */
  static calculateDay_(valuations, { values: openValues, margins: openMargins }) {
    const { capitalAdded, netFlow } = PortfolioReturnSeries.measureFlows_(valuations, openMargins);

    const sumOf = (amounts) => Numbers.sum([...amounts.values()]);
    const openingBase = sumOf(openValues) + sumOf(openMargins) + capitalAdded;

    for (const valuation of valuations) {
      openValues.set(valuation.asset, valuation.closeValue);
      openMargins.set(valuation.asset, Numbers.toNumber(valuation.margin));
    }

    const returnAmount = Numbers.sum(valuations.map((valuation) => valuation.returnAmount));

    return {
      date: valuations[0].date,
      returnAmount,
      openingBase,
      capitalAdded,
      netFlow,
      fees: Numbers.sum(valuations.map((valuation) => Numbers.toNumber(valuation.fees))),
      dailyReturn: Numbers.isPositive(openingBase) ? returnAmount / openingBase : 0
    };
  }

  /**
   * The return of a run of days over its cost basis, as Portfolio does, so the money's timing does not matter (the time-weighted return is the
   * measure that allows for it). An asset's cost basis is what it opened with and every purchase and fee after it, and a sale never reduces it. A
   * group of assets is netted, so money moved between its assets is not counted twice: what it opened with, plus the net money added if there was
   * any, plus fees. Null if there was no cost basis.
   */
  static calculateSimpleReturn(days, { isGroup = false } = {}) {
    const capital = PortfolioReturnSeries.calculateCapital_(days, isGroup);
    return Numbers.isPositive(capital) ? Numbers.sum(days.map((day) => Numbers.toNumber(day.returnAmount))) / capital : null;
  }

  /** The simple return less the inflation on what was held each day, so an asset is charged only for the time it was held. */
  static calculateRealReturn(days, cpiMonths, { isGroup = false } = {}) {
    const inflationByMonth = new Map();
    const findInflation = ({ date }) => {
      const key = Dates.toMonthKey(date.getFullYear(), date.getMonth());
      if (!inflationByMonth.has(key)) inflationByMonth.set(key, Cpi.calculateDailyInflation(cpiMonths, date));
      return inflationByMonth.get(key);
    };

    const measured = days.filter((day) => findInflation(day) !== null);
    if (measured.length === 0) return null;

    const capital = PortfolioReturnSeries.calculateCapital_(measured, isGroup);
    if (!Numbers.isPositive(capital)) return null;

    const returnAmount = Numbers.sum(measured.map((day) => Numbers.toNumber(day.returnAmount)));
    const inflationLoss = Numbers.sum(measured.map((day) => day.openingBase * findInflation(day)));
    return (returnAmount - inflationLoss) / capital;
  }

  static calculateCapital_(days, isGroup) {
    const [first, ...later] = days;
    const fees = Numbers.sum(days.map((day) => day.fees));
    if (!isGroup) return first.openingBase + Numbers.sum(later.map((day) => day.capitalAdded)) + fees;

    const netFlow = Numbers.sum(days.map((day) => day.netFlow));
    return first.openingBase - first.capitalAdded + Math.max(netFlow, 0) + fees;
  }

  /**
   * The money added on a day is netted across the assets, as money moved from one to another is not capital added. A net outflow is taken at the end
   * of the day, so it adds nothing to the base. A margin is capital added on the day it is first posted. The net flow keeps the sign.
   */
  static measureFlows_(valuations, openMargins) {
    let margins = 0;
    let netCashFlow = 0;

    for (const valuation of valuations) {
      const openMargin = openMargins.get(valuation.asset);
      const margin = Numbers.toNumber(valuation.margin);

      if (Numbers.isPositive(openMargin) || Numbers.isPositive(margin)) {
        if (!Numbers.isPositive(openMargin)) margins += margin;
      } else {
        netCashFlow += Numbers.toNumber(valuation.netCashFlow);
      }
    }

    return { capitalAdded: margins + Math.max(netCashFlow, 0), netFlow: margins + netCashFlow };
  }
}
