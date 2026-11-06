/** The seed every player flies on the same UTC day. A shared course is what
 * makes slalom scores comparable across browsers; the day number is small,
 * stable and reproducible from any clock. */
export const dailySeed = (date = new Date()) =>
  Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
