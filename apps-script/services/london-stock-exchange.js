class LondonStockExchange {
  static get log() {
    return Logger.create("Shared.Services.LondonStockExchange");
  }

  /**
   * An instrument's page contains its code, in the current form of the address, for example
   * https://www.londonstockexchange.com/en/quote/bonds/TR32/treasury-4-14-2032-gilt, or the earlier one,
   * https://www.londonstockexchange.com/stock/TR32/treasury-4-14-2032-gilt/company-page, which the site redirects to it.
   */
  static getTidm(identifier) {
    const text = String(identifier || "").trim();
    const page = text.match(/^https?:\/\/(?:www\.)?londonstockexchange\.com\/(?:stock|en\/quote\/[a-z-]+)\/([A-Z0-9]{2,6})\//i);
    return page ? page[1].toUpperCase() : null;
  }

  static isInstrumentPage(identifier) {
    return LondonStockExchange.getTidm(identifier) !== null;
  }

  static fetchPrice(identifier) {
    const tidm = LondonStockExchange.getTidm(identifier);
    if (!tidm) {
      throw LondonStockExchange.log.createFailure(
        "fetchPrice",
        "The Custom Identifier is not the full address of a London Stock Exchange page, such as " +
          "https://www.londonstockexchange.com/en/quote/bonds/TR32/treasury-4-14-2032-gilt"
      );
    }

    return HttpFetch.remember(`london-stock-exchange-price-${tidm}`, () => LondonStockExchange.fetchInstrument_(tidm));
  }

  static fetchInstrument_(tidm) {
    const response = HttpFetch.get(
      `The London Stock Exchange request for ${tidm}`,
      `https://apidata.londonstockexchange.com/instrument-summaries/v1?tidm=${tidm}`,
      {
        options: { headers: { Accept: "application/json" } },
        ...HttpFetch.cellFunctionSettings
      }
    );

    if (response.getResponseCode() !== HttpFetch.successStatus) {
      throw LondonStockExchange.log.createFailure("fetchInstrument_", `The London Stock Exchange answered with HTTP ${response.getResponseCode()}.`);
    }

    const price = LondonStockExchange.findPriceIn_(JSON.parse(response.getContentText()));
    if (price === null) {
      throw LondonStockExchange.log.createFailure("fetchInstrument_", `The London Stock Exchange has no price for ${tidm}.`);
    }

    LondonStockExchange.log.information("fetchInstrument_", `${tidm}: price ${price}.`);
    return price;
  }

  /** The summary lists the price as text, with thousands separators, and "-" when there is none. */
  static findPriceIn_(summary) {
    const price = Number(String(summary.Data?.[0]?.price ?? "").replace(/,/g, ""));
    return price > 0 ? price : null;
  }
}
