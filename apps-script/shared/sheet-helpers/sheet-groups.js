class SheetGroups {
  static get log() {
    return Logger.create("Shared.SheetHelpers.SheetGroups");
  }

  static replace(sheet, { rows = null, columns = null }) {
    SheetTable.flush();
    const spreadsheetId = sheet.getParent().getId();
    const sheetId = sheet.getSheetId();
    const existing =
      Sheets.Spreadsheets.get(spreadsheetId, {
        fields: "sheets(properties.sheetId,rowGroups,columnGroups)"
      }).sheets.find((found) => found.properties.sheetId === sheetId) || {};

    const requests = SheetGroups.buildRequests_(sheetId, existing, rows, columns);
    Sheets.Spreadsheets.batchUpdate({ requests }, spreadsheetId);

    SheetGroups.log.information("replace", `${sheet.getName()}: ${requests.length} changes to its groups made in one request.`);
  }

  static buildRequests_(sheetId, existing, rows, columns) {
    const dimensions = [];

    if (rows) {
      dimensions.push({
        dimension: "ROWS",
        existing: existing.rowGroups,
        firstIndex: rows.firstRow - 1,
        groups: rows.groups.map((group) => ({
          start: rows.firstRow + group.index - 1,
          end: rows.firstRow + group.index - 1 + group.count,
          isOpen: Boolean(rows.isOpen(group))
        })),
        controlProperty: "rowGroupControlAfter"
      });
    }

    if (columns) {
      dimensions.push({
        dimension: "COLUMNS",
        existing: existing.columnGroups,
        firstIndex: 0,
        groups: columns.groups.map(({ column, count }) => ({
          start: column - 1,
          end: column - 1 + count,
          isOpen: false
        })),
        controlProperty: "columnGroupControlAfter"
      });
    }

    return dimensions.flatMap(({ dimension, existing: groupsBefore, firstIndex, groups, controlProperty }) => [
      ...SheetGroups.buildDimensionRequests_(sheetId, dimension, groupsBefore, firstIndex, groups),
      SheetGroups.buildControlRequest_(sheetId, controlProperty)
    ]);
  }

  static buildDimensionRequests_(sheetId, dimension, existing = [], firstIndex, groups) {
    const buildRange = (start, end) => ({ sheetId, dimension, startIndex: start, endIndex: end });
    const removed = existing.filter((group) => group.range.startIndex >= firstIndex).sort((left, right) => right.depth - left.depth);

    const ordered = [...groups].sort((left, right) => left.start - right.start || right.end - left.end);

    const depths = SheetGroups.calculateDepths_(ordered);

    const lastIndex = Math.max(firstIndex, ...removed.map((group) => group.range.endIndex), ...groups.map((group) => group.end));

    return [
      ...removed.map((group) => ({
        deleteDimensionGroup: { range: buildRange(group.range.startIndex, group.range.endIndex) }
      })),
      {
        updateDimensionProperties: {
          range: buildRange(firstIndex, lastIndex),
          properties: { hiddenByUser: false },
          fields: "hiddenByUser"
        }
      },
      ...ordered.map((group) => ({
        addDimensionGroup: { range: buildRange(group.start, group.end) }
      })),
      ...ordered
        .map((group, position) => ({ group, depth: depths[position] }))
        .filter(({ group }) => !group.isOpen)
        .sort((left, right) => left.depth - right.depth)
        .map(({ group, depth }) => ({
          updateDimensionGroup: {
            dimensionGroup: { range: buildRange(group.start, group.end), depth, collapsed: true },
            fields: "collapsed"
          }
        }))
    ];
  }

  /** A group is as deep as the number of earlier groups that enclose it, plus one. */
  static calculateDepths_(ordered) {
    return ordered.map(
      (group, position) => 1 + ordered.slice(0, position).filter((outer) => outer.start <= group.start && outer.end >= group.end).length
    );
  }

  static buildControlRequest_(sheetId, property) {
    return {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { [property]: false } },
        fields: `gridProperties.${property}`
      }
    };
  }
}
