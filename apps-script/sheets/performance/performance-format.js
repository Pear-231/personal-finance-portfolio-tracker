class PerformanceFormat {
  static buildRequests(sheetId, rows) {
    const requests = [PerformanceFormat.buildCellLook_(sheetId, rows.length), PerformanceFormat.buildLabelLook_(sheetId, rows.length)];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.level === Performance.assetLevel) continue;
      requests.push(PerformanceFormat.buildShading_(sheetId, row, index), PerformanceFormat.buildLabelEmphasis_(sheetId, row, index));
    }

    return requests;
  }

  static toRgbColour_(hex) {
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
    return { red, green, blue };
  }

  static buildRange_(sheetId, firstRow, rowCount, columnCount) {
    return {
      sheetId,
      startRowIndex: 1 + firstRow,
      endRowIndex: 1 + firstRow + rowCount,
      startColumnIndex: 0,
      endColumnIndex: columnCount
    };
  }

  static buildRepeatCell_(range, userEnteredFormat, fields) {
    return { repeatCell: { range, cell: { userEnteredFormat }, fields } };
  }

  static buildCellLook_(sheetId, rowCount) {
    return PerformanceFormat.buildRepeatCell_(
      PerformanceFormat.buildRange_(sheetId, 0, rowCount, Performance.columns.length),
      {
        textFormat: {
          fontFamily: SheetStyle.fontFamily,
          fontSize: SheetStyle.fontSize,
          bold: false
        },
        verticalAlignment: "MIDDLE"
      },
      "userEnteredFormat(textFormat(fontFamily,fontSize,bold),verticalAlignment,backgroundColor)"
    );
  }

  static buildLabelLook_(sheetId, rowCount) {
    return PerformanceFormat.buildRepeatCell_(
      PerformanceFormat.buildRange_(sheetId, 0, rowCount, 1),
      {
        numberFormat: { type: "TEXT", pattern: "@" },
        wrapStrategy: "WRAP",
        horizontalAlignment: "LEFT"
      },
      "userEnteredFormat(numberFormat,wrapStrategy,horizontalAlignment)"
    );
  }

  static buildShading_(sheetId, row, index) {
    return PerformanceFormat.buildRepeatCell_(
      PerformanceFormat.buildRange_(sheetId, index, 1, Performance.columns.length),
      { backgroundColor: PerformanceFormat.toRgbColour_(Performance.levels[row.level].background) },
      "userEnteredFormat.backgroundColor"
    );
  }

  static buildLabelEmphasis_(sheetId, row, index) {
    const range = PerformanceFormat.buildRange_(sheetId, index, 1, 1);

    if (row.level === Performance.sectionLevel) {
      return PerformanceFormat.buildRepeatCell_(range, { textFormat: { bold: true } }, "userEnteredFormat.textFormat.bold");
    }

    return PerformanceFormat.buildRepeatCell_(
      range,
      {
        textFormat: { bold: true },
        numberFormat: {
          type: row.level === Performance.yearLevel ? "NUMBER" : "DATE",
          pattern: Performance.levels[row.level].labelFormat
        }
      },
      "userEnteredFormat(textFormat.bold,numberFormat)"
    );
  }
}
