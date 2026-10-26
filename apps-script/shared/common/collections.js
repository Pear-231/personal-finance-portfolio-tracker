class Collections {
  static groupBy(items, keyOf) {
    const groups = new Map();

    for (const item of items) {
      const key = keyOf(item);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    return groups;
  }
}
