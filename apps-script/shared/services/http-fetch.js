class HttpFetch {
  static get successStatus() {
    return 200;
  }

  static get defaultAttempts() {
    return 3;
  }

  /** A cell function has a 30s limit, so a second attempt after a short pause is the most it can afford. */
  static get cellFunctionSettings() {
    return { attempts: 2, pauseMilliseconds: 1000 };
  }

  static get userAgent() {
    return "Mozilla/5.0";
  }

  static get browserOptions() {
    return { headers: { "User-Agent": HttpFetch.userAgent } };
  }

  static get retriedStatuses() {
    return [408, 429, 500, 502, 503, 504];
  }

  static get cacheSeconds() {
    return 900;
  }

  static get log() {
    return Logger.create("Shared.Services.HttpFetch");
  }

  static excerpt(reply) {
    return String(reply).replace(/\s+/g, " ").trim().slice(0, 160);
  }

  static get(description, url, settings = {}) {
    return HttpFetch.fetch_(description, url, settings, null);
  }

  static getParsed(description, url, parse, settings = {}) {
    return HttpFetch.fetch_(description, url, settings, parse);
  }

  static fetch_(description, url, { options = {}, attempts = HttpFetch.defaultAttempts, pauseMilliseconds = 2000 }, parse) {
    let failure = null;
    let lastResponse = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now();
      let status = null;
      let result = null;

      try {
        lastResponse = UrlFetchApp.fetch(url, { muteHttpExceptions: true, ...options });
        status = lastResponse.getResponseCode();
        result = status === HttpFetch.successStatus && parse ? parse(lastResponse) : lastResponse;
      } catch (error) {
        failure = error;
        status = null;
      }

      if (status === HttpFetch.successStatus) {
        const onAttempt = attempt > 1 ? `, on attempt ${attempt}` : "";
        HttpFetch.log.information("fetch_", `${description}: HTTP ${status} in ${Date.now() - startedAt} ms${onAttempt}.`);
        return result;
      }

      if (status !== null) failure = new Error(`${description} failed with HTTP ${status}.`);
      const isFinal = status !== null && !HttpFetch.retriedStatuses.includes(status);

      if (isFinal) HttpFetch.log.warning("fetch_", failure.message);
      if (isFinal && !parse) return lastResponse;
      if (isFinal) throw failure;

      if (attempt < attempts) {
        HttpFetch.log.warning(
          "fetch_",
          `${description}: attempt ${attempt} of ${attempts} failed (${failure.message}), ` +
            `trying again in ${(pauseMilliseconds * attempt) / Dates.millisecondsPerSecond} s.`
        );
        Utilities.sleep(pauseMilliseconds * attempt);
      }
    }

    HttpFetch.log.error("fetch_", `${description}: gave up after ${attempts} attempts`, failure);
    if (!parse && lastResponse) return lastResponse;
    throw failure;
  }

  /**
   * So that a sheet of price formulas makes one request per asset, not one per cell. A null is not remembered.
   */
  static remember(key, produce) {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(key);
    if (cached) {
      HttpFetch.log.debug("remember", `${key} was remembered.`);
      return JSON.parse(cached);
    }

    const value = produce();
    if (value !== null && value !== undefined) {
      cache.put(key, JSON.stringify(value), HttpFetch.cacheSeconds);
    }

    return value;
  }
}
