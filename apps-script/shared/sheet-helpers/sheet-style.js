class SheetStyle {
  static get fontFamily() {
    return "Arial";
  }

  static get fontSize() {
    return 9;
  }

  static get accentShading() {
    return "#cfe2f3";
  }

  static get mediumShading() {
    return "#e3e3e3";
  }

  static get lightShading() {
    return "#f3f3f3";
  }

  static get headerShading() {
    return "#f1f3f4";
  }

  static get gainColour() {
    return "#6aa84f";
  }

  static get lossColour() {
    return "#cc0000";
  }

  static applySignColours(sheet, ranges, benchmark = null, thresholds = []) {
    const createRule = (colour) => SpreadsheetApp.newConditionalFormatRule().setFontColor(colour);
    const rules = [
      createRule(SheetStyle.gainColour).whenNumberGreaterThanOrEqualTo(0).setRanges(ranges).build(),
      createRule(SheetStyle.lossColour).whenNumberLessThan(0).setRanges(ranges).build()
    ];

    if (benchmark) {
      const { range, returnColumn, benchmarkColumn } = benchmark;
      const cells = `ISNUMBER($${benchmarkColumn}${range.getRow()}),ISNUMBER($${returnColumn}${range.getRow()})`;
      const compare = (operator) => `=AND(${cells},$${returnColumn}${range.getRow()}${operator}$${benchmarkColumn}${range.getRow()})`;
      rules.push(
        createRule(SheetStyle.gainColour).whenFormulaSatisfied(compare(">")).setRanges([range]).build(),
        createRule(SheetStyle.lossColour).whenFormulaSatisfied(compare("<")).setRanges([range]).build()
      );
    }

    for (const { ranges: thresholdRanges, threshold } of thresholds) {
      rules.push(
        createRule(SheetStyle.gainColour).whenNumberGreaterThanOrEqualTo(threshold).setRanges(thresholdRanges).build(),
        createRule(SheetStyle.lossColour).whenNumberLessThan(threshold).setRanges(thresholdRanges).build()
      );
    }

    sheet.setConditionalFormatRules(rules);
  }
}
