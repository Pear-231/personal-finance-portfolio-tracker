class PortfolioReportBuilder {
  constructor(ledgerRows, assets, observations, transactions) {
    this.holdings = new HoldingSnapshots(ledgerRows, assets, observations, transactions);
  }

  build(labels, mode) {
    const isRealised = mode === Portfolio.realisedMode;

    const rows = labels.map((label) => [label]);

    const layout = this.findLayout_(labels);
    const snapshots = this.getSnapshots_(mode);
    const groups = this.writeSections_(rows, layout.headings, snapshots, rows.length + 1, isRealised);

    const { assets, assetsExcludingPension, assetsInMarket, cash } = layout.summary;
    this.writeSummary_(rows, assets, Portfolio.assetsLabel, snapshots, isRealised);

    this.writeSummary_(
      rows,
      assetsExcludingPension,
      Portfolio.assetsExcludingPensionLabel,
      snapshots.filter((snapshot) => snapshot.assetType !== AssetTypes.pension),
      isRealised
    );

    this.writeSummary_(
      rows,
      assetsInMarket,
      Portfolio.assetsInMarketLabel,
      snapshots.filter((snapshot) => !AssetTypes.notInMarket.includes(snapshot.assetType)),
      isRealised
    );

    this.writeSummary_(
      rows,
      cash,
      AssetTypes.cash,
      snapshots.filter((snapshot) => snapshot.assetType === AssetTypes.cash),
      isRealised
    );

    return { rows, groups };
  }

  countRequiredRowsByType(mode) {
    return this.getSnapshots_(mode).reduce((counts, snapshot) => {
      counts.set(snapshot.assetType, (counts.get(snapshot.assetType) || 0) + 1);
      return counts;
    }, new Map());
  }

  getSnapshots_(mode) {
    if (mode === Portfolio.realisedMode) return this.holdings.snapshotSales();
    return this.holdings.snapshotCurrentHoldings().filter((snapshot) => Numbers.isHolding(snapshot.quantity));
  }

  findLayout_(labels) {
    const findRow = (label) => labels.findIndex((value) => value === label);
    const headings = new Map();
    for (const type of AssetTypes.all) {
      headings.set(type, findRow(type));
    }

    const isMissing = ([type, row]) => row < 0 && !Portfolio.optionalAssetTypes.includes(type);
    const missing = [...headings].filter(isMissing).map(([type]) => type);
    if (missing.length > 0) {
      throw new Error(
        `The Portfolio layout has no heading for ${missing.join(", ")}, which every Portfolio ` +
          "needs. This is a fault in the script, not in your sheets: see the log."
      );
    }

    return {
      headings,
      summary: {
        assets: findRow(Portfolio.assetsLabel),
        assetsExcludingPension: findRow(Portfolio.assetsExcludingPensionLabel),
        assetsInMarket: findRow(Portfolio.assetsInMarketLabel),
        cash: findRow(AssetTypes.cash)
      }
    };
  }

  writeSections_(rows, headings, snapshots, sectionEnd, isRealised) {
    const context = { headings, snapshots, sectionEnd, isRealised };

    return AssetTypes.all.flatMap((type) => this.writeSection_(rows, type, context));
  }

  writeSection_(rows, type, { headings, snapshots, sectionEnd, isRealised }) {
    const heading = headings.get(type);
    const holdings = PortfolioReportBuilder.sortHoldings_(snapshots.filter((snapshot) => snapshot.assetType === type));

    if (heading < 0) PortfolioReportBuilder.checkHeadingNeeded_(type, holdings);
    if (heading < 0) return [];

    const availableRows = PortfolioReportBuilder.countRowsBelow_(heading, headings, sectionEnd);
    if (holdings.length > availableRows) {
      throw new Error(
        `The Portfolio layout leaves ${availableRows} rows for ${type}, which has ${holdings.length} ` +
          "holdings. This is a fault in the script, not in your sheets: see the log."
      );
    }

    const holdingRows = holdings.map((holding) => PortfolioReportBuilder.buildHoldingRow_(holding, isRealised));
    rows.splice(heading + 1, holdings.length, ...holdingRows);

    return holdings.length > 0 ? [{ index: heading + 1, count: holdings.length }] : [];
  }

  static sortHoldings_(snapshots) {
    return snapshots.sort(
      (left, right) => left.openDate - right.openDate || left.asset.localeCompare(right.asset) || left.closeDate - right.closeDate
    );
  }

  static checkHeadingNeeded_(type, holdings) {
    if (holdings.length === 0) return;

    throw new Error(
      `The Portfolio layout has no "${type}" heading, but ${type} holdings need one. This is a ` +
        "fault in the script, not in your sheets: see the log."
    );
  }

  static countRowsBelow_(heading, headings, sectionEnd) {
    return PortfolioReportBuilder.findNextHeading_(heading, headings.values(), sectionEnd) - heading - 1;
  }

  writeSummary_(rows, row, label, snapshots, isRealised) {
    if (row < 0) {
      throw new Error(`The Portfolio layout has no "${label}" row. This is a fault in the script, not in your sheets: see the log.`);
    }

    const total = PortfolioReportBuilder.sumTotals_(snapshots);
    rows[row] = PortfolioReportBuilder.buildSummaryRow_(rows[row][0], total, isRealised);
  }

  static buildHoldingRow_(snapshot, isRealised) {
    const isClosed = snapshot.quantity === 0;

    if (isRealised) {
      const closeValue = snapshot.costBasis + snapshot.realisedPnl;
      return [
        snapshot.asset,
        snapshot.openDate,
        snapshot.closeDate,
        snapshot.quantity,
        snapshot.currency,
        snapshot.localAverageCost,
        ...PortfolioReportBuilder.buildFigures_(snapshot, closeValue)
      ];
    }

    return [
      snapshot.asset,
      snapshot.openDate,
      snapshot.quantity,
      snapshot.currency,
      isClosed ? "" : snapshot.price,
      isClosed ? "" : snapshot.localAverageCost,
      ...PortfolioReportBuilder.buildFigures_(snapshot, isClosed ? 0 : snapshot.value)
    ];
  }

  static buildSummaryRow_(label, total, isRealised) {
    return [label, "", "", "", "", "", ...PortfolioReportBuilder.buildFigures_(total, isRealised ? 0 : total.value, { includePercentages: !isRealised })];
  }

  static buildFigures_(figures, value, { includePercentages = true } = {}) {
    const calculatePercentageOfCost = (amount) => {
      if (!includePercentages) return "";
      return figures.costBasis === 0 ? 0 : amount / figures.costBasis;
    };

    return [
      figures.fees,
      figures.income,
      figures.costBasis,
      value,
      figures.totalReturn,
      calculatePercentageOfCost(figures.totalReturn),
      figures.assetReturn,
      calculatePercentageOfCost(figures.assetReturn),
      figures.currencyEffect,
      calculatePercentageOfCost(figures.currencyEffect)
    ];
  }

  static sumTotals_(snapshots) {
    return snapshots.reduce(
      (total, snapshot) => ({
        fees: total.fees + snapshot.fees,
        costBasis: total.costBasis + snapshot.costBasis,
        value: total.value + snapshot.value,
        totalReturn: total.totalReturn + snapshot.totalReturn,
        assetReturn: total.assetReturn + snapshot.assetReturn,
        currencyEffect: total.currencyEffect + snapshot.currencyEffect,
        income: total.income + snapshot.income
      }),
      {
        fees: 0,
        costBasis: 0,
        value: 0,
        totalReturn: 0,
        assetReturn: 0,
        currencyEffect: 0,
        income: 0
      }
    );
  }

  static buildFormulae(labels, { firstRow, columns, includeRecentReturns = true, includePercentages = true }) {
    const assetTypes = AssetTypes.all.filter((type) => labels.includes(type));
    const findRow = (label) => PortfolioReportBuilder.findLabelRow_(labels, label, firstRow);
    const headingRows = new Map(assetTypes.map((type) => [type, findRow(type)]));

    const categories = assetTypes.map((type) => {
      const heading = headingRows.get(type);
      const nextHeading = PortfolioReportBuilder.findNextHeading_(heading, headingRows.values(), labels.length + firstRow);

      return {
        row: heading,
        formulas: PortfolioReportBuilder.buildSummaryFormulas_(PortfolioReportBuilder.buildSectionTotal_(heading, nextHeading), heading, columns, {
          includeRecentReturns,
          includePercentages
        })
      };
    });

    const totalOfHeadings = (types, summaryRow) => {
      const rows = types.map((type) => headingRows.get(type));
      const totalOf = (column) => `=SUM(${rows.map((row) => `${column}${row}`).join(",")})`;
      return {
        row: summaryRow,
        formulas: PortfolioReportBuilder.buildSummaryFormulas_(totalOf, summaryRow, columns, { includeRecentReturns, includePercentages })
      };
    };

    return [
      ...categories,
      totalOfHeadings(assetTypes, findRow(Portfolio.assetsLabel)),
      totalOfHeadings(
        assetTypes.filter((type) => type !== AssetTypes.pension),
        findRow(Portfolio.assetsExcludingPensionLabel)
      ),
      totalOfHeadings(
        assetTypes.filter((type) => !AssetTypes.notInMarket.includes(type)),
        findRow(Portfolio.assetsInMarketLabel)
      )
    ];
  }

  static findLabelRow_(labels, label, firstRow) {
    const index = labels.indexOf(label);
    if (index < 0) {
      throw new Error(`The Portfolio layout has no "${label}" row. This is a fault in the script, not in your sheets: see the log.`);
    }

    return index + firstRow;
  }

  static findNextHeading_(heading, headingRows, sectionEnd) {
    return [...headingRows].filter((row) => row > heading).sort((left, right) => left - right)[0] || sectionEnd;
  }

  /** A heading with no row beneath it totals nothing: a range ending above its start is an error. */
  static buildSectionTotal_(heading, nextHeading) {
    const isEmpty = nextHeading - heading < 2;
    return (column) => (isEmpty ? "=0" : `=SUM(${column}${heading + 1}:${column}${nextHeading - 1})`);
  }

  static sumRows(rows, summaryRow, columns, options) {
    const totalOf = (column) => `=SUM(${rows.map((row) => `${column}${row}`).join(",")})`;
    return PortfolioReportBuilder.buildSummaryFormulas_(totalOf, summaryRow, columns, options);
  }

  static buildSummaryFormulas_(totalOf, summaryRow, columns, { includeRecentReturns = true, includePercentages = true } = {}) {
    const { fees, costBasis, value, totalReturn, oneDayReturn, oneMonthReturn, threeMonthReturn, assetReturn, currencyEffect, distributions } =
      columns;
    const buildPercentageOfCost = (column) => (includePercentages ? `=IFERROR(${column}${summaryRow}/${costBasis}${summaryRow},0)` : "");
    const recentReturns = includeRecentReturns
      ? [
          totalOf(oneDayReturn),
          buildPercentageOfCost(oneDayReturn),
          totalOf(oneMonthReturn),
          buildPercentageOfCost(oneMonthReturn),
          totalOf(threeMonthReturn),
          buildPercentageOfCost(threeMonthReturn)
        ]
      : ["", "", "", "", "", ""];

    return [
      totalOf(fees),
      totalOf(distributions),
      totalOf(costBasis),
      totalOf(value),
      totalOf(totalReturn),
      buildPercentageOfCost(totalReturn),
      totalOf(assetReturn),
      buildPercentageOfCost(assetReturn),
      totalOf(currencyEffect),
      buildPercentageOfCost(currencyEffect),
      ...recentReturns
    ];
  }
}
