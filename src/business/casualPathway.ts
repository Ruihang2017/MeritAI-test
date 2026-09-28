import type { ClientTool } from "../engine/types";
import type { BusinessStore } from "./profile";
import type { Register } from "./register";
import { addMonths, smallBusinessOf } from "./leaving";
import { todayIso } from "../clock";

/**
 * A casual becoming permanent: the NES employee choice pathway (Fair Work "Becoming a permanent employee",
 * checked 2026-09-28). Round 6 evaluation: replies left out that the casual must believe they no longer meet
 * the casual definition, and that the employer can refuse only on set grounds. Code gives the rules and the
 * date a casual can first give notice (employment before 26 August 2024 doesn't count).
 */

export const PATHWAY_SOURCE = { title: "Fair Work: Becoming a permanent employee", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/casual-employees/becoming-a-permanent-employee" };
const DEFINITION_SOURCE = { title: "Fair Work: Casual employees", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/casual-employees" };

/** Employment before this day doesn't count towards the employee choice pathway. */
export const PATHWAY_START = "2024-08-26";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The first day a casual can give notice: 6 months (12 with a small business employer) counted from their start, or 26 August 2024 if later. */
export function noticeFrom(start: string, small: boolean): string {
  return addMonths(start > PATHWAY_START ? start : PATHWAY_START, small ? 12 : 6);
}

export function casualPathwayText(o: { start?: string | null; today: string; small: boolean | null; name?: string }): string {
  const lines = [
    `Casual to permanent (NES employee choice pathway; ${PATHWAY_SOURCE.title} ${PATHWAY_SOURCE.url}):`,
    "- The owner can offer permanent (full-time or part-time) work at any time if both agree.",
    "- The casual can give written notice to change to permanent work once they have been employed for at least 6 months (12 months with a small business employer, fewer than 15 employees) AND they believe they no longer meet the casual employee definition (a casual has no firm advance commitment to ongoing work; this is judged on the real substance of the relationship and factors such as whether work is offered and accepted freely, whether future work of that kind is reasonably likely, whether full-time or part-time staff do the same work, and whether there is a regular pattern of work, though a regular pattern alone doesn't settle it). Service alone doesn't make them permanent, and it doesn't happen automatically.",
    "- They can't give notice while a dispute about it is going on, or within 6 months after the employer refused a previous notice or a dispute about it was resolved.",
    "- Before answering, the employer must consult the casual (full-time or part-time, the hours, when it starts), then answer in writing within 21 days. Accepting: the written answer states the new status, hours and start (from the first full pay period after the answer, unless they agree another day).",
    "- The employer can refuse only if: the employee still meets the casual definition; there are fair and reasonable operational grounds (substantial changes to how the work is organised, significant impacts on the business, or substantial changes to their conditions needed to comply with the award or an agreement); or accepting would break a recruitment or selection process required by law. The written refusal gives the reasons. Before refusing, get advice (an employer association, an employment lawyer or the Fair Work Infoline 13 13 94).",
    `- Fair Work has a checklist and notice template for the casual, and a response template for the employer (on the page above). The casual definition: ${DEFINITION_SOURCE.title} ${DEFINITION_SOURCE.url}.`,
  ];
  if (o.start && ISO.test(o.start)) {
    const who = o.name ? `${o.name} (started ${o.start})` : `Started ${o.start}`;
    const dates = (o.small === null ? [false, true] : [o.small]).map((small) => {
      const from = noticeFrom(o.start as string, small);
      const label = o.small === null ? (small ? " with fewer than 15 employees" : " with 15 or more employees") : "";
      return `from ${from}${label}${from <= o.today ? " (already reached)" : ""}`;
    });
    const before = o.start < PATHWAY_START ? " Employment before 26 August 2024 doesn't count." : "";
    lines.push(`- ${who}: the earliest they can give notice under the pathway is ${dates.join(", or ")}, if they then believe they no longer meet the casual definition.${before} Worked out from the dates: use it as it is.`);
  }
  return lines.join("\n");
}

export function casualPathwayTools(business: () => BusinessStore, register: () => Register, today: () => string = todayIso): ClientTool[] {
  return [
    {
      name: "casual_to_permanent",
      description:
        "Get the official rules for a casual employee becoming permanent (the NES employee choice pathway: when they can give notice, what the employer must do, the only grounds to refuse), with the earliest date for a given casual. Call it whenever a casual, or the owner, asks about becoming permanent or casual conversion.",
      inputSchema: {
        type: "object",
        properties: {
          employee_id: { type: ["integer", "null"], description: "Their id in the register (list_employees), or null if they are not in it or it is a general question." },
          start_date: { type: ["string", "null"], description: "Their start date (YYYY-MM-DD) as the owner gave it, only when they are not in the register; null otherwise." },
        },
        required: ["employee_id", "start_date"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { employee_id?: number | null; start_date?: string | null };
        const e = typeof a.employee_id === "number" ? register().get(a.employee_id) : null;
        const text = casualPathwayText({ start: e?.startDate ?? a.start_date ?? null, today: today(), small: smallBusinessOf(business().get().headcount), name: e?.name });
        const notCasual = e && e.employmentType !== "casual" ? `\n\nNote: the register has ${e.name} as ${e.employmentType}, not casual.` : "";
        return { success: true, text: text + notCasual, display: "casual to permanent" };
      },
    },
  ];
}
