class TransactionTypes {
  static get sheetName() {
    return "Transaction Types";
  }

  static get purchase() {
    return "Purchase";
  }

  static get employeeContribution() {
    return "Employee Contribution";
  }

  static get employerContribution() {
    return "Employer Contribution";
  }

  static get switchIn() {
    return "Switch In";
  }

  static get sale() {
    return "Sale";
  }

  static get switchOut() {
    return "Switch Out";
  }

  static get managementCharge() {
    return "Management Charge";
  }

  static get dividend() {
    return "Dividend";
  }

  static get coupon() {
    return "Coupon";
  }

  static get interest() {
    return "Interest";
  }

  static get ernie() {
    return "Ernie";
  }

  static get stockSplit() {
    return "Stock Split";
  }

  static get valuation() {
    return "Valuation";
  }

  static get purchaseTypes() {
    return [TransactionTypes.purchase, TransactionTypes.employeeContribution, TransactionTypes.employerContribution, TransactionTypes.switchIn];
  }

  static get saleTypes() {
    return [TransactionTypes.sale, TransactionTypes.switchOut];
  }

  static get all() {
    return [
      ...TransactionTypes.purchaseTypes,
      ...TransactionTypes.saleTypes,
      TransactionTypes.managementCharge,
      TransactionTypes.dividend,
      TransactionTypes.coupon,
      TransactionTypes.interest,
      TransactionTypes.ernie,
      TransactionTypes.stockSplit,
      TransactionTypes.valuation
    ];
  }

  static get typeHeader() {
    return "Transaction Type";
  }

  static getColumnHeader(assetType) {
    return `Is ${assetType} Transaction`;
  }

  constructor(spreadsheet) {
    this.sheet = SheetTable.openRequired(spreadsheet, TransactionTypes.sheetName, [TransactionTypes.typeHeader]);
  }

  read() {
    const { sheet } = this;
    const headers = SheetTable.readHeaderRow(sheet).map((header) => String(header).trim());
    const missing = AssetTypes.all.filter((assetType) => !headers.includes(TransactionTypes.getColumnHeader(assetType)));

    if (missing.length > 0) {
      throw new Error(
        `${TransactionTypes.sheetName} has no column headed ` +
          `"${TransactionTypes.getColumnHeader(missing[0])}". It needs one column for each asset ` +
          `type (${AssetTypes.all.join(", ")}), headed Is, the asset type and Transaction, ` +
          "with a checkbox ticked where the transaction type may be used on that asset type."
      );
    }

    const allowed = new Map();
    for (const row of SheetTable.readRows(sheet)) {
      const type = String(row[0]).trim();
      if (type === "") continue;

      if (allowed.has(type)) {
        throw new Error(`${TransactionTypes.sheetName} lists "${type}" more than once.`);
      }

      allowed.set(
        type,
        new Set(AssetTypes.all.filter((assetType) => SheetTable.isTicked(row[headers.indexOf(TransactionTypes.getColumnHeader(assetType))])))
      );
    }

    return allowed;
  }

  /** The quantity multiplier in a split's Details: "1:4" gives 4. */
  static getSplitRatio(details) {
    const match = String(details).match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
    return match ? Number(match[2]) / Number(match[1]) : null;
  }
}
