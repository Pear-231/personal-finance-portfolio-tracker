class SheetTable {
  static openRequired(spreadsheet, name, headers = null) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      throw new Error(`Missing required sheet: ${name}. Add a sheet of that name to the workbook, headed as the README describes.`);
    }
    if (headers) SheetTable.verifyHeaders(sheet, name, headers);
    return sheet;
  }

  static verifyHeaders(sheet, name, expected, { ignoredColumns = [] } = {}) {
    const width = Math.min(expected.length, sheet.getMaxColumns());
    const actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
    for (let index = 0; index < expected.length; index += 1) {
      const header = expected[index];
      if (ignoredColumns.includes(index) || actual[index] === header) continue;
      throw new Error(
        `${name}: column ${SheetTable.getColumnLetter(index)} should be headed "${header}" but is ` +
          `headed "${actual[index] === undefined ? "" : actual[index]}". The scripts never ` +
          "rewrite headers: correct the header row."
      );
    }
  }

  static getColumnLetter(index) {
    let letters = "";

    for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
      letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
    }

    return letters;
  }

  static readHeaderRow(sheet) {
    return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  }

  static readRows(sheet, columnCount = sheet.getLastColumn()) {
    const rowCount = Math.max(sheet.getLastRow() - 1, 0);
    return rowCount === 0 ? [] : sheet.getRange(2, 1, rowCount, columnCount).getValues();
  }

  static isTicked(value) {
    return value === true || String(value).trim().toUpperCase() === "TRUE";
  }

  static trimRowsBelow(sheet, lastDataRow) {
    const extra = sheet.getMaxRows() - lastDataRow;
    if (extra > 0) sheet.deleteRows(lastDataRow + 1, extra);
  }

  static ensureSize(sheet, rowCount, columnCount) {
    if (sheet.getMaxRows() < rowCount) {
      sheet.insertRowsAfter(sheet.getMaxRows(), rowCount - sheet.getMaxRows());
    }

    if (sheet.getMaxColumns() < columnCount) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), columnCount - sheet.getMaxColumns());
    }
  }

  static flush() {
    SpreadsheetApp.flush();
  }

  /** Cell A1 of a generated sheet holds the time it was last updated. */
  static writeTimestamp(sheet, time) {
    const cell = sheet.getRange(1, 1);
    if (!(cell.getValue() instanceof Date)) cell.setNumberFormat("dd/mm/yyyy hh:mm:ss");
    cell.setValue(time);
  }

  static isTypedColumnError(error) {
    return /typed column/i.test(String(error && error.message));
  }

  static ignoreTypedColumns(action) {
    try {
      SheetTable.flush();
      action();
      SheetTable.flush();
    } catch (error) {
      if (!SheetTable.isTypedColumnError(error)) throw error;
    }
  }

  static setValues(range, values) {
    try {
      SheetTable.flush();
      range.setValues(values);
      SheetTable.flush();
    } catch (error) {
      if (!SheetTable.isTypedColumnError(error)) throw error;
      range.setValues(SheetTable.toSerialDates(values));
      SheetTable.flush();
    }
  }

  static appendRows(sheet, rows, headers, sheetName) {
    if (rows.length === 0) return;
    const startRow = Math.max(sheet.getLastRow(), 1) + 1;
    SheetTable.ensureSize(sheet, startRow + rows.length - 1, 0);
    SheetTable.copyFormatDown(sheet, startRow - 1, startRow, rows.length, headers.length);
    SheetTable.setValues(sheet.getRange(startRow, 1, rows.length, headers.length), rows);
    SheetTable.confirmDates(sheet, startRow, rows, headers, sheetName);
  }

  static copyFormatDown(sheet, fromRow, toRow, rowCount, columnCount) {
    if (fromRow < 1) return;

    SheetTable.ignoreTypedColumns(() =>
      sheet
        .getRange(fromRow, 1, 1, columnCount)
        .copyTo(sheet.getRange(toRow, 1, rowCount, columnCount), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false)
    );
  }

  /**
   * A typed Date column can drop dates without raising an error, so each date column just written is read back.
   */
  static confirmDates(sheet, startRow, rows, headers, sheetName) {
    if (rows.length === 0) return;
    for (let index = 0; index < rows[0].length; index += 1) {
      const value = rows[0][index];
      if (!(value instanceof Date) || index >= headers.length) continue;
      const range = sheet.getRange(startRow, index + 1, rows.length, 1);
      const countEmpty = () => range.getValues().filter(([cell]) => cell === "" || cell === null).length;

      if (countEmpty() === 0) continue;
      SheetTable.setValues(range, SheetTable.toSerialDates(rows.map((row) => [row[index]])));
      const stillEmpty = countEmpty();
      if (stillEmpty > 0) {
        throw new Error(
          `${sheetName}: the ${headers[index]} column refused ${stillEmpty} of ${rows.length} dates. Check its column type in the Sheets table.`
        );
      }
    }
  }

  static toSerialDates(values) {
    return values.map((row) => row.map((value) => (value instanceof Date ? Dates.toDateTimeSerial(value) : value)));
  }
}
