class PortfolioData {
  static get sheetName() {
    return "Portfolio Data";
  }

  static get dateHeader() {
    return "Date";
  }

  static get assetHeader() {
    return "Asset";
  }

  static get currencyHeader() {
    return "Currency";
  }

  static get openQuantityHeader() {
    return "Open Quantity";
  }

  static get closeQuantityHeader() {
    return "Close Quantity";
  }

  static get localUnitValueHeader() {
    return "Local Unit Value";
  }

  static get exchangeRateHeader() {
    return "Exchange Rate";
  }

  static get openValueHeader() {
    return "Open Value (£)";
  }

  static get netCashFlowHeader() {
    return "Net Cash Flow (£)";
  }

  static get distributionsHeader() {
    return "Distributions (£)";
  }

  static get feesHeader() {
    return "Fees (£)";
  }

  static get closeValueHeader() {
    return "Close Value (£)";
  }

  static get returnHeader() {
    return "Return (£)";
  }

  static get returnPercentageHeader() {
    return "Return (%)";
  }

  static get marginHeader() {
    return "Margin (£)";
  }

  static get accruedInterestHeader() {
    return "Accrued Interest (£)";
  }

  static get accruedInterestPaidHeader() {
    return "Accrued Interest Paid (£)";
  }

  static get provisionalHeader() {
    return "Is Provisional";
  }

  static get headers() {
    return [
      PortfolioData.dateHeader,
      PortfolioData.assetHeader,
      PortfolioData.currencyHeader,
      PortfolioData.openQuantityHeader,
      PortfolioData.closeQuantityHeader,
      PortfolioData.localUnitValueHeader,
      PortfolioData.exchangeRateHeader,
      PortfolioData.openValueHeader,
      PortfolioData.netCashFlowHeader,
      PortfolioData.distributionsHeader,
      PortfolioData.feesHeader,
      PortfolioData.closeValueHeader,
      PortfolioData.returnHeader,
      PortfolioData.returnPercentageHeader,
      PortfolioData.marginHeader,
      PortfolioData.accruedInterestHeader,
      PortfolioData.accruedInterestPaidHeader,
      PortfolioData.provisionalHeader
    ];
  }

  static get columns() {
    return [
      "date",
      "asset",
      "currency",
      "openQuantity",
      "closeQuantity",
      "localUnitValue",
      "exchangeRate",
      "openValue",
      "netCashFlow",
      "distributions",
      "fees",
      "closeValue",
      "returnAmount",
      "dailyReturn",
      "margin",
      "accruedInterest",
      "accruedInterestPaid",
      "isProvisional"
    ];
  }

  static get log() {
    return Logger.create("Sheets.PortfolioData.PortfolioData");
  }

  static get figureColumns() {
    const { columns } = PortfolioData;
    return columns.slice(columns.indexOf("currency") + 1, columns.indexOf("isProvisional"));
  }

  static buildColumnReference(header) {
    const letter = SheetTable.getColumnLetter(PortfolioData.headers.indexOf(header));
    return `'${PortfolioData.sheetName}'!$${letter}:$${letter}`;
  }

  static buildLatestLookup(header, assetCell) {
    const asset = PortfolioData.buildColumnReference(PortfolioData.assetHeader);
    return `IFERROR(XLOOKUP(${assetCell},${asset},${PortfolioData.buildColumnReference(header)},0,0,-1),0)`;
  }

  constructor(spreadsheet) {
    this.spreadsheet = spreadsheet;
  }

  static record(spreadsheet) {
    const inputs = LedgerReplay.load(spreadsheet);
    const update = new PortfolioData(spreadsheet).update(inputs);
    return (
      `Portfolio Data recorded through ${Dates.formatDisplay(update.lastDate)}: ` +
      `${update.priceCount} price and ${update.fxCount} FX observations added, ` +
      `${update.rowsWritten} rows added to Portfolio Data.` +
      PortfolioData.describeProvisional(update.provisionalRowCount)
    );
  }

