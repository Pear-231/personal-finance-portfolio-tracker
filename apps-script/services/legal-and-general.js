class LegalAndGeneral {
  static get log() {
    return Logger.create("Shared.Services.LegalAndGeneral");
  }

  /**
   * A fund page gives the exact price in pence, once a day. Its address is
   * https://fundcentres.landg.com/en/uk/workplace-adviser/fund-centre/<fund>/?isin_code=<ISIN>
   */
  static parsePage(identifier) {
    const text = String(identifier || "").trim();
    const page = text.match(/fundcentres\.landg\.com\/[^?]*\/([^/?#]+)\/?\?[^#]*isin_code=([A-Z0-9]{12})/i);
    return page ? { pageName: page[1], isin: page[2].toUpperCase() } : null;
  }

  static isFundPage(identifier) {
    return LegalAndGeneral.parsePage(identifier) !== null;
  }

  static fetchPrice(identifier) {
    const fund = LegalAndGeneral.parsePage(identifier);
    if (!fund) {
      throw LegalAndGeneral.log.createFailure("fetchPrice", "The Custom Identifier is not the address of a Legal & General fund page.");
    }

    return HttpFetch.remember(`legal-and-general-price-${fund.isin}`, () => LegalAndGeneral.fetchFund_(fund));
  }

  static fetchFund_(fund) {
    const url = `https://fundcentres.landg.com/en/uk/workplace-adviser/fund-centre/${fund.pageName}/?isin_code=${fund.isin}`;

    const response = HttpFetch.get(`The Legal & General request for ${fund.isin}`, url, HttpFetch.cellFunctionSettings);

    if (response.getResponseCode() !== HttpFetch.successStatus) {
      throw LegalAndGeneral.log.createFailure("fetchFund_", `Legal & General answered with HTTP ${response.getResponseCode()}.`);
    }

    const price = LegalAndGeneral.parsePrice_(response.getContentText(), fund.isin);
    if (price === null) {
      throw LegalAndGeneral.log.createFailure("fetchFund_", `Legal & General's page has no price for ${fund.isin}; it may have changed.`);
    }

    LegalAndGeneral.log.information("fetchFund_", `${fund.isin}: price ${price}p.`);
    return price;
  }

  /**
   * The page lists every share class of the fund; the ISIN gives the share-class id, and the price ribbon has one row per share-class id.
   */
  static parsePrice_(page, isin) {
    const shareClass = page.match(new RegExp(`data-value="(\\d+)" data-isin="${isin}"`));
    if (!shareClass) return null;
    const shareClassId = shareClass[1];
    const rowStart = `data-shareclass-id="${shareClassId}" class="FundRibbonPrices-row shareclass-row">`;

    const row = page.match(new RegExp(`${rowStart}(.*?)</div></div>`, "s"));
    if (!row) return null;
    const price = row[1].match(/<strong>([\d,.]+)p<\/strong>/);
    return price ? Number(price[1].replace(/,/g, "")) : null;
  }
}
