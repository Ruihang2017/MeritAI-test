/**
 * Public holidays by state and territory, 2026 and 2027, from Fair Work's yearly lists (checked 2026-09-28;
 * state-wide, capital city and some regional holidays, as Fair Work lists them). Round 6 evaluation: a first
 * day on Labour Day (5 October 2026) was not flagged. Code checks the date; the model is told what it found.
 * One correction: ACT 2027 Anzac Day follows the ACT Government page (Fair Work swaps the two names).
 * Victoria's Friday before the AFL Grand Final in 2027 is not set yet (Fair Work: "date TBC").
 */

export const HOLIDAYS_CHECKED_ON = "2026-09-28";
export const HOLIDAY_YEARS = [2026, 2027];

export const HOLIDAY_SOURCES = {
  notWorking: { title: "Fair Work: Not working on public holidays", url: "https://www.fairwork.gov.au/employment-conditions/public-holidays/not-working-on-public-holidays" },
  2026: { title: "Fair Work: 2026 public holidays", url: "https://www.fairwork.gov.au/employment-conditions/public-holidays/2026-public-holidays" },
  2027: { title: "Fair Work: 2027 public holidays", url: "https://www.fairwork.gov.au/employment-conditions/public-holidays/2027-public-holidays" },
} as const;

const STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;

