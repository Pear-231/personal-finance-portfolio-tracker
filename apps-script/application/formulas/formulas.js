/**
 * The latest Yahoo Finance price for a ticker, in the asset's currency (pence
 * for GBX, pounds for GBP). It accepts a Yahoo symbol or a Google Finance
 * ticker.
 *
 * @param {string} ticker The Yahoo Finance ticker, for example VGOV.L.
 * @param {string} currency The asset's currency, for example GBP, GBX or USD.
 * @param {*} refresh Any changing value, such as TODAY(), that makes the cell recalculate.
 * @return {number} The latest price, or an error if Yahoo quotes it in another currency.
 * @customfunction
 */
function YAHOO_FINANCE_PRICE(ticker, currency, refresh) {
  return YahooFinance.fetchPriceInCurrency(ticker, currency);
}

/**
 * The latest published price in pence of the asset named by its Custom Identifier (the address of its Legal & General fund page). A fund is priced
 * once a day, so this is not a live price.
 *
 * @param {string} identifier The Custom Identifier from Assets.
 * @param {*} refresh Any changing value, such as TODAY(), that makes the cell recalculate.
 * @return {number} The latest price, in pence.
 * @customfunction
 */
function LEGAL_AND_GENERAL_PRICE(identifier, refresh) {
  return LegalAndGeneral.fetchPrice(identifier);
}

/**
 * The latest price of an instrument on the London Stock Exchange, from the exchange's own data. A gilt is quoted per 100 of nominal, the same number
 * as pence per 1 of nominal, so give it the currency GBX in Assets.
 *
 * @param {string} identifier The Custom Identifier from Assets: the full address of the
 *   instrument's londonstockexchange.com page.
 * @param {*} refresh Any changing value, such as the time in Portfolio!A1, that makes the cell
 *   recalculate.
 * @return {number} The latest price.
 * @customfunction
 */
function LONDON_STOCK_EXCHANGE_PRICE(identifier, refresh) {
  return LondonStockExchange.fetchPrice(identifier);
}

/**
 * Custom function for the Transactions sheet's ID column. Type =UUID() in a cell
 * to get a new unique ID, then copy the cell and paste it back as values only
 * (Ctrl+Shift+V) so that the ID stays fixed: a formula can be recalculated and
 * give a different ID.
 *
 * @return {string} A new unique ID.
 * @customfunction
 */
function UUID() {
  return Utilities.getUuid();
}
