'use strict';

/**
 * Date helpers
 * -------------
 * StreakKeeper's entire correctness rests on one question: "what day is
 * it?" — and until now that question had two different answers in two
 * different files. The state module derived the day from UTC, while the
 * logger stamped lines in local time. For anyone east or west of UTC that
 * means "today" rolls over at a different moment depending on which module
 * you ask, which is exactly the kind of subtle disagreement that causes a
 * missed day or a duplicate commit at the boundary.
 *
 * So there is now exactly one function that decides what day it is, and
 * every module calls it.
 *
 * Why the default is UTC:
 * GitHub buckets a commit into a day on the contribution graph using the
 * commit's own timestamp. When a commit is created through the REST API
 * without an explicit author date, GitHub stamps it in UTC. Keeping our
 * notion of "today" in UTC therefore guarantees our state file and
 * GitHub's contribution graph always agree about which day a commit
 * landed on. Choosing a different zone is possible, but only makes sense
 * alongside a configured commit identity — see src/config for why.
 */

const DATE_ONLY_FORMAT_OPTIONS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

/**
 * @param {string} timeZone an IANA zone name, e.g. "UTC" or "Asia/Kolkata"
 * @returns {boolean} whether the runtime recognizes the zone
 */
function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Today's calendar date in the given zone, as "YYYY-MM-DD".
 *
 * The "en-CA" locale is used deliberately: it formats dates as
 * YYYY-MM-DD natively, so there's no manual string assembly to get wrong.
 *
 * @param {string} timeZone an IANA zone name
 * @param {Date} [date] the instant to convert; defaults to now
 * @returns {string} e.g. "2026-08-02"
 */
function getDateString(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, ...DATE_ONLY_FORMAT_OPTIONS }).format(date);
}

/**
 * The given zone's UTC offset, formatted the way Git wants it ("+05:30").
 *
 * Needed only when stamping an explicit commit date. Derived by asking
 * Intl for the zone's short offset name ("GMT+5:30") and normalizing it,
 * since there's no direct "give me the offset" API.
 *
 * @param {string} timeZone an IANA zone name
 * @param {Date} [date] the instant to measure at; defaults to now
 * @returns {string} e.g. "+05:30" or "+00:00"
 */
function getUtcOffset(timeZone, date = new Date()) {
  const offsetPart = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName');

  // "longOffset" yields "GMT+05:30", or plain "GMT" when the offset is zero.
  const offsetText = offsetPart ? offsetPart.value.replace('GMT', '') : '';
  if (offsetText === '') {
    return '+00:00';
  }

  return offsetText;
}

module.exports = { isValidTimeZone, getDateString, getUtcOffset };
