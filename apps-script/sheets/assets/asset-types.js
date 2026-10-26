class AssetTypes {
  static get cash() {
    return "Cash";
  }

  static get stocks() {
    return "Stocks";
  }

  static get bonds() {
    return "Bonds";
  }

  static get commodities() {
    return "Commodities";
  }

  static get forex() {
    return "Forex";
  }

  static get options() {
    return "Options";
  }

  static get otherAssets() {
    return "Other Assets";
  }

  static get pension() {
    return "Pension";
  }

  static get all() {
    return [
      AssetTypes.cash,
      AssetTypes.stocks,
      AssetTypes.bonds,
      AssetTypes.commodities,
      AssetTypes.forex,
      AssetTypes.options,
      AssetTypes.otherAssets,
      AssetTypes.pension
    ];
  }

  static get notInMarket() {
    return [AssetTypes.cash, AssetTypes.otherAssets, AssetTypes.pension];
  }
}
