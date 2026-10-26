class Assets {
  static get sheetName() {
    return "Assets";
  }

  static get assetNameHeader() {
    return "Asset Name";
  }

  static get assetTypeHeader() {
    return "Asset Type";
  }

  static get googleFinanceTickerHeader() {
    return "Google Finance Ticker";
  }

  static get yahooFinanceTickerHeader() {
    return "Yahoo Finance Ticker";
  }

  static get customIdentifierHeader() {
    return "Custom Identifier";
  }

  static get currentQuantityHeader() {
    return "Current Quantity";
  }

  static get currencyHeader() {
    return "Currency";
  }

  static get currentLocalValueHeader() {
    return "Current Local Value";
  }

  static get cachedLocalValueHeader() {
    return "Cached Local Value";
  }

  static get cachedLocalValueTimeHeader() {
    return "Cached Local Value Date";
  }

  static get valuationDateHeader() {
    return "Valuation Date";
  }

  static get isShortHeader() {
    return "Is Short";
  }

  static get leverageHeader() {
    return "Leverage";
  }

  static get couponPercentageHeader() {
    return "Coupon (%)";
  }

  static get couponsPerYearHeader() {
    return "Coupons per Year";
  }

  static get maturityDateHeader() {
    return "Maturity Date";
  }

  static get bondTermHeaders() {
    return [Assets.couponPercentageHeader, Assets.couponsPerYearHeader, Assets.maturityDateHeader];
  }

  static get headers() {
    return [
      Assets.assetNameHeader,
      Assets.assetTypeHeader,
      Assets.googleFinanceTickerHeader,
      Assets.yahooFinanceTickerHeader,
      Assets.customIdentifierHeader,
      Assets.currentQuantityHeader,
      Assets.currencyHeader,
      Assets.currentLocalValueHeader,
      Assets.valuationDateHeader,
      Assets.isShortHeader,
      Assets.leverageHeader,
      ...Assets.bondTermHeaders
    ];
  }

  static get requiredHeaders() {
    return Assets.headers.filter((header) => !Assets.bondTermHeaders.includes(header));
  }

  constructor(spreadsheet) {
    this.sheet = SheetTable.openRequired(spreadsheet, Assets.sheetName);
  }

  readColumnLetters() {
    const { sheet } = this;
    const headers = SheetTable.readHeaderRow(sheet);
    const findLetter = (header) => SheetTable.getColumnLetter(headers.indexOf(header));
    return {
      name: findLetter(Assets.assetNameHeader),
      quantity: findLetter(Assets.currentQuantityHeader),
      currency: findLetter(Assets.currencyHeader),
      price: findLetter(Assets.currentLocalValueHeader),
      valuationDate: findLetter(Assets.valuationDateHeader)
    };
  }

  static buildLookup(letters, column, nameCell) {
    const { name } = letters;
    return `XLOOKUP(${nameCell},Assets!$${name}:$${name},Assets!$${letters[column]}:$${letters[column]})`;
  }

  read() {
    const { sheet } = this;
    const headers = SheetTable.readHeaderRow(sheet);
    const columnOf = new Map(headers.map((header, index) => [header, index]));
    const missing = Assets.requiredHeaders.filter((header) => !columnOf.has(header));
    if (missing.length > 0) {
      throw new Error(`Assets is missing required metadata: ${missing.join(", ")}.`);
    }

    const rows = SheetTable.readRows(sheet);

    const readCells = (row) => (header) => {
      return columnOf.has(header) ? row[columnOf.get(header)] : "";
    };

    const assetRows = rows.map(readCells).filter((cell) => cell(Assets.assetNameHeader) !== "");
    Assets.checkCurrencies_(assetRows);
    Assets.checkBondTerms_(assetRows);
    return new Map(assetRows.map((cell) => [String(cell(Assets.assetNameHeader)), Assets.parseAsset_(cell)]));
  }

  cacheCurrentPrices(time) {
    const { sheet } = this;
    const assets = this.read();
    const headers = SheetTable.readHeaderRow(sheet);
    const columnOf = new Map(headers.map((header, index) => [header, index]));
    const cachedValueColumn = columnOf.get(Assets.cachedLocalValueHeader);
    const cachedTimeColumn = columnOf.get(Assets.cachedLocalValueTimeHeader);
    if (cachedValueColumn === undefined || cachedTimeColumn === undefined) {
      throw new Error(`Assets is missing required price cache columns: ${Assets.cachedLocalValueHeader}, ${Assets.cachedLocalValueTimeHeader}.`);
    }

    const priceColumn = columnOf.get(Assets.currentLocalValueHeader);
    const nameColumn = columnOf.get(Assets.assetNameHeader);
    const rowCount = Math.max(sheet.getLastRow() - 1, 0);
    if (rowCount === 0) return;

    const names = sheet.getRange(2, nameColumn + 1, rowCount, 1).getValues();
    const prices = sheet.getRange(2, priceColumn + 1, rowCount, 1).getValues();
    const cached = sheet.getRange(2, cachedValueColumn + 1, rowCount, 2).getValues();

    for (let index = 0; index < rowCount; index += 1) {
      const asset = assets.get(String(names[index][0]));
      const price = prices[index][0];
      if (!asset || price === "" || price === null || !Number.isFinite(Number(price))) continue;
      cached[index] = [Number(price), time];
    }

    SheetTable.setValues(sheet.getRange(2, cachedValueColumn + 1, rowCount, 2), cached);
  }

  static checkCurrencies_(assetRows) {
    const unsupported = assetRows
      .filter((cell) => String(cell(Assets.currencyHeader)) !== "" && !Currencies.isSupported(String(cell(Assets.currencyHeader))))
      .map((cell) => `${cell(Assets.assetNameHeader)} (${cell(Assets.currencyHeader)})`);

    if (unsupported.length > 0) {
      throw new Error(
        `Assets uses a currency the workbook cannot convert: ${unsupported.join(", ")}. Use GBP, GBX, ${Currencies.foreign.join(", ")}.`
      );
    }
  }

  static checkBondTerms_(assetRows) {
    const incomplete = assetRows
      .filter((cell) => Numbers.toNumber(cell(Assets.couponPercentageHeader)) > 0)
      .filter(
        (cell) =>
          !Assets.frequencies.includes(Numbers.toNumber(cell(Assets.couponsPerYearHeader))) || !(cell(Assets.maturityDateHeader) instanceof Date)
      )
      .map((cell) => cell(Assets.assetNameHeader));

    if (incomplete.length > 0) {
      throw new Error(
        `Assets needs Coupons per Year (${Assets.frequencies.join(", ")}) and a Maturity ` +
          `Date for the bond with a Coupon (%): ${incomplete.join(", ")}.`
      );
    }

    const notPercentages = assetRows
      .filter((cell) => Numbers.toNumber(cell(Assets.couponPercentageHeader)) >= 1)
      .map((cell) => cell(Assets.assetNameHeader));

    if (notPercentages.length > 0) {
      throw new Error(
        "Assets has a Coupon (%) of 100% or more, which is probably a plain number: format the " +
          `cell as a percentage and enter 4.25% for 4.25%: ${notPercentages.join(", ")}.`
      );
    }
  }

  static parseAsset_(cell) {
    return {
      assetType: String(cell(Assets.assetTypeHeader) || ""),
      currency: String(cell(Assets.currencyHeader) || ""),
      isShort: SheetTable.isTicked(cell(Assets.isShortHeader)),
      leverage: Numbers.toNumber(cell(Assets.leverageHeader)) || 1,
      ticker: String(cell(Assets.googleFinanceTickerHeader) || cell(Assets.yahooFinanceTickerHeader) || ""),
      yahooTicker: String(cell(Assets.yahooFinanceTickerHeader) || "").trim(),
      customIdentifier: String(cell(Assets.customIdentifierHeader) || "").trim(),
      currentValue: Numbers.toNumber(cell(Assets.currentLocalValueHeader)),
      couponRate: Numbers.toNumber(cell(Assets.couponPercentageHeader)),
      couponsPerYear: Numbers.toNumber(cell(Assets.couponsPerYearHeader)),
      maturityDate: cell(Assets.maturityDateHeader) instanceof Date ? cell(Assets.maturityDateHeader) : null
    };
  }

  static isDerivative(asset) {
    return asset.isShort || asset.leverage !== 1;
  }

  static hasMarketPrice(asset) {
    if (asset.customIdentifier) return true;

    if ([AssetTypes.cash, AssetTypes.options, AssetTypes.otherAssets].includes(asset.assetType)) return false;

    return !(asset.assetType === AssetTypes.bonds && !asset.ticker);
  }

  static isDatedValuation(asset) {
    return asset.assetType === AssetTypes.otherAssets;
  }

  static isValued(asset) {
    return [AssetTypes.cash, AssetTypes.otherAssets].includes(asset.assetType);
  }

  static get frequencies() {
    return [1, 2, 3, 4, 6, Dates.monthsInYear];
  }

  static hasTerms(asset) {
    return asset.couponRate > 0;
  }

  static findPeriodAround(asset, date) {
    if (!Assets.hasTerms(asset)) return null;
    const day = Dates.getStartOfDay(date);
    const maturity = Dates.getStartOfDay(asset.maturityDate);
    if (day >= maturity) return null;
    const stepMonths = Dates.monthsInYear / asset.couponsPerYear;
    let next = maturity;

    for (let steps = 1; ; steps += 1) {
      const last = Assets.subtractMonths_(maturity, steps * stepMonths);
      if (last <= day) return { last, next };
      next = last;
      if (steps > 600) return null;
    }
  }

  static subtractMonths_(date, months) {
    const target = new Date(date.getFullYear(), date.getMonth() - months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
  }

  static calculatePerUnit(asset, date) {
    const period = Assets.findPeriodAround(asset, date);
    if (!period) return 0;
    return (
      (asset.couponRate / asset.couponsPerYear) *
      (Dates.countDaysBetween(period.last, Dates.getStartOfDay(date)) / Dates.countDaysBetween(period.last, period.next))
    );
  }

  static findNearestCouponDate(asset, date) {
    if (!Assets.hasTerms(asset)) return null;
    const day = Dates.getStartOfDay(date);
    const maturity = Dates.getStartOfDay(asset.maturityDate);
    if (day >= maturity) return maturity;
    const period = Assets.findPeriodAround(asset, date);
    if (!period) return null;
    return day - period.last <= period.next - day ? period.last : period.next;
  }

  static calculateCouponPerUnit(asset) {
    return asset.couponRate / asset.couponsPerYear;
  }
}
