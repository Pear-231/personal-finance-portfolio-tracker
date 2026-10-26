class Currencies {
  static get sheetName() {
    return "Currencies";
  }

  static get pounds() {
    return "GBP";
  }

  static get pence() {
    return "GBX";
  }

  static get penceInPound() {
    return 100;
  }

  static get usDollars() {
    return "USD";
  }

  static get euros() {
    return "EUR";
  }

  static get newZealandDollars() {
    return "NZD";
  }

  static get foreign() {
    return [Currencies.usDollars, Currencies.euros, Currencies.newZealandDollars];
  }

  static get fxAssetSuffix() {
    return " FX";
  }

  static buildRateLookup(currencyCell) {
    const { sheetName } = Currencies;
    return `XLOOKUP(${currencyCell},${sheetName}!$A:$A,${sheetName}!$B:$B)`;
  }

  static isSterling(currency) {
    return currency === Currencies.pounds || currency === Currencies.pence;
  }

  static isForeign(currency) {
    return Currencies.foreign.includes(currency);
  }

  static isSupported(currency) {
    return Currencies.isSterling(currency) || Currencies.isForeign(currency);
  }

  static getSterlingFactor(currency) {
    if (currency === Currencies.pounds) return 1;
    if (currency === Currencies.pence) return 1 / Currencies.penceInPound;
    return null;
  }

  static getFxAssetName(currency) {
    return `${currency}/${Currencies.pounds}${Currencies.fxAssetSuffix}`;
  }

  static getFxSeries(currency) {
    if (!Currencies.isForeign(currency)) return null;
    return {
      asset: Currencies.getFxAssetName(currency),
      yahooSymbol: `${currency}${Currencies.pounds}=X`
    };
  }

  static isUnconvertible(quotedCurrency, assetCurrency) {
    if (!quotedCurrency || !assetCurrency || quotedCurrency === assetCurrency) return false;
    return !(Currencies.isSterling(quotedCurrency) && Currencies.isSterling(assetCurrency));
  }

  static convertPrice(price, quotedCurrency, assetCurrency) {
    if (quotedCurrency === Currencies.pence && assetCurrency === Currencies.pounds) {
      return price / Currencies.penceInPound;
    }

    if (quotedCurrency === Currencies.pounds && assetCurrency === Currencies.pence) {
      return price * Currencies.penceInPound;
    }

    return price;
  }
}
