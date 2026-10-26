class PerformanceBuilder {
  constructor(valuations, years, soniaRates, cpiMonths, assetTypes) {
    this.valuations = valuations;
    this.years = years;
    this.soniaRates = soniaRates;
    this.cpiMonths = cpiMonths;
    this.assetTypes = assetTypes;
  }

  build() {
    this.typeReturns = this.calculateDailyReturnsByType_();
    this.assetDays = this.calculateDailyFiguresByAsset_();
    const byYear = Collections.groupBy(this.valuations, (valuation) => valuation.date.getFullYear());
    const byMonth = Collections.groupBy(this.valuations, (valuation) => Dates.toMonthKey(valuation.date.getFullYear(), valuation.date.getMonth()));
    return this.years.flatMap((year) => [
      this.buildYearRow_(year, byYear.get(year.year) || []),
      ...year.months.flatMap((month, index) =>
        month ? this.buildMonthRows_(year.year, index, month, byMonth.get(Dates.toMonthKey(year.year, index))) : []
      )
    ]);
  }

  buildYearRow_(year, valuations) {
    const trailingSharpeRatio = year.months
      .map((month) => month?.trailingSharpeRatio)
      .filter((ratio) => ratio !== null && ratio !== undefined)
      .pop();
    const trailingReturns = Object.fromEntries(
      PerformanceSummary.trailingReturnFields.map((field) => [
        field,
        year.months
          .map((month) => month?.[field])
          .filter((figure) => figure !== null && figure !== undefined)
          .pop()
      ])
    );

    return PerformanceBuilder.buildRow_(Performance.yearLevel, {
      label: year.year,
      value: year.annual.portfolioValue,
      ...PerformanceBuilder.sumFlows_(valuations),
      ...PerformanceBuilder.calculateMeasures_(year.annual),
      ...trailingReturns,
      trailingSharpeRatio
    });
  }

  buildMonthRows_(year, monthIndex, month, valuations = []) {
    const monthRow = PerformanceBuilder.buildRow_(Performance.monthLevel, {
      label: new Date(year, monthIndex, 1),
      value: month.portfolioValue,
      ...PerformanceBuilder.sumFlows_(valuations),
      ...PerformanceBuilder.calculateMeasures_(month),
      ...Object.fromEntries(PerformanceSummary.trailingReturnFields.map((field) => [field, month[field]])),
      trailingSharpeRatio: month.trailingSharpeRatio
    });
    const byType = Collections.groupBy(valuations, (valuation) => this.getType_(valuation));
    const sections = [...byType.keys()]
      .sort((left, right) => PerformanceBuilder.getTypeOrder_(left) - PerformanceBuilder.getTypeOrder_(right))
      .flatMap((type) => this.buildSectionRows_(type, byType.get(type)));
    return [monthRow, ...sections];
  }

  buildSectionRows_(type, valuations) {
    const byAsset = Collections.groupBy(valuations, (valuation) => valuation.asset);
    const assetRows = [...byAsset.keys()]
      .sort((left, right) => left.localeCompare(right))
      .map((asset) => this.buildAssetRow_(asset, byAsset.get(asset)));

    const days = PerformanceBuilder.getDates_(valuations);
    const typeReturns = this.typeReturns.get(type);
    const typeDays = days.map((day) => typeReturns?.get(Dates.toDayKey(day)));
    const hasReturns = typeDays.every((value) => value !== undefined);
    const valueColumn = Performance.columns.findIndex((column) => column.field === "value");
    const sectionRow = PerformanceBuilder.buildRow_(Performance.sectionLevel, {
      label: type,
      value: Numbers.sum(assetRows.map((row) => Numbers.toNumber(row.values[valueColumn]))),
      ...PerformanceBuilder.sumFlows_(valuations),
      ...PerformanceBuilder.calculateReturnFigures_(
        valuations,
        hasReturns ? typeDays.map((day) => day.dailyReturn) : null,
        hasReturns ? PortfolioReturnSeries.calculateSimpleReturn(typeDays, { isGroup: true }) : null,
        hasReturns ? PortfolioReturnSeries.calculateRealReturn(typeDays, this.cpiMonths, { isGroup: true }) : null
      )
    });

    return [sectionRow, ...assetRows];
  }

  getType_(valuation) {
    return this.assetTypes.get(valuation.asset) || AssetTypes.otherAssets;
  }

  static getTypeOrder_(type) {
    const place = AssetTypes.all.indexOf(type);
    return place < 0 ? AssetTypes.all.length : place;
  }

  static getDates_(valuations) {
    const byKey = new Map(valuations.map((valuation) => [Dates.toDayKey(valuation.date), valuation.date]));
    return [...byKey.values()].sort((left, right) => left - right);
  }

  calculateDailyReturnsByType_() {
    const byType = Collections.groupBy(this.valuations, (valuation) => this.getType_(valuation));
    return new Map(
      [...byType].map(([type, valuations]) => {
        const series = new PortfolioReturnSeries(valuations, this.soniaRates).run();
        const returns = series.errors.length > 0 ? [] : series.dailyReturns;
        return [type, new Map(returns.map((day) => [Dates.toDayKey(day.date), day]))];
      })
    );
  }

  /** Each asset's days over its whole history, as the opening value of a period it was already held in comes from before the period. */
  calculateDailyFiguresByAsset_() {
    const byAsset = Collections.groupBy(this.valuations, (valuation) => valuation.asset);
    return new Map(
      [...byAsset].map(([asset, valuations]) => {
        const days = new PortfolioReturnSeries(valuations, this.soniaRates).calculateDailyFigures();
        return [asset, new Map(days.map((day) => [Dates.toDayKey(day.date), day]))];
      })
    );
  }

  buildAssetRow_(asset, valuations) {
    const days = valuations.slice().sort((left, right) => left.date - right.date);
    const last = days[days.length - 1];
    const assetFigures = days.map((day) => this.assetDays.get(asset).get(Dates.toDayKey(day.date)));
    return PerformanceBuilder.buildRow_(Performance.assetLevel, {
      label: asset,
      quantity: last.closeQuantity,
      value: last.closeValue,
      ...PerformanceBuilder.sumFlows_(days),
      ...PerformanceBuilder.calculateReturnFigures_(
        days,
        days.map((day) => Numbers.toNumber(day.dailyReturn)),
        PortfolioReturnSeries.calculateSimpleReturn(assetFigures),
        PortfolioReturnSeries.calculateRealReturn(assetFigures, this.cpiMonths)
      )
    });
  }

  static calculateReturnFigures_(valuations, dailyReturns, simpleReturn, realReturn) {
    return {
      returnAmount: PerformanceBuilder.sum_(valuations, "returnAmount"),
      simpleReturn,
      realReturn,
      timeWeightedReturn: dailyReturns === null ? null : PerformanceSummary.linkReturns(dailyReturns)
    };
  }

  static calculateMeasures_(period) {
    return {
      returnAmount: period.periodReturnAmount,
      simpleReturn: period.periodSimpleReturn,
      realReturn: period.periodRealReturn,
      timeWeightedReturn: period.timeWeightedReturn,
      cpi: period.cpi,
      excessReturn: period.excessReturn,
      sonia: period.sonia,
      standardDeviation: period.standardDeviation
    };
  }

  static sumFlows_(valuations) {
    return {
      netCashFlow: PerformanceBuilder.sum_(valuations, "netCashFlow"),
      distributions: PerformanceBuilder.sum_(valuations, "distributions"),
      fees: PerformanceBuilder.sum_(valuations, "fees")
    };
  }

  static sum_(valuations, field) {
    return Numbers.sum(valuations.map((valuation) => Numbers.toNumber(valuation[field])));
  }

  static buildRow_(level, figures) {
    const fillBlank = (value) => (value === null || value === undefined ? "" : value);
    const excessReturn = Number.isFinite(figures.excessReturn)
      ? figures.excessReturn
      : Number.isFinite(figures.timeWeightedReturn) && Number.isFinite(figures.cpi)
        ? figures.timeWeightedReturn - figures.cpi
        : null;

    return {
      level,
      values: Performance.columns.map((column) => fillBlank(column.field === "excessReturn" ? excessReturn : figures[column.field]))
    };
  }
}
