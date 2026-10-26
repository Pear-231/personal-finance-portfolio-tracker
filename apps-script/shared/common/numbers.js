class Numbers {
  static get tolerance() {
    return 0.00000001;
  }

  static toNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  static sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  static fromPercent(percent) {
    return percent / 100;
  }

  static toPercent(fraction) {
    return fraction * 100;
  }

  static getAbsolute(value) {
    return Math.abs(Numbers.toNumber(value));
  }

  static isNearlyEqual(left, right) {
    return Math.abs(Numbers.toNumber(left) - Numbers.toNumber(right)) <= Numbers.tolerance;
  }

  static isHolding(quantity) {
    return Math.abs(quantity) > Numbers.tolerance;
  }

  static isPositive(value) {
    return value > Numbers.tolerance;
  }

  static exceeds(value, limit) {
    return value > limit + Numbers.tolerance;
  }
}