  static describeProvisional(provisionalRowCount) {
    return provisionalRowCount === 0
      ? ""
      : ` ${provisionalRowCount} Portfolio Data ${provisionalRowCount === 1 ? "row is" : "rows are"} ` +
          `provisional: check each price, then untick ${PortfolioData.provisionalHeader}.`;
  }

  readValuations() {
    if (!this.sheet && !this.spreadsheet.getSheetByName(PortfolioData.sheetName)) return [];
    return PortfolioData.readValuationsIn_(this.getSheet_());
  }

  update({ assets, ledgerRows, valuations }, { isRestatement = false } = {}) {
    this.getSheet_();
    const stored = this.readValuations();
    const recorded = [...PortfolioData.buildRecordedObservations(stored, assets), ...valuations];
    const missing = PortfolioData.gatherMissingPrices_(assets, ledgerRows, recorded);
    const observations = [...recorded, ...missing.observations];

    PortfolioData.log.information(
      "update",
      `${stored.length} Portfolio Data rows stored; ${missing.priceCount} prices and ` +
        `${missing.fxCount} exchange rates fetched, ${missing.carriedCount} days carried, ` +
        `${missing.provisionalCount} days provisional.`
    );

    const computed = PortfolioData.calculateValuations_(ledgerRows, assets, observations);

    const { valuations: storedValuations, rowsWritten } =
      isRestatement || stored.length === 0 ? this.restateHistory_(computed, stored) : this.appendNewValuations_(computed, stored);

    return {
      valuations: storedValuations,
      rowsWritten,
      lastDate: new Date(Math.max(...computed.map((valuation) => valuation.date.getTime()))),
      observations,
      priceCount: missing.priceCount,
      fxCount: missing.fxCount,
      provisionalRowCount: storedValuations.filter(({ isProvisional }) => isProvisional).length
    };
  }

  static calculateValuations_(ledgerRows, assets, observations) {
    const history = ValuationHistory.buildUpToLatestValuation(ledgerRows, assets, observations);
    PortfolioData.log.throwIfAny("calculateValuations_", history.errors, ValuationHistory.describeErrors);

    if (history.valuations.length === 0) {
      throw new Error(
        "Portfolio Data was not written because there is nothing to value: Transactions has no " +
          "rows, or every row is dated after the latest day that can be valued, " +
          `${Dates.formatDisplay(Dates.findLatestCompletedValuation())}.`
      );
    }

    return history.valuations;
  }

  static gatherMissingPrices_(assets, ledgerRows, recorded) {
    const targetDate = Dates.findLatestCompletedValuation();
    const prices = new PriceHistoryRefresher(ledgerRows, assets, recorded, targetDate).build();
    const exchangeRates = PriceHistoryRefresher.fetchMissingExchangeRates([...recorded, ...prices.observations]);
    const real = [...prices.observations, ...exchangeRates.observations];
    const coverage = new Map([...prices.coverage, ...exchangeRates.coverage]);
    const filled = new PriceFill(ledgerRows, assets, targetDate, coverage).build([...recorded, ...real]);
    const provisionalCount = filled.observations.filter(({ isProvisional }) => isProvisional).length;
    if (provisionalCount > 0) {
      PortfolioData.log.warning("gatherMissingPrices_", `${provisionalCount} days have no price from any source and are recorded as provisional.`);
    }

    PortfolioData.log.throwIfAny(
      "gatherMissingPrices_",
      [...prices.errors, ...exchangeRates.errors],
      (errors) => `Portfolio Data was not written: ${errors.join(" ")}`
    );

    return {
      observations: [...real, ...filled.observations],
      priceCount: prices.observations.length,
      fxCount: exchangeRates.observations.length,
      carriedCount: filled.observations.length - provisionalCount,
      provisionalCount
    };
  }

  restateHistory_(computed, stored) {
    return Logger.runStep(PortfolioData.sheetName, () => this.restate_(computed, stored));
  }

