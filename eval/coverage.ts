// Prints scenario coverage: counts per category and business, Chinese and multi-turn shares.
import { SCENARIOS } from "./scenarios";
const count = (key: "category" | "persona") =>
  Object.entries(SCENARIOS.reduce<Record<string, number>>((a, s) => ((a[s[key]] = (a[s[key]] ?? 0) + 1), a), {}))
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
const ids = SCENARIOS.map((s) => s.id);
console.log(`scenarios: ${SCENARIOS.length} (duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(", ") || "none"})`);
console.log(`Chinese: ${SCENARIOS.filter((s) => /[\u4e00-\u9fff]/.test(s.turns.join(""))).length}, multi-turn: ${SCENARIOS.filter((s) => s.turns.length > 1).length}`);
console.log(`by category: ${count("category")}`);
console.log(`by business: ${count("persona")}`);
