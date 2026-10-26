class Logger {
  static get previewLimit() {
    return 12;
  }

  static get debugLevel() {
    return "Debug";
  }

  static get informationLevel() {
    return "Information";
  }

  static get minimumLevel() {
    return Logger.informationLevel;
  }

  static get warningLevel() {
    return "Warning";
  }

  static get errorLevel() {
    return "Error";
  }

  static get levels() {
    return [Logger.debugLevel, Logger.informationLevel, Logger.warningLevel, Logger.errorLevel];
  }

  constructor(namespace) {
    this.namespace = namespace;
  }

  static create(namespace) {
    return new Logger(namespace);
  }

  debug(method, message) {
    Logger.write_(Logger.debugLevel, this.namespace, method, message);
  }

  information(method, message) {
    Logger.write_(Logger.informationLevel, this.namespace, method, message);
  }

  warning(method, message) {
    Logger.write_(Logger.warningLevel, this.namespace, method, message);
  }

  error(method, message, error = null) {
    const detail = error ? `${message}: ${Logger.describe_(error)}` : message;
    Logger.write_(Logger.errorLevel, this.namespace, method, detail);
  }

  createFailure(method, message) {
    this.error(method, message);
    return new Error(message);
  }

  throwIfAny(method, problems, describe) {
    if (problems.length === 0) return;

    for (const problem of problems) this.error(method, problem);
    throw new Error(describe(problems));
  }

  static run(name, action, { isQuiet = false } = {}) {
    const isOutermost = Logger.enter_(name, isQuiet);
    const log = Logger.create("Shared.Logger");

    try {
      log.information("run", `Started ${name}.`);
      const result = action();
      log.information("run", `Completed ${name}.`);
      return result;
    } catch (error) {
      log.error("run", `Failed ${name}`, error);
      throw error;
    } finally {
      Logger.leave_(isOutermost);
    }
  }

  static enter_(name, isQuiet) {
    const state = Logger.state_;
    const isOutermost = state.depth === 0;
    if (isOutermost) Logger.begin_(name, isQuiet);
    state.depth += 1;
    return isOutermost;
  }

  static leave_(isOutermost) {
    Logger.state_.depth -= 1;
    if (isOutermost) Logger.finish_();
  }

  static runStep(label, action) {
    const log = Logger.create("Shared.Logger");
    log.information("runStep", `Updating ${label}.`);
    const startedAt = Date.now();

    try {
      const result = action();
      const seconds = ((Date.now() - startedAt) / Dates.millisecondsPerSecond).toFixed(1);
      log.information("runStep", `Updated ${label} in ${seconds} s.`);
      return result;
    } catch (error) {
      throw new Error(`Stopped while updating ${label}: ${error.message}${Logger.describeLocation(error, 2)}`);
    }
  }

  static describeLocation(error, frameCount) {
    const where = String(error.stack || "")
      .split(/\n/)
      .slice(1, 1 + frameCount)
      .map((line) => line.trim())
      .join(" <- ");
    return where ? ` (${where})` : "";
  }

  static buildPreview(errors) {
    const preview = errors.slice(0, Logger.previewLimit).join("\n");
    const suffix = errors.length > Logger.previewLimit ? `\n… and ${errors.length - Logger.previewLimit} more.` : "";
    return `${preview}${suffix}`;
  }

  static writeToConsole(level, line) {
    if (level === Logger.debugLevel) console.debug(line);
    else if (level === Logger.warningLevel) console.warn(line);
    else if (level === Logger.errorLevel) console.error(line);
    else console.info(line);
  }

  static get state_() {
    if (!Logger.state) {
      Logger.state = { depth: 0, runId: "", scope: "", isWriting: true, pending: [] };
    }

    return Logger.state;
  }

  static begin_(name, isQuiet) {
    Object.assign(Logger.state_, {
      runId: Logger.createRunId_(),
      scope: name,
      isWriting: !isQuiet,
      pending: []
    });
  }

  static createRunId_() {
    return Utilities.getUuid().replace(/-/g, "").slice(0, 6);
  }

  static write_(level, namespace, method, message) {
    const rank = Logger.levels.indexOf(level);
    if (rank < Logger.levels.indexOf(Logger.minimumLevel)) return;
    const state = Logger.state_;
    const entry = { level, line: Logger.format_(state, namespace, method, message) };

    if (state.depth === 0 || state.isWriting) {
      Logger.writeToConsole(entry.level, entry.line);
      return;
    }

    state.pending.push(entry);
    if (rank < Logger.levels.indexOf(Logger.warningLevel)) return;

    state.isWriting = true;
    for (const pending of state.pending) {
      Logger.writeToConsole(pending.level, pending.line);
    }
    state.pending = [];
  }

  static format_(state, namespace, method, message) {
    const text = String(message)
      .replace(/\s*[\r\n]+\s*/g, " | ")
      .trim();
    const run = state.depth > 0 ? `[${state.runId}] [${state.scope}] ` : "";
    return `${run}${namespace}::${method} : ${text}`;
  }

  static describe_(error) {
    if (!(error instanceof Error)) return String(error);
    return `${error.name}: ${error.message}${Logger.describeLocation(error, 3)}`;
  }

  static finish_() {
    Object.assign(Logger.state_, { runId: "", scope: "", isWriting: true, pending: [] });
  }
}
