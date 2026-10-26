class HoldingPeriods {
  static groupEventsByAsset(ledgerRows) {
    return Collections.groupBy(ledgerRows, (event) => event.asset);
  }

  static findPeriodsByAsset(ledgerRows) {
    return new Map([...HoldingPeriods.groupEventsByAsset(ledgerRows)].map(([asset, events]) => [asset, HoldingPeriods.findPeriods_(events)]));
  }

  static findPeriods_(events) {
    const closingQuantityByDay = new Map();
    for (const event of events) {
      closingQuantityByDay.set(Dates.toDayKey(event.date), Numbers.toNumber(event.closingQuantity));
    }

    let quantity = 0;
    let openingDay = null;
    const periods = [];
    const days = [...closingQuantityByDay].sort(([left], [right]) => left - right);

    for (const [day, closingQuantity] of days) {
      quantity = closingQuantity;
      if (quantity === 0) periods.push(new DayRange(openingDay ?? day, day));

      openingDay = quantity === 0 ? null : (openingDay ?? day);
    }

    if (quantity !== 0) periods.push(new DayRange(openingDay, Number.POSITIVE_INFINITY));
    return periods;
  }

  static findLatestEventByAsset(ledgerRows) {
    const latest = new Map();

    for (const event of ledgerRows) {
      const previous = latest.get(event.asset);
      const isLater =
        !previous || event.date > previous.date || (event.date.getTime() === previous.date.getTime() && event.sourceRow > previous.sourceRow);
      if (!isLater) continue;

      latest.set(event.asset, event);
    }

    return latest;
  }
}
