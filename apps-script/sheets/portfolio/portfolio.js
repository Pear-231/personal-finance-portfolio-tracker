class Portfolio {
  static get sheetName() {
    return "Portfolio";
  }

  static get labelHeader() {
    return "";
  }

  static get quantityHeader() {
    return "Quantity";
  }

  static get currencyHeader() {
    return "Currency";
  }

  static get localUnitValueHeader() {
    return "Local Unit Value";
  }

  static get localAverageCostHeader() {
    return "Local Average Cost";
  }

  static get openDateHeader() {
    return "Open Date";
  }

  static get closeDateHeader() {
    return "Close Date";
  }

  static get valuationDateHeader() {
    return "Valuation Date";
  }

  static get feesHeader() {
    return "Fees (£)";
  }

  static get distributionsHeader() {
    return "Distributions (£)";
  }

  static get costBasisHeader() {
    return "Cost Basis (£)";
  }

  static get valueHeader() {
    return "Value (£)";
  }

  static get returnHeader() {
    return "Return (£)";
  }

  static get returnPercentageHeader() {
    return "Return (%)";
  }

  static get assetReturnHeader() {
    return "Asset Return (£)";
  }

  static get assetReturnPercentageHeader() {
    return "Asset Return (%)";
  }

  static get currencyEffectHeader() {
    return "Currency Effect (£)";
  }

  static get currencyEffectPercentageHeader() {
    return "Currency Effect (%)";
  }

  static get oneDayReturnHeader() {
    return "1 Day Return (£)";
  }

  static get oneDayReturnPercentageHeader() {
    return "1 Day Return (%)";
  }

  static get oneMonthReturnHeader() {
    return "1 Month Return (£)";
  }

  static get oneMonthReturnPercentageHeader() {
    return "1 Month Return (%)";
  }

  static get threeMonthReturnHeader() {
    return "3 Month Return (£)";
  }

  static get threeMonthReturnPercentageHeader() {
    return "3 Month Return (%)";
  }

  static get headers() {
    return [
      Portfolio.labelHeader,
      Portfolio.quantityHeader,
      Portfolio.currencyHeader,
      Portfolio.localUnitValueHeader,
      Portfolio.localAverageCostHeader,
      Portfolio.openDateHeader,
      Portfolio.closeDateHeader,
      Portfolio.valuationDateHeader,
      Portfolio.feesHeader,
      Portfolio.distributionsHeader,
      Portfolio.costBasisHeader,
      Portfolio.valueHeader,
      Portfolio.returnHeader,
      Portfolio.returnPercentageHeader,
      Portfolio.assetReturnHeader,
      Portfolio.assetReturnPercentageHeader,
      Portfolio.currencyEffectHeader,
      Portfolio.currencyEffectPercentageHeader,
      Portfolio.oneDayReturnHeader,
      Portfolio.oneDayReturnPercentageHeader,
      Portfolio.oneMonthReturnHeader,
      Portfolio.oneMonthReturnPercentageHeader,
      Portfolio.threeMonthReturnHeader,
      Portfolio.threeMonthReturnPercentageHeader
    ];
  }

  static get assetsLabel() {
    return "Assets";
  }

  static get assetsInMarketLabel() {
    return "Assets In Market";
  }

  static get assetsExcludingPensionLabel() {
    return "Assets Excluding Pension";
  }

  static get heldSummaryLabels() {
    return [Portfolio.assetsLabel, Portfolio.assetsExcludingPensionLabel, Portfolio.assetsInMarketLabel];
  }

  static get currentMode() {
    return "current";
  }

  static get realisedMode() {
    return "realised";
  }

  static get modes() {
    return [Portfolio.currentMode, Portfolio.realisedMode];
  }

  static get summaryKind() {
    return "summary";
  }

  static get sectionKind() {
    return "section";
  }

  static get holdingKind() {
    return "holding";
  }

  /** The control of a group sits on the column before it. */
  static get columnGroups() {
    const group = (firstHeader, lastHeader) => ({
      column: Portfolio.getColumn(firstHeader),
      count: Portfolio.getColumn(lastHeader) - Portfolio.getColumn(firstHeader) + 1
    });

    return [
      group(Portfolio.assetReturnHeader, Portfolio.currencyEffectPercentageHeader),
      group(Portfolio.oneMonthReturnHeader, Portfolio.threeMonthReturnPercentageHeader)
    ];
  }

  static get signColouredColumns() {
    return {
      first: Portfolio.getColumn(Portfolio.returnHeader),
      count: Portfolio.headers.length - Portfolio.getIndex(Portfolio.returnHeader)
    };
  }

  static getIndex(header) {
    const index = Portfolio.headers.indexOf(header);
    if (index < 0)
      throw new Error(
        `The script looked for a Portfolio column headed "${header}", which is not in ` +
          "Portfolio.headers. This is a fault in the script, not in your sheets."
      );
    return index;
  }

  static getColumn(header) {
    return Portfolio.getIndex(header) + 1;
  }

  static getLetter(header) {
    return SheetTable.getColumnLetter(Portfolio.getIndex(header));
  }

  static get letters() {
    const letterOf = (header) => Portfolio.getLetter(header);

    return {
      quantity: letterOf(Portfolio.quantityHeader),
      currency: letterOf(Portfolio.currencyHeader),
      unitValue: letterOf(Portfolio.localUnitValueHeader),
      averageCost: letterOf(Portfolio.localAverageCostHeader),
      fees: letterOf(Portfolio.feesHeader),
      distributions: letterOf(Portfolio.distributionsHeader),
      costBasis: letterOf(Portfolio.costBasisHeader),
      value: letterOf(Portfolio.valueHeader),
      totalReturn: letterOf(Portfolio.returnHeader),
      assetReturn: letterOf(Portfolio.assetReturnHeader),
      currencyEffect: letterOf(Portfolio.currencyEffectHeader),
      oneDayReturn: letterOf(Portfolio.oneDayReturnHeader),
      oneMonthReturn: letterOf(Portfolio.oneMonthReturnHeader),
      threeMonthReturn: letterOf(Portfolio.threeMonthReturnHeader)
    };
  }

  static get totalColumns() {
    const { quantity, currency, unitValue, averageCost, ...totalled } = Portfolio.letters;

    return totalled;
  }

  static get optionalAssetTypes() {
    return [AssetTypes.pension];
  }

  static get realisedSummaryLabels() {
    return Portfolio.heldSummaryLabels.map((label) => `Realised ${label}`);
  }

  static get allSummaryLabels() {
    return Portfolio.heldSummaryLabels.map((label) => `All ${label}`);
  }

  static get summaryLabels() {
    return [...Portfolio.heldSummaryLabels, ...Portfolio.realisedSummaryLabels, ...Portfolio.allSummaryLabels];
  }

  constructor(sheet) {
    this.sheet = sheet;
  }

  static open(spreadsheet) {
    const existing = spreadsheet.getSheetByName(Portfolio.sheetName);
    const sheet = existing || spreadsheet.insertSheet(Portfolio.sheetName);
    if (existing && sheet.getLastRow() > 0) {
      SheetTable.verifyHeaders(sheet, Portfolio.sheetName, Portfolio.headers, {
        ignoredColumns: [0]
      });
    }

    return new Portfolio(sheet);
  }

  static openExisting(spreadsheet) {
    return new Portfolio(SheetTable.openRequired(spreadsheet, Portfolio.sheetName));
  }

  static rebuild(spreadsheet, { ledgerRows, assets, sourceRows }, observations) {
    const builder = new PortfolioReportBuilder(ledgerRows, assets, observations, sourceRows);
    const assetColumns = new Assets(spreadsheet).readColumnLetters();
    const layout = new PortfolioLayout(builder, assets, assetColumns).build();
    let disagreements = [];
    Logger.runStep(Portfolio.sheetName, () => {
      const portfolio = Portfolio.open(spreadsheet);
      portfolio.write(layout);
      disagreements = portfolio.findDisagreements(layout.expectations);
    });

    const live = layout.expectations.length;

    if (disagreements.length === 0) {
      return `Portfolio rebuilt: ${layout.rows.length} rows, ${live} of them live.`;
    }

    const names = disagreements.map((expected) => expected.asset).join(", ");
    return (
      `Portfolio rebuilt: ${layout.rows.length} rows, ${live} of them live. Check these rows, ` +
      `whose figures differ from the code's by more than a percent: ${names}.`
    );
  }

  recordRefreshTime(time) {
    SheetTable.writeTimestamp(this.sheet, time);
  }

  write(layout) {
    const { sheet } = this;
    const { rows } = layout;
    const width = Portfolio.headers.length;
    const isNew = sheet.getLastRow() === 0;

    SheetTable.ensureSize(sheet, rows.length + 1, width);

    SheetTable.ignoreTypedColumns(() => sheet.getRange(2, 1, sheet.getMaxRows() - 1, sheet.getMaxColumns()).clearContent());

    if (isNew) {
      SheetTable.setValues(sheet.getRange(1, 1, 1, width), [Portfolio.headers]);
      sheet.setFrozenRows(1);
    }

    SheetTable.setValues(sheet.getRange(2, 1, rows.length, width), Portfolio.addFormulas_(layout));

    SheetTable.trimRowsBelow(sheet, rows.length + 1);
    this.style_(rows);

    SheetTable.ignoreTypedColumns(() =>
      SheetGroups.replace(sheet, {
        rows: {
          firstRow: 2,
          groups: layout.groups,
          isOpen: (group) => !group.isCollapsed
        },
        columns: { groups: Portfolio.columnGroups }
      })
    );
  }

  static addFormulas_({ rows, formulas, summaries }) {
    const cells = rows.map((row) => [...row]);
    const place = (row, column, block) => cells[row - 2].splice(column - 1, block.length, ...block);

    for (const { row, column, formulas: block } of formulas) {
      place(row, column, block);
    }

    for (const { row, formulas: block } of summaries) {
      place(row, Portfolio.getColumn(Portfolio.feesHeader), block);
    }

    return cells;
  }

  findDisagreements(expectations) {
    SheetTable.flush();
    const rows = SheetTable.readRows(this.sheet, Portfolio.headers.length);

    return expectations.filter((expected) => {
      const cells = rows[expected.row - 2];
      const [value, totalReturn, assetReturn, currencyEffect] = [
        Portfolio.valueHeader,
        Portfolio.returnHeader,
        Portfolio.assetReturnHeader,
        Portfolio.currencyEffectHeader
      ].map((header) => cells[Portfolio.getIndex(header)]);

      const pairs = [
        [value, expected.value],
        [totalReturn, expected.totalReturn],
        [assetReturn, expected.assetReturn],
        [currencyEffect, expected.currencyEffect]
      ];

      const allowance = 0.5 + 0.01 * Math.abs(expected.value);
      return pairs.some(([actual, wanted]) => typeof actual === "number" && Math.abs(actual - wanted) > allowance);
    });
  }

  style_(rows) {
    const { sheet } = this;
    const width = Portfolio.headers.length;
    const summaries = new Set(Portfolio.summaryLabels);
    const sections = new Set(AssetTypes.all);
    const data = sheet.getRange(2, 1, rows.length, width);

    const getKind = (row) => {
      if (sections.has(row[0])) return Portfolio.sectionKind;
      return summaries.has(row[0]) ? Portfolio.summaryKind : Portfolio.holdingKind;
    };

    const buildGrid = (cellOf) => rows.map((row) => Array(width).fill(cellOf(getKind(row))));
    const backgrounds = {
      [Portfolio.summaryKind]: SheetStyle.accentShading,
      [Portfolio.sectionKind]: SheetStyle.lightShading,
      [Portfolio.holdingKind]: null
    };
    const styles = [
      () => data.setFontFamily(SheetStyle.fontFamily).setFontSize(SheetStyle.fontSize),
      () => data.setVerticalAlignment("middle"),
      () => sheet.getRange(2, 1, rows.length, 1).setWrap(true).setHorizontalAlignment("left"),
      () => data.setFontWeight("normal"),
      () => sheet.getRange(2, 1, rows.length, 1).setFontWeights(rows.map((row) => [getKind(row) === Portfolio.holdingKind ? "normal" : "bold"])),
      () => data.setBackgrounds(buildGrid((type) => backgrounds[type]))
    ];

    for (const style of styles) {
      SheetTable.ignoreTypedColumns(style);
    }
    const { first, count } = Portfolio.signColouredColumns;
    const returns = sheet.getRange(2, first, sheet.getMaxRows() - 1, count);
    SheetTable.ignoreTypedColumns(() => SheetStyle.applySignColours(sheet, [returns]));
  }
}
