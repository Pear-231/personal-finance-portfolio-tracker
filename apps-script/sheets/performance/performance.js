class Performance {
  static get sheetName() {
    return "Performance";
  }

  static get yearLevel() {
    return "year";
  }

  static get monthLevel() {
    return "month";
  }

  static get sectionLevel() {
    return "section";
  }

  static get assetLevel() {
    return "asset";
  }

  static get log() {
    return Logger.create("Sheets.Performance.Performance");
  }

  static get columns() {
    const percent = "+#,##0.00%;-#,##0.00%";
    const pounds = "[$£-809]#,##0.00";
    const number = "#,##0.00";
    const plainPercent = "0.00%";
    const general = "General";
    return [
      {
        header: "",
        field: "label",
        format: general,
        width: 220
      },
      {
        header: "Quantity",
        field: "quantity",
        format: number,
        width: 100
      },
      {
        header: "Value (£)",
        field: "value",
        format: pounds,
        width: 100
      },
      {
        header: "Net Cash Flow (£)",
        field: "netCashFlow",
        format: pounds,
        width: 120
      },
      {
        header: "Fees (£)",
        field: "fees",
        format: pounds,
        width: 100
      },
      {
        header: "Distributions (£)",
        field: "distributions",
        format: pounds,
        width: 110
      },
      {
        header: "Return (£)",
        field: "returnAmount",
        format: pounds,
        width: 100
      },
      {
        header: "Return (%)",
        field: "simpleReturn",
        format: percent,
        width: 100
      },
      {
        header: "Time-Weighted Return (%)",
        field: "timeWeightedReturn",
        format: percent,
        width: 130
      },
      {
        header: "Real Return (%)",
        field: "realReturn",
        format: percent,
        width: 100
      },
      {
        header: "Excess Return (%)",
        field: "excessReturn",
        format: percent,
        width: 100
      },
      {
        header: "1 Year Return (£)",
        field: "oneYearReturnAmount",
        format: pounds,
        width: 100
      },
      {
        header: "1 Year Return (%)",
        field: "oneYearReturn",
        format: percent,
        width: 100
      },
      {
        header: "3 Year Return (£)",
        field: "threeYearReturnAmount",
        format: pounds,
        width: 100
      },
      {
        header: "3 Year Return (%)",
        field: "threeYearReturn",
        format: percent,
        width: 100
      },
      {
        header: "5 Year Return (£)",
        field: "fiveYearReturnAmount",
        format: pounds,
        width: 100
      },
      {
        header: "5 Year Return (%)",
        field: "fiveYearReturn",
        format: percent,
        width: 100
      },
      {
        header: "Trailing 12 Month Sharpe Ratio",
        field: "trailingSharpeRatio",
        format: number,
        width: 170
      },
      {
        header: "CPI (%)",
        field: "cpi",
        format: plainPercent,
        width: 150
      },
      {
        header: "SONIA (%)",
        field: "sonia",
        format: plainPercent,
        width: 150
      },
      {
        header: "Standard Deviation (%)",
        field: "standardDeviation",
        format: plainPercent,
        width: 130
      }
    ];
  }

  static get headers() {
    return Performance.columns.map((column) => column.header);
  }

  static get levels() {
    return {
      year: { background: SheetStyle.accentShading, labelFormat: "0" },
      month: { background: SheetStyle.mediumShading, labelFormat: "mmmm yyyy" },
      section: { background: SheetStyle.lightShading }
    };
  }

  static update(spreadsheet, { assets = new Assets(spreadsheet).read(), storedValuations = new PortfolioData(spreadsheet).readValuations() } = {}) {
    const valuations = Performance.selectValuations_(storedValuations, assets);
    const { firstDate, lastDate } = Performance.findDateRange_(valuations);

    const soniaRates = Sonia.fetchRates(Dates.addDays(firstDate, -Sonia.maxGapDays), lastDate);
    const cpiMonths = Cpi.fetchMonths();

    const { dailyReturns } = Performance.calculateReturns_(valuations, soniaRates);
    const years = new PerformanceSummary(dailyReturns, valuations, soniaRates, cpiMonths).build();

    const assetTypes = new Map([...assets].map(([name, asset]) => [name, asset.assetType]));
    const rows = new PerformanceBuilder(valuations, years, soniaRates, cpiMonths, assetTypes).build();

    Logger.runStep(Performance.sheetName, () => Performance.open(spreadsheet).write(rows));

    return `Performance updated through ${Dates.formatDisplay(lastDate)}: ${rows.length} rows, using ${soniaRates.length} SONIA observations.`;
  }

  /** We don't consider Pension in Performance. */
  static selectValuations_(storedValuations, assets) {
    const valuations = storedValuations.filter((valuation) => assets.get(valuation.asset)?.assetType !== AssetTypes.pension);

    if (valuations.length === 0) {
      throw new Error("There are no valuations to measure: Portfolio Data is empty, or holds only the pension. Run Record Portfolio Data first.");
    }

    return valuations;
  }

  static findDateRange_(valuations) {
    const dates = valuations.map((valuation) => valuation.date.getTime());
    const firstDate = new Date(Math.min(...dates));
    const lastDate = new Date(Math.max(...dates));
    Performance.log.information(
      "findDateRange_",
      `Measuring ${valuations.length} stored valuations from ${Dates.formatDisplay(firstDate)} to ${Dates.formatDisplay(lastDate)}.`
    );

    return { firstDate, lastDate };
  }

  static calculateReturns_(valuations, soniaRates) {
    const returns = new PortfolioReturnSeries(valuations, soniaRates).run();
    Performance.log.throwIfAny("calculateReturns_", returns.errors, (errors) => `Performance was not written: ${errors.join(" ")}`);

    return returns;
  }

  constructor(sheet) {
    this.sheet = sheet;
  }

  static open(spreadsheet) {
    return new Performance(spreadsheet.getSheetByName(Performance.sheetName) || spreadsheet.insertSheet(Performance.sheetName));
  }

  write(rows, now = new Date()) {
    const { sheet } = this;
    const { columns } = Performance;
    const timings = [];
    const runTimed = (label, action) => {
      const startedAt = Date.now();
      action();
      timings.push(`${label} ${((Date.now() - startedAt) / Dates.millisecondsPerSecond).toFixed(1)} s`);
    };

    const isNew = sheet.getLastRow() === 0;

    if (!isNew) {
      SheetTable.verifyHeaders(sheet, Performance.sheetName, Performance.headers, {
        ignoredColumns: [0]
      });
      runTimed("cleared the old rows", () => this.clearRows_());
    }

    SheetTable.ensureSize(sheet, rows.length + 1, columns.length);

    if (isNew) {
      this.writeHeader_();
      this.formatColumns_();
    }

    runTimed("wrote the values", () => {
      const range = sheet.getRange(2, 1, rows.length, columns.length);
      SheetTable.setValues(
        range,
        rows.map((row) => row.values)
      );
      this.writeFormulas_(rows);
      this.verifyFormulaResults_(rows);
      SheetTable.trimRowsBelow(sheet, rows.length + 1);
    });

    runTimed("formatted them", () => {
      this.format_(rows);
      this.colourReturns_();
    });

    runTimed("grouped them", () => this.groupRows_(rows, now));
    SheetTable.ignoreTypedColumns(() => SheetTable.writeTimestamp(sheet, now));
    Performance.log.information("write", `${rows.length} rows: ${timings.join(", ")}.`);
  }

  writeFormulas_(rows) {
    if (rows.length === 0) return;

    const requests = [];
    const letterOf = (field) => SheetTable.getColumnLetter(Performance.getColumnNumber_(field) - 1);
    const buildDifferenceFormula = (minuend, subtrahend, sheetRow) =>
      `=IF(OR(${minuend}${sheetRow}="",${subtrahend}${sheetRow}=""),"",${minuend}${sheetRow}-${subtrahend}${sheetRow})`;
    const addFormula = (rowIndex, columnIndex, formula) => {
      requests.push({
        updateCells: {
          range: {
            sheetId: this.sheet.getSheetId(),
            startRowIndex: rowIndex + 1,
            endRowIndex: rowIndex + 2,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1
          },
          rows: [{ values: [{ userEnteredValue: { formulaValue: formula } }] }],
          fields: "userEnteredValue"
        }
      });
    };

    rows.forEach((row, index) => {
      const sheetRow = index + 2;
      addFormula(
        index,
        Performance.getColumnNumber_("excessReturn") - 1,
        buildDifferenceFormula(letterOf("timeWeightedReturn"), letterOf("cpi"), sheetRow)
      );

      const childRows = Performance.findChildRows_(rows, index, Performance.getChildLevel_(row.level));
      if (childRows.length > 0) {
        for (const field of ["netCashFlow", "fees", "distributions", "returnAmount"]) {
          const references = childRows.map((child) => `${SheetTable.getColumnLetter(Performance.getColumnNumber_(field) - 1)}${child + 2}`).join(",");
          addFormula(index, Performance.getColumnNumber_(field) - 1, `=SUM(${references})`);
        }
      }
    });

    SheetTable.ignoreTypedColumns(() => Sheets.Spreadsheets.batchUpdate({ requests }, this.sheet.getParent().getId()));
  }

  verifyFormulaResults_(rows) {
    SheetTable.flush();
    const actual = this.sheet.getRange(2, 1, rows.length, Performance.columns.length).getValues();
    const mismatches = [];

    rows.forEach((row, index) => {
      const checkedFields = new Set(["excessReturn"]);
      if (Performance.getChildRows_(rows, index).length > 0) {
        checkedFields.add("netCashFlow").add("fees").add("distributions").add("returnAmount");
      }

      for (const field of checkedFields) {
        const column = Performance.getColumnNumber_(field) - 1;
        const expected = row.values[column];
        const found = actual[index][column];
        if (!Performance.valuesMatch_(expected, found)) mismatches.push(`${field} row ${index + 2}: expected ${expected}, found ${found}`);
      }
    });

    if (mismatches.length > 0) {
      throw new Error(`Performance formula verification failed: ${mismatches.slice(0, 10).join("; ")}`);
    }
  }

  static valuesMatch_(expected, found) {
    const expectedBlank = expected === "" || expected === null || expected === undefined;
    const foundBlank = found === "" || found === null || found === undefined;
    if (expectedBlank || foundBlank) return expectedBlank && foundBlank;
    if (typeof expected === "number" && typeof found === "number") return Math.abs(expected - found) <= 0.000001;
    return expected === found;
  }

  static getChildLevel_(level) {
    return {
      [Performance.yearLevel]: Performance.monthLevel,
      [Performance.monthLevel]: Performance.sectionLevel,
      [Performance.sectionLevel]: Performance.assetLevel
    }[level];
  }

  static getChildRows_(rows, parentIndex) {
    return Performance.findChildRows_(rows, parentIndex, Performance.getChildLevel_(rows[parentIndex].level));
  }

  static findChildRows_(rows, parentIndex, childLevel) {
    if (!childLevel) return [];
    const levels = [Performance.yearLevel, Performance.monthLevel, Performance.sectionLevel, Performance.assetLevel];
    const parentDepth = levels.indexOf(rows[parentIndex].level);
    const childDepth = levels.indexOf(childLevel);
    const children = [];

    for (let index = parentIndex + 1; index < rows.length; index += 1) {
      const depth = levels.indexOf(rows[index].level);
      if (depth <= parentDepth) break;
      if (depth === childDepth) children.push(index);
    }

    return children;
  }

  /**
   * Deleting the rows removes their groups with them. The first data row is a year's own row, which is never in a group, so it is cleared instead.
   */
  clearRows_() {
    const { sheet } = this;

    SheetTable.flush();
    if (sheet.getMaxRows() > 2) sheet.deleteRows(3, sheet.getMaxRows() - 2);
    const first = sheet.getRange(2, 1, 1, sheet.getMaxColumns());
    first.clearContent();
    SheetTable.ignoreTypedColumns(() => first.clearFormat());
    SheetTable.flush();
  }

  writeHeader_() {
    const { sheet } = this;
    const { columns, headers } = Performance;
    const header = sheet.getRange(1, 1, 1, columns.length);
    SheetTable.setValues(header, [headers]);
    SheetTable.ignoreTypedColumns(() =>
      header
        .setFontFamily(SheetStyle.fontFamily)
        .setFontSize(SheetStyle.fontSize)
        .setFontWeight("normal")
        .setBackground(SheetStyle.lightShading)
        .setHorizontalAlignment("center")
    );

    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(1);
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      sheet.setColumnWidth(index + 1, column.width);
    }
  }

  formatColumns_() {
    const { sheet } = this;
    const { columns } = Performance;
    const body = sheet.getRange(2, 1, sheet.getMaxRows() - 1, columns.length);
    SheetTable.ignoreTypedColumns(() => body.setFontFamily(SheetStyle.fontFamily).setFontSize(SheetStyle.fontSize));

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const cells = sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1);
      SheetTable.ignoreTypedColumns(() => cells.setNumberFormat(column.format).setHorizontalAlignment(index === 0 ? "left" : "right"));
    }
  }

  /**
   * A year is a number, which a sheet aligns to the right, and a column format cannot tell a year, a month and text apart, hence the label format of
   * each row.
   */
  format_(rows) {
    SheetTable.flush();
    const requests = PerformanceFormat.buildRequests(this.sheet.getSheetId(), rows);
    Sheets.Spreadsheets.batchUpdate({ requests }, this.sheet.getParent().getId());
  }

  colourReturns_() {
    const { sheet } = this;
    const first = Performance.columns.findIndex((column) => column.field === "returnAmount");
    const last = Performance.columns.findIndex((column) => column.field === "fiveYearReturn");
    const returns = sheet.getRange(2, first + 1, sheet.getMaxRows() - 1, last - first + 1);
    const trailingSharpe = sheet.getRange(2, Performance.getColumnNumber_("trailingSharpeRatio"), sheet.getMaxRows() - 1, 1);

    SheetTable.ignoreTypedColumns(() => SheetStyle.applySignColours(sheet, [returns], null, [{ ranges: [trailingSharpe], threshold: 1 }]));
  }

  static getColumnNumber_(field) {
    return Performance.columns.findIndex((column) => column.field === field) + 1;
  }

  static getColumnGroups_() {
    const buildGroup = (firstField, lastField) => {
      const first = Performance.getColumnNumber_(firstField);
      return { column: first, count: Performance.getColumnNumber_(lastField) - first + 1 };
    };

    return [buildGroup("threeYearReturnAmount", "fiveYearReturn"), buildGroup("cpi", "standardDeviation")];
  }

  groupRows_(rows, now) {
    const { sheet } = this;
    SheetTable.ignoreTypedColumns(() =>
      SheetGroups.replace(sheet, {
        rows: {
          firstRow: 2,
          groups: Performance.findGroupedRows_(rows),
          isOpen: (group) => Performance.isCurrent_(rows, group.index - 1, now)
        },
        columns: {
          groups: Performance.getColumnGroups_()
        }
      })
    );
  }

  static isCurrent_(rows, index, now) {
    const { level, values } = rows[index];
    if (level === Performance.yearLevel) return values[0] === now.getFullYear();
    let monthIndex = index;
    while (rows[monthIndex].level !== Performance.monthLevel) monthIndex -= 1;

    const month = rows[monthIndex].values[0];
    return month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  }

  static findGroupedRows_(rows) {
    return rows.map((row, index) => ({ index: index + 1, count: Performance.countRowsInside_(rows, index) })).filter((group) => group.count > 0);
  }

  /** The rows below a year, month or section row that belong to it. */
  static countRowsInside_(rows, index) {
    const isInside = {
      [Performance.yearLevel]: (level) => level !== Performance.yearLevel,
      [Performance.monthLevel]: (level) => level === Performance.sectionLevel || level === Performance.assetLevel,
      [Performance.sectionLevel]: (level) => level === Performance.assetLevel
    }[rows[index].level];
    if (!isInside) return 0;

    let count = 0;
    while (index + 1 + count < rows.length && isInside(rows[index + 1 + count].level)) count += 1;

    return count;
  }
}
