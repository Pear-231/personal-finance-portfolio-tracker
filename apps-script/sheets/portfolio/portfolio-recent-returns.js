class PortfolioRecentReturns {
  constructor(rows, assets, { portfolioSheet = "", dataSheet = PortfolioData.sheetName } = {}) {
    this.rows = rows;
    this.assets = assets;
    this.portfolioSheet = portfolioSheet ? `${PortfolioRecentReturns.quoteSheet_(portfolioSheet)}!` : "";
    this.dataSheet = `${PortfolioRecentReturns.quoteSheet_(dataSheet)}!`;
  }

  build() {
    return this.rows.map((row, index) => ({
      row: index + 2,
      column: Portfolio.getColumn(Portfolio.oneDayReturnHeader),
      formulas: [0, 1, 3].flatMap((months, period) => [
        this.buildFormula_(row, index + 2, months, false),
        this.buildFormula_(row, index + 2, months, true, Portfolio.getIndex(Portfolio.oneDayReturnHeader) + period * 2)
      ])
    }));
  }

  buildFormula_(row, sheetRow, months, isPercentage, amountIndex) {
    const label = row[0];
    const isHolding = this.assets.has(label);
    const included = [...this.assets.keys()].filter((name) => this.includes_(label, name));
    const isDerivative = isHolding && Assets.isDerivative(this.assets.get(label));
    const source = (field) => {
      const letter = SheetTable.getColumnLetter(PortfolioData.columns.indexOf(field));
      return `${this.dataSheet}$${letter}$2:$${letter}`;
    };
    const data = (field) => `INDEX(history,,${PortfolioData.columns.indexOf(field) + 1})`;
    const cell = (column, at = sheetRow) => `${this.portfolioSheet}$${column}${at}`;
    const selector = isHolding
      ? `${source("asset")}=${cell("A")}`
      : `ISNUMBER(MATCH(${source("asset")},{${included.map(PortfolioRecentReturns.quote_).join(",")}},0))`;
    const empty = `{0,"","",0,0,0,0,0,0,0,0,0,0,0,0,0,0,FALSE}`;
    const bindings = [
      "asOf",
      "TODAY()",
      "startDay",
      months === 0 ? "asOf-1" : `EDATE(asOf,-${months})`,
      "recordedDay",
      `INT(MAXIFS(${source("date")},${source("date")},"<"&(asOf+1)))`,
      "history",
      `IFNA(SORT(FILTER(${this.dataSheet}$A$2:$R,${source("date")}>=EDATE(asOf,-3)-7,${source("date")}<asOf+1,${selector}),2,TRUE,1,TRUE),${empty})`,
      "days",
      `ARRAYFORMULA(INT(${data("date")}))`,
      "names",
      data("asset"),
      "latestValue",
      `SUMPRODUCT((days=recordedDay)*${data("closeValue")})`,
      "liveReturn",
      `${cell("K")}-latestValue+SUMPRODUCT((days=asOf)*${data("returnAmount")})`
    ];

    if (isPercentage && !isHolding) {
      bindings.push(
        "priorMargins",
        `ARRAYFORMULA(XLOOKUP(names&"|"&(days-1),names&"|"&days,${data("margin")},IF(${data("openQuantity")}=0,0,${data("margin")})))`,
        "daily",
        `IFNA(QUERY(ARRAYFORMULA(HSTACK(days,${data("openValue")}+priorMargins+IF(priorMargins>0,0,${data("margin")}),IF((priorMargins>0)+(${data("margin")}>0),0,${data("netCashFlow")}),${data("returnAmount")})),"select Col1,sum(Col2),sum(Col3),sum(Col4) where Col1>0 group by Col1 label Col1 '',sum(Col2) '',sum(Col3) '',sum(Col4) ''",0),{0,0,0,0})`,
        "dailyDates",
        "INDEX(daily,,1)",
        "dailyBases",
        "ARRAYFORMULA(INDEX(daily,,2)+IF(INDEX(daily,,3)>0,INDEX(daily,,3),0))"
      );
    }

    const exposure = `ABS(SUMPRODUCT((days=IF(recordedDay=asOf,IFERROR(MAX(FILTER(days,days<asOf)),asOf),recordedDay))*${data("closeQuantity")}*${data("localUnitValue")}*${data("exchangeRate")}))`;
    const holdingBase = isDerivative
      ? exposure
      : `IF(recordedDay=asOf,SUMPRODUCT((days=asOf)*${data("openValue")})+MAX(SUMPRODUCT((days=asOf)*${data("netCashFlow")}),0),latestValue)`;
    const groupBase = `IF(recordedDay=asOf,SUMPRODUCT((dailyDates=asOf)*dailyBases),latestValue+SUMPRODUCT((days=recordedDay)*${data("margin")}))`;
    if (isPercentage) bindings.push("liveBase", isHolding ? holdingBase : groupBase);

    let result;
    if (isPercentage) {
      const historical = isHolding
        ? `IFNA(FILTER(ARRAYFORMULA(1+${data("dailyReturn")}),days>startDay,days<asOf),1)`
        : "IFNA(FILTER(ARRAYFORMULA(IF(dailyBases>0,1+INDEX(daily,,4)/dailyBases,1)),dailyDates>startDay,dailyDates<asOf),1)";
      result = `PRODUCT(${historical})*IF(liveBase>0,1+liveReturn/liveBase,1)-1`;
    } else {
      bindings.push(
        "nextDays",
        "MAP(SEQUENCE(ROWS(names)),LAMBDA(at,IF(at=ROWS(names),asOf,IF(INDEX(names,at+1)=INDEX(names,at),INDEX(days,at+1),asOf))))",
        "missingStart",
        "SUM(MAP(SEQUENCE(ROWS(names)),LAMBDA(at,IF(OR(at=1,INDEX(names,at)<>INDEX(names,MAX(1,at-1))),IF(AND(INDEX(days,at)>startDay+1,INDEX(history,at,4)<>0),1,0),0))))>0",
        "hasGap",
        `SUMPRODUCT((days<asOf)*(days<nextDays-1)*(nextDays>startDay)*(${data("closeQuantity")}<>0))>0`,
        "isProvisional",
        `SUMPRODUCT(((days>startDay)+(days=recordedDay))*(${data("isProvisional")}=TRUE))>0`
      );
      const current = included.filter((name) => this.rows.some((current) => current[0] === name));
      const positionNames =
        current.length === 0 ? "UNIQUE(names)" : `UNIQUE(VSTACK(names,{${current.map(PortfolioRecentReturns.quote_).join(";")}}))`;
      const labels = `${this.portfolioSheet}$A$2:$A$${this.rows.length + 1}`;
      const quantities = `${this.portfolioSheet}$B$2:$B$${this.rows.length + 1}`;
      const values = `${this.portfolioSheet}$K$2:$K$${this.rows.length + 1}`;
      // Assets rounds displayed holding quantities to six decimal places; cash rows display their balance as one unit.
      bindings.push(
        "positionNames",
        positionNames,
        "unrecordedPosition",
        `SUM(MAP(positionNames,LAMBDA(name,LET(isCash,XLOOKUP(name,Assets!$A$2:$A,Assets!$B$2:$B,"")="${AssetTypes.cash}",recorded,SUMPRODUCT((names=name)*(days=recordedDay)*IF(isCash,${data("closeValue")},${data("closeQuantity")})),current,IF(isCash,SUMIF(${labels},name,${values}),SUMIF(${labels},name,${quantities})),IF(IF(isCash,ABS(current-recorded)>${Numbers.tolerance},ROUND(current,6)<>ROUND(recorded,6)),1,0)))))>0`
      );
      const invalid = ["missingStart", "hasGap", "isProvisional", "unrecordedPosition"];
      if (isHolding) invalid.push(`${cell("F")}=""`, `${cell("F")}>startDay`);
      result = `IF(OR(${invalid.join(",")}),"",SUMPRODUCT((days>startDay)*(days<asOf)*${data("returnAmount")})+liveReturn)`;
    }
    const formula = `LET(${bindings.join(",")},${result})`;
    return isPercentage ? `=IF(${cell(SheetTable.getColumnLetter(amountIndex))}="","",${formula})` : `=${formula}`;
  }

  includes_(label, name) {
    const type = this.assets.get(name)?.assetType || AssetTypes.otherAssets;
    if (label === Portfolio.assetsLabel) return true;
    if (label === Portfolio.assetsExcludingPensionLabel) return type !== AssetTypes.pension;
    if (label === Portfolio.assetsInMarketLabel) return !AssetTypes.notInMarket.includes(type);
    return AssetTypes.all.includes(label) ? label === type : label === name;
  }

  static quote_(value) {
    return `"${String(value).replaceAll(`"`, `""`)}"`;
  }

  static quoteSheet_(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
  }
}