  appendNewValuations_(computed, stored) {
    const { newValuations, changed } = PortfolioData.reconcile(stored, computed);
    if (changed.length > 0) {
      PortfolioData.log.warning("appendNewValuations_", `${changed.length} stored rows no longer match the ledger, so nothing is written.`);
      throw new Error(
        `Portfolio Data is locked, and ${PortfolioData.describeChanges(changed)}. ` +
          "Nothing was written. If history should change, run Rebuild from Transactions."
      );
    }

    Logger.runStep(PortfolioData.sheetName, () => this.append_(newValuations));

    PortfolioData.log.information(
      "appendNewValuations_",
      newValuations.length === 0 ? "There were no new rows to add to Portfolio Data." : `Added ${newValuations.length} new rows to Portfolio Data.`
    );

    return {
      valuations: [...stored, ...newValuations.map((valuation) => PortfolioData.toStored(valuation))],
      rowsWritten: newValuations.length
    };
  }

  append_(valuations) {
    const recordedAt = new Date();
    SheetTable.appendRows(
      this.getSheet_(),
      valuations.map((valuation) => PortfolioData.toRecordedRow_(valuation, recordedAt)),
      PortfolioData.headers,
      PortfolioData.sheetName
    );
    this.wrapAssets_();
  }

  restate_(valuations, stored) {
    const keptCount = PortfolioData.countUnchanged_(this.getSheet_(), valuations, stored);
    const isUnchanged = keptCount === valuations.length && keptCount === stored.length;
    if (isUnchanged) {
      PortfolioData.log.information("restate_", `All ${keptCount} rows already match, so none were written.`);
    } else {
      PortfolioData.log.information(
        "restate_",
        `Keeping the first ${keptCount} rows, which are unchanged, and writing the other ${valuations.length - keptCount}.`
      );
      this.writeRows_(valuations.slice(keptCount), keptCount);
    }

    this.wrapAssets_();

    return {
      valuations: [...stored.slice(0, keptCount), ...valuations.slice(keptCount).map((valuation) => PortfolioData.toStored(valuation))],
      rowsWritten: isUnchanged ? 0 : valuations.length - keptCount
    };
  }

  static countUnchanged_(sheet, valuations, stored) {
    if (sheet.getLastRow() - 1 !== stored.length) return 0;
    let count = 0;
    while (count < stored.length && count < valuations.length && PortfolioData.doRowsAgree(stored[count], valuations[count])) {
      count += 1;
    }

    return count;
  }

  static toStored(valuation) {
    return PortfolioData.parseRow_(PortfolioData.toRow_(valuation));
  }

  wrapAssets_() {
    const sheet = this.getSheet_();
    const assets = sheet.getRange(2, PortfolioData.columns.indexOf("asset") + 1, sheet.getLastRow() - 1, 1);
    SheetTable.ignoreTypedColumns(() => assets.setWrap(true));
  }

  /**
   * Sheets names the columns of a copied table "Column 1", "Column 2" and so on, so the header row is written back, and the copy is then compared
   * with the sheet, cell for cell.
   */
  backUp() {
    const sheet = this.spreadsheet.getSheetByName(PortfolioData.sheetName);
    if (!sheet || sheet.getLastRow() <= 1) {
      PortfolioData.log.information("backUp", "Portfolio Data has no rows, so nothing was copied.");
      return null;
    }

    const name = `${PortfolioData.sheetName} backup ${Dates.format(new Date(), "yyyy-MM-dd HH-mm-ss")}`;
    let copyName = name;
    for (let copies = 2; this.spreadsheet.getSheetByName(copyName); copies += 1) {
      copyName = `${name} (${copies})`;
    }

    const copy = sheet.copyTo(this.spreadsheet);
    copy.setName(copyName);
    PortfolioData.restoreHeaders_(sheet, copy);
    PortfolioData.verifyCopy_(sheet, copy, copyName);

    PortfolioData.log.information("backUp", `Copied Portfolio Data (${sheet.getLastRow() - 1} rows) to "${copyName}".`);

    return copyName;
  }

