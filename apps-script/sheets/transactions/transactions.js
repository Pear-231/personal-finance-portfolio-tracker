class Transactions {
  static get sheetName() {
    return "Transactions";
  }

  static get dateHeader() {
    return "Date";
  }

  static get assetHeader() {
    return "Asset";
  }

  static get assetTypeHeader() {
    return "Asset Type";
  }

  static get transactionTypeHeader() {
    return "Transaction Type";
  }

  static get providerHeader() {
    return "Provider";
  }

  static get detailsHeader() {
    return "Details";
  }

  static get quantityHeader() {
    return "Quantity";
  }

  static get exDateHeader() {
    return "Ex-Date";
  }

  static get currencyHeader() {
    return "Currency";
  }

  static get exchangeRateHeader() {
    return "Exchange Rate";
  }

  static get localUnitValueHeader() {
    return "Local Unit Value";
  }

  static get localValueHeader() {
    return "Local Value";
  }

  static get valueHeader() {
    return "Value (£)";
  }

  static get feesHeader() {
    return "Fees (£)";
  }

  static get headers() {
    return [
      Transactions.dateHeader,
      Transactions.assetHeader,
      Transactions.assetTypeHeader,
      Transactions.transactionTypeHeader,
      Transactions.providerHeader,
      Transactions.detailsHeader,
      Transactions.quantityHeader,
      Transactions.exDateHeader,
      Transactions.currencyHeader,
      Transactions.exchangeRateHeader,
      Transactions.localUnitValueHeader,
      Transactions.localValueHeader,
      Transactions.valueHeader,
      Transactions.feesHeader
    ];
  }

  static get accruedInterestHeader() {
    return "Accrued Interest (£)";
  }

  static get idHeader() {
    return "ID";
  }

  static get optionalFields() {
    return new Map([
      [Transactions.accruedInterestHeader, "accruedInterest"],
      [Transactions.idHeader, "positionId"]
    ]);
  }

  static get optionalHeaders() {
    return [...Transactions.optionalFields.keys()];
  }

  static get log() {
    return Logger.create("Sheets.Transactions.Transactions");
  }

  constructor(spreadsheet) {
    this.spreadsheet = spreadsheet;
    this.sheet = SheetTable.openRequired(spreadsheet, Transactions.sheetName, Transactions.headers);
  }

  read() {
    if (this.sheet.getLastRow() < 2) return [];
    const columns = this.findOptionalColumns_();
    const width = Math.max(Transactions.headers.length, columns.accruedInterest + 1, columns.positionId + 1);
    return SheetTable.readRows(this.sheet, width)
      .map((row, index) => Transactions.parseRow(row, index + 2, columns))
      .filter((transaction) => transaction !== null);
  }

  validate(transactions, assets) {
    const allowed = new TransactionTypes(this.spreadsheet).read();
    Transactions.log.throwIfAny("validate", Transactions.findTypeErrors(transactions, assets, allowed), Transactions.describeTypeErrors);

    Transactions.log.information(
      "validate",
      `All ${transactions.length} transactions have a transaction type that is allowed for their asset type, by ${TransactionTypes.sheetName}.`
    );
  }

  static findTypeErrors(transactions, assets, allowed) {
    return transactions.map((transaction) => Transactions.findTypeError_(transaction, assets, allowed)).filter((error) => error !== null);
  }

  static findTypeError_(transaction, assets, allowed) {
    const { sourceRow, asset, transactionType } = transaction;
    const row = `Transactions row ${sourceRow}`;
    const assetType = assets.get(asset)?.assetType || transaction.assetType;

    if (!allowed.has(transactionType)) {
      return `${row}: "${transactionType}" is not listed in ${TransactionTypes.sheetName}.`;
    }

    if (!assetType) return `${row}: ${asset} is not in Assets and the row gives no Asset Type.`;
    if (allowed.get(transactionType).has(assetType)) return null;

    const permitted = [...allowed.get(transactionType)].join(", ") || "no asset type";
    return `${row}: ${transactionType} is not allowed for ${asset}, which is ${assetType} (${transactionType} is for ${permitted}).`;
  }

  static describeTypeErrors(errors) {
    return (
      `${errors.length} transaction row(s) have a transaction type that is not allowed for ` +
      `their asset type, so nothing was changed:\n${Logger.buildPreview(errors)}`
    );
  }

  findOptionalColumns_() {
    const first = Transactions.headers.length;
    const columns = { accruedInterest: -1, positionId: -1 };

    if (this.sheet.getMaxColumns() <= first) return columns;

    const headers = this.sheet.getRange(1, first + 1, 1, this.sheet.getMaxColumns() - first).getDisplayValues()[0];

    for (let offset = 0; offset < headers.length; offset += 1) {
      const value = headers[offset];
      const header = String(value).trim();
      if (header === "") continue;

      const index = first + offset;
      const field = Transactions.optionalFields.get(header);
      if (field === undefined || columns[field] >= 0) {
        throw new Error(
          `Transactions column ${SheetTable.getColumnLetter(index)}, after Fees (£), is headed ` +
            `"${header}", but only ${Transactions.optionalHeaders.map((optional) => `"${optional}"`).join(" and ")} ` +
            "may follow it, once each. Rename or remove it."
        );
      }

      columns[field] = index;
    }

    return columns;
  }

  static parseRow(row, sourceRow, columns) {
    const [
      date,
      asset,
      assetType,
      transactionType,
      _provider,
      details,
      quantity,
      exDate,
      currency,
      exchangeRate,
      localUnitValue,
      localValue,
      value,
      fees
    ] = row;

    if (row.every((value) => value === "" || value === null)) return null;

    if (!asset || !(date instanceof Date) || !transactionType) {
      throw new Error(`Transactions row ${sourceRow} must contain Asset, Date and Transaction Type.`);
    }

    const rawQuantity = Numbers.toNumber(quantity);
    if (rawQuantity < 0) {
      throw new Error(`Transactions row ${sourceRow} Quantity must be zero or positive; Transaction Type determines direction.`);
    }

    return {
      sourceRow,
      asset,
      date,
      assetType: assetType || "",
      transactionType,
      details: details || "",
      currency: currency || "",
      quantity: rawQuantity,
      value,
      fees,
      exchangeRate,
      localUnitValue,
      localValue,
      exDate: exDate instanceof Date ? exDate : null,
      accruedInterest: columns.accruedInterest >= 0 ? row[columns.accruedInterest] : 0,
      positionId: columns.positionId >= 0 ? String(row[columns.positionId] || "").trim() : ""
    };
  }
}
