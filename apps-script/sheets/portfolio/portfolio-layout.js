class PortfolioLayout {
  constructor(builder, assets, assetColumns) {
    this.builder = builder;
    this.assets = assets;
    this.assetColumns = assetColumns;
  }

  build() {
    const layout = { rows: [], groups: [], formulas: [], summaries: [], expectations: [] };
    const summaryRows = Portfolio.modes.map((mode) => this.addHalf_(layout, mode));

    this.addAllAssets_(layout.rows, layout.groups, layout.summaries, summaryRows);
    return layout;
  }

  addHalf_(layout, mode) {
    const half = this.buildHalf_(mode);
    const start = layout.rows.length;
    const isCollapsed = mode === Portfolio.realisedMode;

    layout.groups.push(
      { index: start + 1, count: half.rows.length - 1, isCollapsed },
      ...half.groups.map((group) => ({
        index: start + group.index,
        count: group.count,
        isCollapsed
      }))
    );

    layout.summaries.push(
      ...PortfolioReportBuilder.buildFormulae(
        half.rows.map((row) => row[0]),
        {
          firstRow: start + 2,
          columns: Portfolio.totalColumns,
          includeRecentReturns: mode === Portfolio.currentMode,
          includePercentages: mode === Portfolio.currentMode
        }
      )
    );

    const { formulas, expectations } = this.buildHoldingFormulas_(half.rows, start, mode);
    layout.formulas.push(...formulas);
    layout.expectations.push(...expectations);
    layout.rows.push(...half.rows.map((row) => PortfolioLayout.relabel_(row, isCollapsed)));

    return [start + 2, start + 3, start + 4];
  }

  buildHoldingFormulas_(halfRows, start, mode) {
    const isCurrent = mode === Portfolio.currentMode;
    const heldRowCounts = PortfolioLayout.countHeldRows_(halfRows, (row) => this.isHolding_(row));
    const formulas = [];
    const expectations = [];

    for (let index = 0; index < halfRows.length; index += 1) {
      const row = halfRows[index];
      if (!this.isHolding_(row)) continue;

      const built = this.buildRowFormulas_(row, start + index + 2, {
        isCurrent,
        isOnlyRowOfAsset: heldRowCounts.get(row[0]) === 1
      });
      formulas.push(...built.formulas);
      expectations.push(...built.expectations);
    }

    return { formulas, expectations };
  }

  buildRowFormulas_(row, sheetRow, { isCurrent, isOnlyRowOfAsset }) {
    const formulas = [this.buildAssetLookup_(sheetRow, Portfolio.currencyHeader, "currency")];
    if (isCurrent) formulas.push(...this.buildCurrentLookups_(sheetRow, isOnlyRowOfAsset));

    const live = isCurrent ? this.buildLiveFormulas_(row, sheetRow) : null;
    if (!live) {
      return {
        formulas: [...formulas, ...PortfolioLayout.buildDerivedFormulas_(sheetRow)],
        expectations: []
      };
    }

    return {
      formulas: [...formulas, ...live],
      expectations: [PortfolioLayout.buildExpectation_(row, sheetRow)]
    };
  }

  /** An asset held in several positions has a row for each, so its total is not a row's. */
  buildCurrentLookups_(sheetRow, isOnlyRowOfAsset) {
    const formulas = [this.buildAssetLookup_(sheetRow, Portfolio.valuationDateHeader, "valuationDate")];

    if (isOnlyRowOfAsset) {
      formulas.push(this.buildAssetLookup_(sheetRow, Portfolio.quantityHeader, "quantity"));
    }

    formulas.push(PortfolioLayout.buildRecentReturnFormulas_(sheetRow));
    return formulas;
  }

  static buildExpectation_(row, sheetRow) {
    const figure = (header) => row[Portfolio.getIndex(header)];

    return {
      row: sheetRow,
      asset: row[0],
      value: figure(Portfolio.valueHeader),
      totalReturn: figure(Portfolio.returnHeader),
      assetReturn: figure(Portfolio.assetReturnHeader),
      currencyEffect: figure(Portfolio.currencyEffectHeader)
    };
  }

  buildHalf_(mode) {
    const isRealised = mode === Portfolio.realisedMode;
    const required = this.builder.countRequiredRowsByType(mode);
    const labels = [
      Portfolio.assetsLabel,
      Portfolio.assetsExcludingPensionLabel,
      Portfolio.assetsInMarketLabel,
      ...AssetTypes.all.flatMap((type) => {
        if (Portfolio.optionalAssetTypes.includes(type) && !required.get(type)) return [];
        return [type, ...Array(required.get(type) || 0).fill("")];
      })
    ];

    const built = this.builder.build(labels, mode);
    const isEmptyHeading = (row) => AssetTypes.all.includes(row[0]) && !required.get(row[0]);
    const removed = built.rows.map((row, index) => (isEmptyHeading(row) ? index : -1));
    const countRemovedBefore = (index) => removed.filter((at) => at >= 0 && at < index).length;
    return {
      rows: built.rows.filter((row) => !isEmptyHeading(row)).map((row) => PortfolioLayout.spreadOverColumns_(row, isRealised)),
      groups: built.groups.map((group) => ({
        ...group,
        index: group.index - countRemovedBefore(group.index)
      }))
    };
  }

  static spreadOverColumns_(row, isRealised) {
    const identity = isRealised
      ? (([asset, openDate, closeDate, quantity, currency, averageCost, ...figures]) => ({
          cells: [asset, quantity, currency, "", averageCost, openDate, closeDate, ""],
          figures
        }))(row)
      : (([asset, openDate, quantity, currency, unitValue, averageCost, ...figures]) => ({
          cells: [asset, quantity, currency, unitValue, averageCost, openDate, "", ""],
          figures
        }))(row);
    const cells = [...identity.cells, ...identity.figures];

    // A heading row holds only its label, and a sheet range must be as wide as every row in it.
    return Array.from({ length: Portfolio.headers.length }, (_, index) => cells[index] ?? "");
  }

  static countHeldRows_(rows, isHolding) {
    const counts = new Map();
    for (const row of rows.filter(isHolding)) {
      counts.set(row[0], (counts.get(row[0]) || 0) + 1);
    }
    return counts;
  }

  static relabel_(row, isRealised) {
    const place = Portfolio.heldSummaryLabels.indexOf(row[0]);
    if (!isRealised || place < 0) return row;
    return [Portfolio.realisedSummaryLabels[place], ...row.slice(1)];
  }

  addAllAssets_(rows, groups, summaries, summaryRows) {
    const labels = Portfolio.allSummaryLabels;
    const start = rows.length;
    groups.push({ index: start + 1, count: 2, isCollapsed: true });
    for (let offset = 0; offset < labels.length; offset += 1) {
      const label = labels[offset];
      rows.push([label, ...Array(Portfolio.headers.length - 1).fill("")]);
      summaries.push({
        row: start + 2 + offset,
        formulas: PortfolioReportBuilder.sumRows(
          summaryRows.map((half) => half[offset]),
          start + 2 + offset,
          Portfolio.totalColumns,
          { includeRecentReturns: false, includePercentages: false }
        )
      });
    }
  }

  isHolding_(row) {
    return this.assets.has(row[0]) && !Portfolio.summaryLabels.includes(row[0]) && !AssetTypes.all.includes(row[0]);
  }

  buildAssetLookup_(sheetRow, header, assetColumn) {
    const lookup = Assets.buildLookup(this.assetColumns, assetColumn, `$A${sheetRow}`);
    return { row: sheetRow, column: Portfolio.getColumn(header), formulas: [`=${lookup}`] };
  }

  static buildPercentageOfCost_(column, sheetRow) {
    return `=IFERROR($${column}${sheetRow}/$${Portfolio.letters.costBasis}${sheetRow},0)`;
  }

  static buildDerivedFormulas_(r) {
    const c = Portfolio.letters;
    return [
      {
        row: r,
        column: Portfolio.getColumn(Portfolio.returnPercentageHeader),
        formulas: [PortfolioLayout.buildPercentageOfCost_(c.totalReturn, r)]
      },
      {
        row: r,
        column: Portfolio.getColumn(Portfolio.assetReturnPercentageHeader),
        formulas: [
          PortfolioLayout.buildPercentageOfCost_(c.assetReturn, r),
          `=$${c.value}${r}-$${c.costBasis}${r}+$${c.fees}${r}-$${c.assetReturn}${r}`,
          PortfolioLayout.buildPercentageOfCost_(c.currencyEffect, r)
        ]
      }
    ];
  }

  static buildRecentReturnFormulas_(r) {
    const data = PortfolioData.buildColumnReference;
    const sumWhere = (dateCondition) =>
      `=SUMIFS(${data(PortfolioData.returnHeader)},${data(PortfolioData.assetHeader)},$A${r},${data(PortfolioData.dateHeader)},${dateCondition})`;

    const latestDay = `MAXIFS(${data(PortfolioData.dateHeader)},${data(PortfolioData.assetHeader)},$A${r})`;
    const sumSince = (months) => sumWhere(`">="&(EDATE(TODAY(),-${months})+1)`);

    const buildPercentage = (header) => {
      const column = Portfolio.getLetter(header);
      return `=IF($${column}${r}="","",IFERROR($${column}${r}/$${Portfolio.letters.costBasis}${r},0))`;
    };
    const guarded = (threshold, formula) => `=IF(OR($F${r}="",TODAY()<${threshold}),"",${formula.slice(1)})`;

    return {
      row: r,
      column: Portfolio.getColumn(Portfolio.oneDayReturnHeader),
      formulas: [
        guarded(`$F${r}+1`, sumWhere(latestDay)),
        buildPercentage(Portfolio.oneDayReturnHeader),
        guarded(`EDATE($F${r},1)`, sumSince(1)),
        buildPercentage(Portfolio.oneMonthReturnHeader),
        guarded(`EDATE($F${r},3)`, sumSince(3)),
        buildPercentage(Portfolio.threeMonthReturnHeader)
      ]
    };
  }

  buildLiveFormulas_(row, sheetRow) {
    const asset = this.assets.get(row[0]);
    if (Assets.isDerivative(asset) || asset.assetType === AssetTypes.options) return null;
    const r = sheetRow;
    const c = Portfolio.letters;
    const rate = Currencies.buildRateLookup(`$${c.currency}${r}`);
    const isBond = Assets.hasTerms(asset);
    const accrued = isBond ? PortfolioData.buildLatestLookup(PortfolioData.accruedInterestHeader, `$A${r}`) : "";
    const paid = isBond ? PortfolioData.buildLatestLookup(PortfolioData.accruedInterestPaidHeader, `$A${r}`) : "";
    const priceValue = `$${c.quantity}${r}*$${c.unitValue}${r}*${rate}`;
    const costExcludingFees = `($${c.costBasis}${r}-$${c.fees}${r})`;
    const assetReturn =
      `IF(OR($${c.currency}${r}="${Currencies.pounds}",$${c.currency}${r}="${Currencies.pence}"),${priceValue}-${costExcludingFees},` +
      `IFERROR(($${c.unitValue}${r}/$${c.averageCost}${r}-1)*${costExcludingFees},0))`;

    const buildPercentage = (column) => PortfolioLayout.buildPercentageOfCost_(column, r);
    const valueAndReturn = [
      `=${priceValue}${isBond ? `+${accrued}` : ""}`,
      `=$${c.value}${r}+$${c.distributions}${r}-$${c.costBasis}${r}${isBond ? `-${paid}` : ""}`,
      buildPercentage(c.totalReturn)
    ];

    const attribution = [
      `=${assetReturn}`,
      buildPercentage(c.assetReturn),
      `=${priceValue}-${costExcludingFees}-$${c.assetReturn}${r}`,
      buildPercentage(c.currencyEffect)
    ];

    const lookup = `=${Assets.buildLookup(this.assetColumns, "price", `$A${r}`)}`;
    return [
      { row: r, column: Portfolio.getColumn(Portfolio.localUnitValueHeader), formulas: [lookup] },
      { row: r, column: Portfolio.getColumn(Portfolio.valueHeader), formulas: valueAndReturn },
      { row: r, column: Portfolio.getColumn(Portfolio.assetReturnHeader), formulas: attribution }
    ];
  }
}