  static restoreHeaders_(sheet, copy) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues();
    const copied = copy.getRange(1, 1, 1, headers[0].length);
    if (JSON.stringify(copied.getValues()) === JSON.stringify(headers)) return;
    PortfolioData.log.warning("restoreHeaders_", "The copy lost its column names, so they are restored.");
    SheetTable.setValues(copied, headers);
  }

  static verifyCopy_(sheet, copy, copyName) {
    const readContents = (book) => JSON.stringify(book.getRange(1, 1, book.getLastRow(), book.getLastColumn()).getValues());

    if (readContents(sheet) !== readContents(copy)) {
      const message = `The copy "${copyName}" does not match Portfolio Data, so nothing was changed. Delete the copy and run it again.`;
      PortfolioData.log.error("verifyCopy_", message);
      throw new Error(message);
    }
  }

  getSheet_() {
    if (this.sheet) return this.sheet;

    const existing = this.spreadsheet.getSheetByName(PortfolioData.sheetName);
    this.sheet = existing || this.spreadsheet.insertSheet(PortfolioData.sheetName);

    if (this.sheet.getLastRow() > 0) {
      SheetTable.verifyHeaders(this.sheet, PortfolioData.sheetName, PortfolioData.headers);
    }

    return this.sheet;
  }

  writeRows_(valuations, keptCount) {
    const recordedAt = new Date();
    const rows = valuations.map((valuation) => PortfolioData.toRecordedRow_(valuation, recordedAt));
    const sheet = this.getSheet_();
    const { headers, sheetName } = PortfolioData;
    const isNew = sheet.getLastRow() === 0;
    const firstRow = 2 + keptCount;
    if (!isNew && sheet.getMaxRows() >= firstRow) {
      sheet.getRange(firstRow, 1, sheet.getMaxRows() - firstRow + 1, sheet.getMaxColumns()).clearContent();
    }

    SheetTable.ensureSize(sheet, firstRow + rows.length - 1, headers.length);

    if (isNew) {
      SheetTable.setValues(sheet.getRange(1, 1, 1, headers.length), [headers]);
      SheetTable.ignoreTypedColumns(() => sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground(SheetStyle.headerShading));
      sheet.setFrozenRows(1);
    }

    if (rows.length > 0) {
      SheetTable.setValues(sheet.getRange(firstRow, 1, rows.length, headers.length), rows);
    }

    SheetTable.confirmDates(sheet, firstRow, rows, headers, sheetName);
    if (isNew) sheet.autoResizeColumns(1, headers.length);
  }

  static readValuationsIn_(sheet) {
    return SheetTable.readRows(sheet, PortfolioData.headers.length)
      .map((row, index) => ({ row, number: index + 2 }))
      .filter(({ row }) => row[1] !== "")
      .map(({ row, number }) => {
        const valuation = PortfolioData.parseRow_(row);
        if (!(valuation.date instanceof Date)) {
          throw new Error(
            `${PortfolioData.sheetName} row ${number} (${valuation.asset}) has no valid date ` +
              `(it holds "${row[0]}"), so nothing was done: any rebuild would leave that day out. ` +
              "Restore the dates, for example from a backup copy of the sheet."
          );
        }

        return valuation;
      });
  }

  static toRow_(valuation) {
    return PortfolioData.columns.map((column) => valuation[column]);
  }

  /**
   * The Date column holds the valuation day with the time of day it was recorded. Everywhere else a valuation is a whole day, so the time is dropped
   * on reading and the stored rows still match the computed ones.
   */
  static toRecordedRow_(valuation, recordedAt) {
    const row = PortfolioData.toRow_(valuation);
    row[0] = Dates.withTimeOf(valuation.date, recordedAt);
    return row;
  }

  static parseRow_(row) {
    const valuation = Object.fromEntries(PortfolioData.columns.map((column, index) => [column, row[index]]));

    if (typeof valuation.date === "number") valuation.date = Dates.fromSerial(valuation.date);
    else if (valuation.date instanceof Date) valuation.date = Dates.getStartOfDay(valuation.date);
    valuation.asset = String(valuation.asset);
    valuation.currency = String(valuation.currency);

    for (const column of PortfolioData.figureColumns) {
      valuation[column] = Numbers.toNumber(valuation[column]);
    }

    valuation.isProvisional = SheetTable.isTicked(valuation.isProvisional);

    return valuation;
  }

  static isUsableObservation(observation) {
    return observation.close > 0;
  }

  static buildRecordedObservations(valuations, assets) {
    const observations = [];
    const recordedRates = new Set();

    for (const valuation of valuations) {
      const asset = assets.get(valuation.asset);
      if (!asset || Assets.isValued(asset)) continue;

      const currency = PortfolioData.getRecordedCurrency_(valuation, asset);
      observations.push({
        date: valuation.date,
        asset: valuation.asset,
        currency,
        close: valuation.localUnitValue,
        isProvisional: valuation.isProvisional
      });

      // Rows of one currency on one day share its rate; a row that differs is kept, so that the disagreement is reported rather than one of the rates
      // being chosen.
      const rateKey = `${currency}|${Dates.toDayKey(valuation.date)}|${valuation.exchangeRate}`;
      if (!Currencies.isForeign(currency) || recordedRates.has(rateKey)) continue;

      recordedRates.add(rateKey);
      observations.push({
        date: valuation.date,
        asset: Currencies.getFxAssetName(currency),
        currency: Currencies.pounds,
        close: valuation.exchangeRate
      });
    }

    return observations.filter((observation) => PortfolioData.isUsableObservation(observation));
  }

  /**
   * A row stored before the Currency column was added has it worked out: an asset with no quote is valued in pounds, and a sterling price is in pence
   * if the row was valued at a hundredth.
   */
  static getRecordedCurrency_(valuation, asset) {
    if (valuation.currency) return valuation.currency;
    if (!Assets.hasMarketPrice(asset)) return Currencies.pounds;
    if (!Currencies.isSterling(asset.currency)) return asset.currency;
    const isPence = Numbers.isNearlyEqual(valuation.exchangeRate, Currencies.getSterlingFactor(Currencies.pence));
    return isPence ? Currencies.pence : Currencies.pounds;
  }

  static reconcile(stored, computed) {
    const computedByKey = new Map(computed.map((valuation) => [PortfolioData.buildKey_(valuation), valuation]));

    const changed = stored
      .filter((valuation) => {
        const match = computedByKey.get(PortfolioData.buildKey_(valuation));
        return !match || !PortfolioData.haveSameFigures_(valuation, match);
      })
      .map(({ asset, date }) => ({ asset, date }));

    const storedKeys = new Set(stored.map((valuation) => PortfolioData.buildKey_(valuation)));
    const newValuations = computed
      .filter((valuation) => !storedKeys.has(PortfolioData.buildKey_(valuation)))
      .sort((left, right) => left.date - right.date || left.asset.localeCompare(right.asset));

    return { newValuations, changed };
  }

  static doRowsAgree(stored, computed) {
    return (
      PortfolioData.buildKey_(stored) === PortfolioData.buildKey_(computed) &&
      stored.currency === computed.currency &&
      stored.isProvisional === computed.isProvisional &&
      PortfolioData.haveSameFigures_(stored, computed)
    );
  }

  static describeChanges(changed) {
    const first = changed[0];
    return (
      `${changed.length} stored row(s) no longer match the transactions and prices ` +
      `(the first is ${first.asset} on ${Dates.formatDisplay(first.date)})`
    );
  }

  static buildKey_(valuation) {
    return `${Dates.toDayKey(valuation.date)}|${valuation.asset}`;
  }

  static haveSameFigures_(stored, computed) {
    return PortfolioData.figureColumns.every((column) => {
      const left = Number(stored[column]);
      const right = Number(computed[column]);
      return Math.abs(left - right) <= 0.0000001 * Math.max(1, Math.abs(left), Math.abs(right));
    });
  }
}