const HOLIDAYS: Record<(typeof STATES)[number], [string, string][]> = {
  ACT: [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-26", "Australia Day"],
    ["2026-03-09", "Canberra Day"],
    ["2026-04-03", "Good Friday"],
    ["2026-04-04", "Easter Saturday - the day after Good Friday"],
    ["2026-04-05", "Easter Sunday"],
    ["2026-04-06", "Easter Monday"],
    ["2026-04-25", "Anzac Day"],
    ["2026-04-27", "Additional public holiday for Anzac Day"],
    ["2026-06-01", "Reconciliation Day"],
    ["2026-06-08", "King's Birthday"],
    ["2026-10-05", "Labour Day"],
    ["2026-12-25", "Christmas Day"],
    ["2026-12-26", "Boxing Day"],
    ["2026-12-28", "Additional public holiday for Boxing Day"],
    ["2027-01-01", "New Year's Day"],
    ["2027-01-26", "Australia Day"],
    ["2027-03-08", "Canberra Day"],
    ["2027-03-26", "Good Friday"],
    ["2027-03-27", "Easter Saturday - the day after Good Friday"],
    ["2027-03-28", "Easter Sunday"],
    ["2027-03-29", "Easter Monday"],
    ["2027-04-25", "Anzac Day"],
    ["2027-04-26", "Additional public holiday for Anzac Day"],
    ["2027-05-31", "Reconciliation Day"],
    ["2027-06-14", "King's Birthday"],
    ["2027-10-04", "Labour Day"],
    ["2027-12-25", "Christmas Day"],
    ["2027-12-26", "Boxing Day"],
    ["2027-12-27", "Additional public holiday for Christmas Day"],
    ["2027-12-28", "Additional public holiday for Boxing Day"],
  ],
  NSW: [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-26", "Australia Day"],
    ["2026-04-03", "Good Friday"],
    ["2026-04-04", "Easter Saturday"],
    ["2026-04-05", "Easter Sunday"],
    ["2026-04-06", "Easter Monday"],
    ["2026-04-25", "Anzac Day"],
    ["2026-04-27", "Additional public holiday for Anzac Day"],
    ["2026-06-08", "King's Birthday"],
    ["2026-10-05", "Labour Day"],
    ["2026-12-25", "Christmas Day"],
    ["2026-12-26", "Boxing Day"],
    ["2026-12-28", "Additional public holiday for Boxing Day"],
    ["2027-01-01", "New Year's Day"],
    ["2027-01-26", "Australia Day"],
    ["2027-03-26", "Good Friday"],
    ["2027-03-27", "Easter Saturday"],
    ["2027-03-28", "Easter Sunday"],
    ["2027-03-29", "Easter Monday"],
    ["2027-04-25", "Anzac Day"],
    ["2027-04-26", "Additional public holiday for Anzac Day"],
    ["2027-06-14", "King's Birthday"],
    ["2027-10-04", "Labour Day"],
    ["2027-12-25", "Christmas Day"],
    ["2027-12-26", "Boxing Day"],
    ["2027-12-27", "Additional public holiday for Christmas Day"],
    ["2027-12-28", "Additional public holiday for Boxing Day"],
  ],
  NT: [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-26", "Australia Day"],
    ["2026-04-03", "Good Friday"],
    ["2026-04-04", "Easter Saturday"],
    ["2026-04-05", "Easter Sunday"],
    ["2026-04-06", "Easter Monday"],
    ["2026-04-25", "Anzac Day"],
    ["2026-05-04", "May Day"],
    ["2026-06-08", "King's Birthday"],
    ["2026-08-03", "Picnic Day"],
    ["2026-12-24", "Christmas Eve (from 7 pm to midnight)"],
    ["2026-12-25", "Christmas Day"],
    ["2026-12-26", "Boxing Day"],
    ["2026-12-28", "Additional public holiday for Boxing Day"],
    ["2026-12-31", "New Year's Eve (from 7 pm to midnight)"],
    ["2027-01-01", "New Year's Day"],
    ["2027-01-26", "Australia Day"],
    ["2027-03-26", "Good Friday"],
    ["2027-03-27", "Easter Saturday"],
    ["2027-03-28", "Easter Sunday"],
    ["2027-03-29", "Easter Monday"],
    ["2027-04-26", "Anzac Day"],
    ["2027-05-03", "May Day"],
    ["2027-06-14", "King's Birthday"],
    ["2027-08-02", "Picnic Day"],
    ["2027-12-24", "Christmas Eve (from 7 pm to midnight)"],
    ["2027-12-25", "Christmas Day"],
    ["2027-12-26", "Boxing Day"],
    ["2027-12-27", "Additional public holiday for Christmas Day"],
    ["2027-12-28", "Additional public holiday for Boxing Day"],
    ["2027-12-31", "New Year's Eve (from 7 pm to midnight)"],
  ],
  QLD: [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-26", "Australia Day"],
    ["2026-04-03", "Good Friday"],
    ["2026-04-04", "The day after Good Friday"],
    ["2026-04-05", "Easter Sunday"],
    ["2026-04-06", "Easter Monday"],
    ["2026-04-25", "Anzac Day"],
    ["2026-05-04", "Labour Day"],
    ["2026-08-12", "Royal Queensland Show (Brisbane area only)"],
    ["2026-10-05", "King's Birthday"],
    ["2026-12-24", "Christmas Eve (from 6 pm to midnight)"],
    ["2026-12-25", "Christmas Day"],
    ["2026-12-26", "Boxing Day"],
    ["2026-12-28", "Additional public holiday for Boxing Day"],
    ["2027-01-01", "New Year's Day"],
    ["2027-01-26", "Australia Day"],
    ["2027-03-26", "Good Friday"],
    ["2027-03-27", "The day after Good Friday"],
    ["2027-03-28", "Easter Sunday"],
    ["2027-03-29", "Easter Monday"],
    ["2027-04-26", "Anzac Day"],
    ["2027-05-03", "Labour Day"],
    ["2027-08-11", "Royal Queensland Show (Brisbane area only)"],
    ["2027-10-04", "King's Birthday"],
    ["2027-12-24", "Christmas Eve (from 6 pm to midnight)"],
    ["2027-12-25", "Christmas Day"],
    ["2027-12-26", "Boxing Day"],
    ["2027-12-27", "Additional public holiday for Christmas Day"],
    ["2027-12-28", "Additional public holiday for Boxing Day"],
  ],
  SA: [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-26", "Australia Day"],
    ["2026-03-09", "Adelaide Cup Day"],
    ["2026-04-03", "Good Friday"],
    ["2026-04-04", "Easter Saturday"],
    ["2026-04-05", "Easter Sunday"],
    ["2026-04-06", "Easter Monday"],
    ["2026-04-25", "Anzac Day"],
    ["2026-06-08", "King's Birthday"],
    ["2026-10-05", "Labour Day"],
    ["2026-12-24", "Christmas Eve (from 7 pm to midnight)"],
    ["2026-12-25", "Christmas Day"],
    ["2026-12-26", "Proclamation Day holiday"],
    ["2026-12-28", "Additional public holiday for Proclamation Day holiday"],
    ["2026-12-31", "New Year's Eve (from 7 pm to midnight)"],
    ["2027-01-01", "New Year's Day"],
    ["2027-01-26", "Australia Day"],
    ["2027-03-08", "Adelaide Cup Day"],
    ["2027-03-26", "Good Friday"],
    ["2027-03-27", "Easter Saturday"],
    ["2027-03-28", "Easter Sunday"],
    ["2027-03-29", "Easter Monday"],
    ["2027-04-25", "Anzac Day"],
    ["2027-06-14", "King's Birthday"],
    ["2027-10-04", "Labour Day"],
    ["2027-12-24", "Christmas Eve (from 7 pm to midnight)"],
    ["2027-12-25", "Christmas Day"],
    ["2027-12-26", "Proclamation Day holiday"],
    ["2027-12-27", "Additional public holiday for Christmas Day"],
    ["2027-12-28", "Additional public holiday for Proclamation Day holiday"],
    ["2027-12-31", "New Year's Eve (from 7 pm to midnight)"],
  ],
  TAS: [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-26", "Australia Day"],
    ["2026-02-09", "Royal Hobart Regatta (only observed in certain areas of the state, including Hobart)"],
    ["2026-03-09", "Eight Hours Day"],
    ["2026-04-03", "Good Friday"],
    ["2026-04-06", "Easter Monday"],
    ["2026-04-07", "Easter Tuesday (generally Tasmanian Public Service only)"],
    ["2026-04-25", "Anzac Day"],
    ["2026-06-08", "King's Birthday"],
    ["2026-10-22", "Royal Hobart Show (only observed in certain areas of the state, including Hobart)"],
    ["2026-11-02", "Recreation Day (areas of the state that don't observe Royal Hobart Regatta)"],
    ["2026-12-25", "Christmas Day"],
    ["2026-12-28", "Boxing Day"],
    ["2027-01-01", "New Year's Day"],
    ["2027-01-26", "Australia Day"],
    ["2027-02-08", "Royal Hobart Regatta (only observed in certain areas of the state)"],
    ["2027-03-08", "Eight Hours Day"],
    ["2027-03-26", "Good Friday"],
    ["2027-03-29", "Easter Monday"],
    ["2027-03-30", "Easter Tuesday (generally Tasmanian Public Service only)"],
    ["2027-04-25", "Anzac Day"],
    ["2027-06-14", "King's Birthday"],
    ["2027-10-21", "Royal Hobart Show (only observed in certain areas of the state, including Hobart)"],
    ["2027-11-01", "Recreation Day (areas of the state that don't observe Royal Hobart Regatta)"],
    ["2027-12-25", "Christmas Day"],
    ["2027-12-27", "Additional public holiday for Christmas Day"],
    ["2027-12-28", "Boxing Day"],
  ],
  VIC: [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-26", "Australia Day"],
    ["2026-03-09", "Labour Day"],
    ["2026-04-03", "Good Friday"],
    ["2026-04-04", "Saturday before Easter Sunday"],
    ["2026-04-05", "Easter Sunday"],
    ["2026-04-06", "Easter Monday"],
    ["2026-04-25", "Anzac Day"],
    ["2026-06-08", "King's Birthday"],
    ["2026-09-25", "Friday before the AFL Grand Final"],
    ["2026-11-03", "Melbourne Cup (some regional areas in Victoria hold the Melbourne Cup public holiday on a different date)"],
    ["2026-12-25", "Christmas Day"],
    ["2026-12-26", "Boxing Day"],
    ["2026-12-28", "Additional public holiday for Boxing Day"],
    ["2027-01-01", "New Year's Day"],
    ["2027-01-26", "Australia Day"],
    ["2027-03-08", "Labour Day"],
    ["2027-03-26", "Good Friday"],
    ["2027-03-27", "Saturday before Easter Sunday"],
    ["2027-03-28", "Easter Sunday"],
    ["2027-03-29", "Easter Monday"],
    ["2027-04-25", "Anzac Day"],
    ["2027-06-14", "King's Birthday"],
    ["2027-11-02", "Melbourne Cup (some regional areas in Victoria hold the Melbourne Cup public holiday on a different date)"],
    ["2027-12-25", "Christmas Day"],
    ["2027-12-26", "Boxing Day"],
    ["2027-12-27", "Additional public holiday for Christmas Day"],
    ["2027-12-28", "Additional public holiday for Boxing Day"],
  ],
  WA: [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-26", "Australia Day"],
    ["2026-03-02", "Labour Day"],
    ["2026-04-03", "Good Friday"],
    ["2026-04-05", "Easter Sunday"],
    ["2026-04-06", "Easter Monday"],
    ["2026-04-25", "Anzac Day"],
    ["2026-04-27", "Additional public holiday for Anzac Day"],
    ["2026-06-01", "Western Australia Day"],
    ["2026-09-28", "King's Birthday (some regional areas in WA hold the King's Birthday public holiday on a different date)"],
    ["2026-12-25", "Christmas Day"],
    ["2026-12-26", "Boxing Day"],
    ["2026-12-28", "Additional public holiday for Boxing Day"],
    ["2027-01-01", "New Year's Day"],
    ["2027-01-26", "Australia Day"],
    ["2027-03-01", "Labour Day"],
    ["2027-03-26", "Good Friday"],
    ["2027-03-28", "Easter Sunday"],
    ["2027-03-29", "Easter Monday"],
    ["2027-04-25", "Anzac Day"],
    ["2027-04-26", "Additional public holiday for Anzac Day"],
    ["2027-06-07", "Western Australia Day"],
    ["2027-09-27", "King's Birthday (some regional areas in WA hold the King's Birthday public holiday on a different date)"],
    ["2027-12-25", "Christmas Day"],
    ["2027-12-26", "Boxing Day"],
    ["2027-12-27", "Additional public holiday for Christmas Day"],
    ["2027-12-28", "Additional public holiday for Boxing Day"],
  ],
};

