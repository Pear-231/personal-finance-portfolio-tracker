class DayRange {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }

  static merge(ranges) {
    const merged = [];

    for (const range of ranges.slice().sort((left, right) => left.start - right.start)) {
      const previous = merged[merged.length - 1];
      const isOverlapping = previous && range.start <= previous.end;

      if (isOverlapping) previous.end = Math.max(previous.end, range.end);
      else merged.push(new DayRange(range.start, range.end));
    }

    return merged;
  }
}
