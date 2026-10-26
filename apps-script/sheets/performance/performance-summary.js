class PerformanceSummary {
  static get minimumStandardDeviation() {
    return 0.000000000001;
  }

  static get trailingPeriods() {
    return [
      { years: 1, amountField: "oneYearReturnAmount", returnField: "oneYearReturn" },
      { years: 3, amountField: "threeYearReturnAmount", returnField: "threeYearReturn" },
      { years: 5, amountField: "fiveYearReturnAmount", returnField: "fiveYearReturn" }
    ];
  }

  static get trailingReturnFields() {
    return PerformanceSummary.trailingPeriods.flatMap(({ amountField, returnField }) => [amountField, returnField]);
  }

  constructor(dailyReturns, valuations, soniaRates, cpiMonths) {
    this.dailyReturns = dailyReturns;
    this.valuations = valuations;
    this.soniaRates = soniaRates;
    this.cpiMonths = cpiMonths;
  }

  build() {
    const valuesByDate = this.sumClosingValuesByDate_();
    const { observationsByYear, observationsByMonth } = this.groupByYearAndMonth_();

    const years = this.summariseYears_(observationsByYear, valuesByDate);
    this.summariseMonths_(years, observationsByMonth, valuesByDate);
    this.addCurrentYearBenchmark_(years);
    this.addTrailingSharpeRatios_(years);
    this.addTrailingReturns_(years);
    this.addYearlyRiskMeasures_(years);

    return [...years.values()];
  }

  /** SONIA accrues over the days measured, the first included: from the day before it. */
  findLimits_() {
    const firstDate = this.dailyReturns[0].date;
    return {
      firstDate,
      lastDate: this.dailyReturns[this.dailyReturns.length - 1].date,
      periodStart: Dates.addDays(firstDate, -1)
    };
  }

  summariseYears_(observationsByYear, valuesByDate) {
    const { firstDate, lastDate, periodStart } = this.findLimits_();
    const years = new Map();

    for (const year of [...observationsByYear.keys()].sort((left, right) => left - right)) {
      const yearEnd = new Date(year, Dates.lastMonthIndex, 31);
      years.set(year, {
        year,
        months: Array(Dates.monthsInYear).fill(null),
        annual: this.adjustForRisk_(
          this.summarisePeriod_(observationsByYear.get(year), valuesByDate),
          year === firstDate.getFullYear() ? periodStart : new Date(year - 1, Dates.lastMonthIndex, 31),
          PerformanceSummary.findEarlier_(lastDate, yearEnd)
        )
      });
    }

    return years;
  }

  addCurrentYearBenchmark_(years) {
    const currentYear = this.findLimits_().lastDate.getFullYear();
    const year = years.get(currentYear);
    if (!year) return;

    const reportedMonths = year.months.filter((month) => month && Number.isFinite(month.timeWeightedReturn) && Number.isFinite(month.cpi));
    if (reportedMonths.length === 0) return;

    const timeWeightedReturn = PerformanceSummary.linkReturns(reportedMonths.map((month) => month.timeWeightedReturn));
    const cpi = PerformanceSummary.linkReturns(reportedMonths.map((month) => month.cpi));

    year.annual.timeWeightedReturn = timeWeightedReturn;
    year.annual.cpi = cpi;
    year.annual.excessReturn = timeWeightedReturn - cpi;
  }

  summariseMonths_(years, observationsByMonth, valuesByDate) {
    const { firstDate, lastDate, periodStart } = this.findLimits_();

    for (const [monthKey, observations] of observationsByMonth) {
      const year = Math.floor(monthKey / Dates.monthsInYear);
      const month = monthKey % Dates.monthsInYear;
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);

      years.get(year).months[month] = {
        ...this.adjustForRisk_(
          this.summarisePeriod_(observations, valuesByDate),
          firstDate >= monthStart ? periodStart : new Date(year, month, 0),
          PerformanceSummary.findEarlier_(lastDate, monthEnd)
        ),
        isComplete: firstDate < monthStart && lastDate >= monthEnd
      };
    }
  }

  static findEarlier_(left, right) {
    return left < right ? left : right;
  }

  groupByYearAndMonth_() {
    const observations = this.buildObservations_();

    return {
      observationsByYear: Collections.groupBy(observations, ({ date }) => date.getFullYear()),
      observationsByMonth: Collections.groupBy(observations, ({ date }) => Dates.toMonthKey(date.getFullYear(), date.getMonth()))
    };
  }

  buildObservations_() {
    return this.dailyReturns.map(
      ({ date, returnAmount, openingBase, capitalAdded, netFlow, fees, dailyReturn, riskFreeReturn }, index) => ({
        date,
        returnAmount: Numbers.toNumber(returnAmount),
        openingBase,
        capitalAdded,
        netFlow,
        fees,
        dailyReturn,
        riskFreeReturn,
        dayCount: index === 0 ? 1 : Math.max(1, Dates.countDaysBetween(this.dailyReturns[index - 1].date, date))
      })
    );
  }

  summarisePeriod_(observations, valuesByDate) {
    const spanDays = Numbers.sum(observations.map((observation) => observation.dayCount));
    const lastDate = observations[observations.length - 1].date;
    const portfolioValue = valuesByDate.get(Dates.toDayKey(lastDate));

    const periodReturnAmount = Numbers.sum(observations.map((observation) => observation.returnAmount));

    const timeWeightedReturn = PerformanceSummary.linkReturns(observations.map((observation) => observation.dailyReturn));

    return {
      periodReturnAmount,
      periodSimpleReturn: PortfolioReturnSeries.calculateSimpleReturn(observations, { isGroup: true }),
      periodRealReturn: PortfolioReturnSeries.calculateRealReturn(observations, this.cpiMonths, { isGroup: true }),
      timeWeightedReturn,
      portfolioValue: portfolioValue === undefined ? null : portfolioValue,
      sonia:
        Math.pow(1 + PerformanceSummary.linkReturns(observations.map((observation) => observation.riskFreeReturn)), Sonia.daysInYear / spanDays) - 1,
      standardDeviation: null
    };
  }

  static calculateMonthlySharpe_(excessReturns) {
    const deviation = PerformanceSummary.calculateStandardDeviation(excessReturns);
    if (!(deviation >= PerformanceSummary.minimumStandardDeviation)) return null;
    return (PerformanceSummary.calculateMean(excessReturns) / deviation) * Math.sqrt(Dates.monthsInYear);
  }

  addYearlyRiskMeasures_(years) {
    for (const year of years.values()) {
      const months = year.months.filter((month) => month && month.isComplete);
      if (months.length < Dates.monthsInYear) continue;

      const deviation = PerformanceSummary.calculateStandardDeviation(months.map((month) => month.timeWeightedReturn));

      year.annual.standardDeviation = deviation * Math.sqrt(Dates.monthsInYear);
    }
  }

  addTrailingSharpeRatios_(years) {
    const monthsByKey = PerformanceSummary.indexMonthsByKey_(years);

    for (const [key, month] of monthsByKey) {
      const window = Array.from({ length: Dates.monthsInYear }, (_, offset) => monthsByKey.get(key - offset));
      const isComplete = window.every((candidate) => candidate && candidate.isComplete);

      month.trailingSharpeRatio = isComplete
        ? PerformanceSummary.calculateMonthlySharpe_(window.map((candidate) => candidate.timeWeightedReturn - candidate.sonia))
        : null;
    }
  }

  /**
   * The return in pounds and the time-weighted return over the last 1, 3 and 5 years of complete months, ending at each month. A period over a year is
   * annualised.
   */
  addTrailingReturns_(years) {
    const monthsByKey = PerformanceSummary.indexMonthsByKey_(years);

    for (const [key, month] of monthsByKey) {
      for (const { years: periodYears, amountField, returnField } of PerformanceSummary.trailingPeriods) {
        const window = Array.from({ length: periodYears * Dates.monthsInYear }, (_, offset) => monthsByKey.get(key - offset));
        const isComplete = window.every((candidate) => candidate && candidate.isComplete);

        month[amountField] = isComplete ? Numbers.sum(window.map((candidate) => candidate.periodReturnAmount)) : null;
        month[returnField] = isComplete
          ? Math.pow(1 + PerformanceSummary.linkReturns(window.map((candidate) => candidate.timeWeightedReturn)), 1 / periodYears) - 1
          : null;
      }
    }
  }

  static indexMonthsByKey_(years) {
    return new Map(
      [...years.values()].flatMap((year) =>
        year.months.map((month, index) => [Dates.toMonthKey(year.year, index), month]).filter(([, month]) => month)
      )
    );
  }

  adjustForRisk_(period, startLimit, endLimit) {
    return {
      ...period,
      cpi: Cpi.calculateInflationBetween(this.cpiMonths, startLimit, endLimit),
      sonia: Sonia.calculateCompoundedRate(this.soniaRates, startLimit, endLimit)
    };
  }

  sumClosingValuesByDate_() {
    const valuationsByDay = Collections.groupBy(this.valuations, (valuation) => Dates.toDayKey(valuation.date));

    const latestValues = new Map();
    const valuesByDate = new Map();
    for (const day of [...valuationsByDay.keys()].sort((left, right) => left - right)) {
      PerformanceSummary.updateLatestValues_(latestValues, valuationsByDay.get(day));
      valuesByDate.set(day, Numbers.sum([...latestValues.values()]));
    }

    return valuesByDate;
  }

  static updateLatestValues_(latestValues, valuations) {
    for (const valuation of valuations) latestValues.set(valuation.asset, valuation.closeValue);
  }

  static linkReturns(returns) {
    return returns.reduce((total, value) => total * (1 + value), 1) - 1;
  }

  static calculateMean(values) {
    return Numbers.sum(values) / values.length;
  }

  static calculateStandardDeviation(values) {
    const mean = PerformanceSummary.calculateMean(values);
    return Math.sqrt(values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / (values.length - 1));
  }
}
