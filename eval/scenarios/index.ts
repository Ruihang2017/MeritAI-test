import type { Scenario } from "../types";
import { BUSINESS_OPS } from "./business-ops";
import { HIRING } from "./hiring";
import { PAY_LEAVE } from "./pay-leave";
import { PEOPLE } from "./people";
import { SAFETY } from "./safety";
import { ROUND1 } from "./round1";

export const SCENARIOS: Scenario[] = [...BUSINESS_OPS, ...HIRING, ...PAY_LEAVE, ...PEOPLE, ...SAFETY, ...ROUND1];