export interface HolidayHit {
  state: string;
  name: string;
}

/** The public holidays on a date in the given states (all states when none are known). */
export function publicHolidaysOn(date: string, states: string[]): HolidayHit[] {
  const list = states.map((s) => s.toUpperCase()).filter((s): s is (typeof STATES)[number] => (STATES as readonly string[]).includes(s));
  const check = list.length ? list : [...STATES];
  return check.flatMap((state) => HOLIDAYS[state].filter(([d]) => d === date).map(([, name]) => ({ state, name })));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What to tell the owner about a start date: a public holiday in the business's states, an unknown year, or
 * (Victoria, 2027) a Friday that could be the one before the AFL Grand Final. Null when there is nothing to say.
 */
export function startDateHolidayNote(date: string | null | undefined, states: string[]): string | null {
  if (!date || !ISO.test(date)) return null;
  const year = Number(date.slice(0, 4));
  const where = states.length ? states.join(", ") : "any state (the business's states aren't in its profile)";
  if (!HOLIDAY_YEARS.includes(year)) return `Start date ${date}: MeritAI has public holidays for ${HOLIDAY_YEARS.join(" and ")} only; ask the owner to check it isn't a public holiday in ${where} (Fair Work publishes each year's list).`;
  const hits = publicHolidaysOn(date, states);
  const src = HOLIDAY_SOURCES[year as 2026 | 2027];
  const vic = (!states.length || states.some((s) => s.toUpperCase() === "VIC")) && year === 2027 && new Date(`${date}T00:00:00Z`).getUTCDay() === 5 && date >= "2027-09-17" && date <= "2027-10-01";
  const lines: string[] = [];
  if (hits.length) {
    // One line per holiday name, with its states.
    const byName = new Map<string, string[]>();
    for (const h of hits) byName.set(h.name, [...(byName.get(h.name) ?? []), h.state]);
    const names = [...byName].map(([n, s]) => `${n} (${s.join(", ")})`).join("; ");
    lines.push(
      `Start date ${date} is a public holiday: ${names}. Say so near the top of the answer and suggest another first day. ` +
        "If they do start that day: the employer can only ask them to work a public holiday if the request is reasonable, the employee can refuse on reasonable grounds, and work that day is paid at the award's public holiday rate (check it in the Pay and Conditions Tool; don't state a rate). " +
        `Sources: ${src.title} ${src.url}; ${HOLIDAY_SOURCES.notWorking.title} ${HOLIDAY_SOURCES.notWorking.url}.`,
    );
  }
  if (vic) lines.push(`Start date ${date}: in Victoria the Friday before the AFL Grand Final is a public holiday and its 2027 date isn't set yet; ask the owner to check it (${src.title} ${src.url}).`);
  return lines.length ? lines.join("\n") : null;
}
