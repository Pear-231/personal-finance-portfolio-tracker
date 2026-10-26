class PortfolioMenu {
  static get title() {
    return "Portfolio";
  }

  static get items() {
    return [
      { label: "Rebuild from Transactions", functionName: "rebuildFromTransactions" },
      { label: "Record Portfolio Data", functionName: "recordPortfolioData" },
      { label: "Update Performance", functionName: "updatePerformance" },
      { label: "Refresh Prices", functionName: "refreshPrices", isQuiet: true }
    ];
  }

  static get log() {
    return Logger.create("Application.Menu.PortfolioMenu");
  }

  static run(action) {
    const item = PortfolioMenu.items.find(({ functionName }) => functionName === action.name);
    return Logger.run(item.label, () => PortfolioMenu.runAction_(action), {
      isQuiet: item.isQuiet
    });
  }

  static runAction_(action) {
    let result;

    try {
      result = action();
    } catch (error) {
      throw PortfolioMenu.addLocation_(error);
    }

    if (result) PortfolioMenu.log.information("run", result);
    return result;
  }

  static addLocation_(error) {
    if (!(error instanceof TypeError) && !(error instanceof ReferenceError)) return error;
    return new Error(`${error.message}${Logger.describeLocation(error, 4)}`);
  }

  static open() {
    const menu = SpreadsheetApp.getUi().createMenu(PortfolioMenu.title);
    for (const { label, functionName } of PortfolioMenu.items) menu.addItem(label, functionName);
    menu.addToUi();
  }

  static rebuildFromTransactions() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const log = PortfolioMenu.log;
    log.information("rebuildFromTransactions", "Copying Portfolio Data before anything else is done.");
    const backup = new PortfolioData(spreadsheet).backUp();

    log.information("rebuildFromTransactions", "Checking the transactions and loading the ledger.");
    const inputs = LedgerReplay.load(spreadsheet, { isValidated: true });

    log.information("rebuildFromTransactions", "Working out Portfolio Data from the ledger and the prices.");
    const update = new PortfolioData(spreadsheet).update(inputs, { isRestatement: true });

    log.information("rebuildFromTransactions", "Rebuilding the Portfolio sheet.");
    const portfolio = Portfolio.rebuild(spreadsheet, inputs, update.observations);

    log.information("rebuildFromTransactions", "Updating the Performance sheet.");
    const performance = Performance.update(spreadsheet, {
      assets: inputs.assets,
      storedValuations: update.valuations
    });

    return (
      `Rebuilt from transactions through ${Dates.formatDisplay(update.lastDate)}: ${update.priceCount} price ` +
      `and ${update.fxCount} FX observations added; ${PortfolioMenu.describeDataRows_(update)}.` +
      `${PortfolioData.describeProvisional(update.provisionalRowCount)} ` +
      `${PortfolioMenu.describeBackup_(backup)} ${portfolio} ${performance}`
    );
  }

  static describeDataRows_({ valuations, rowsWritten }) {
    const total = valuations.length;
    return rowsWritten === 0
      ? `all ${total} Portfolio Data rows already matched, so none were written`
      : `${rowsWritten} of ${total} Portfolio Data rows were written, the rest already matched`;
  }

  static describeBackup_(backup) {
    return backup
      ? `The sheet as it was is kept in "${backup}", to delete when you are happy.`
      : "No copy of Portfolio Data was made, as it had no rows.";
  }

  static refreshPrices() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const time = new Date();
    new Assets(spreadsheet).cacheCurrentPrices(time);
    Portfolio.openExisting(spreadsheet).recordRefreshTime(time);
  }

  static recordPortfolioData() {
    return PortfolioData.record(SpreadsheetApp.getActiveSpreadsheet());
  }

  static updatePerformance() {
    return Performance.update(SpreadsheetApp.getActiveSpreadsheet());
  }
}
