/**
 * Starting points for a new job (owner, 2026-09-27): common small-business roles by industry,
 * each with a generic job description the owner edits before use. Generic on purpose: nothing
 * here is about a particular business (the business profile fills in who they are). No pay
 * figures: the likely award is a hint to confirm with the Award finder and the Pay and Conditions
 * Tool. Award names and codes checked on the Fair Work list of awards on 2026-09-28.
 */

export interface JobTemplate {
  id: string;
  industry: IndustryId;
  title: string;
  /** Other names people search for. */
  also: string[];
  /** One line for the list. */
  summary: string;
  duties: string[];
  essential: string[];
  desirable: string[];
  /** Typical employment types for the role (the owner picks). */
  types: ("full-time" | "part-time" | "casual" | "fixed-term")[];
  /** Licences, checks or tickets to check for this role (names and rules differ by state). */
  checks: string[];
  /** The award that most likely covers the role; confirm with the Award finder. */
  award: { code: string; name: string } | null;
}

export type IndustryId = "hospitality" | "retail" | "cleaning" | "trades" | "office" | "care" | "beauty" | "transport" | "automotive" | "outdoor";

export const INDUSTRIES: { id: IndustryId; name: string; words: RegExp }[] = [
  { id: "hospitality", name: "Hospitality", words: /caf[eé]|restaurant|hospitality|bar|pub|hotel|catering|food|coffee|bakery|takeaway/i },
  { id: "retail", name: "Retail", words: /retail|shop|store|boutique|pharmacy|chemist/i },
  { id: "cleaning", name: "Cleaning and facilities", words: /clean|facilit|janitor|property services/i },
  { id: "trades", name: "Trades and construction", words: /construct|build|carpent|plumb|electric|trade|renovat|joinery/i },
  { id: "office", name: "Office and admin", words: /office|admin|account|consult|professional|agency|real estate|law|finance/i },
  { id: "care", name: "Health, care and childcare", words: /care|health|medical|dental|clinic|child|early learning|disabilit|aged|physio/i },
  { id: "beauty", name: "Hair, beauty and fitness", words: /hair|beauty|salon|barber|nail|spa|fitness|gym|studio/i },
  { id: "transport", name: "Transport and warehouse", words: /transport|logistic|courier|deliver|warehouse|freight|distribution|wholesale/i },
  { id: "automotive", name: "Automotive", words: /auto|mechanic|motor|vehicle|car |tyre|panel/i },
  { id: "outdoor", name: "Gardening and landscaping", words: /garden|landscap|lawn|nursery|horticult|tree/i },
];

const A = {
  restaurant: { code: "MA000119", name: "Restaurant Industry Award" },
  hospitality: { code: "MA000009", name: "Hospitality Industry (General) Award" },
  fastFood: { code: "MA000003", name: "Fast Food Industry Award" },
  retail: { code: "MA000004", name: "General Retail Industry Award" },
  pharmacy: { code: "MA000012", name: "Pharmacy Industry Award" },
  cleaning: { code: "MA000022", name: "Cleaning Services Award" },
  construction: { code: "MA000020", name: "Building and Construction General On-site Award" },
  electrical: { code: "MA000025", name: "Electrical, Electronic and Communications Contracting Award" },
  plumbing: { code: "MA000036", name: "Plumbing and Fire Sprinklers Award" },
  clerks: { code: "MA000002", name: "Clerks - Private Sector Award" },
  aged: { code: "MA000018", name: "Aged Care Award" },
  schads: { code: "MA000100", name: "Social, Community, Home Care and Disability Services Industry Award" },
  children: { code: "MA000120", name: "Children's Services Award" },
  health: { code: "MA000027", name: "Health Professionals and Support Services Award" },
  hair: { code: "MA000005", name: "Hair and Beauty Industry Award" },
  fitness: { code: "MA000094", name: "Fitness Industry Award" },
  road: { code: "MA000038", name: "Road Transport and Distribution Award" },
  storage: { code: "MA000084", name: "Storage Services and Wholesale Award" },
  vehicle: { code: "MA000089", name: "Vehicle Repair, Services and Retail Award" },
  gardening: { code: "MA000101", name: "Gardening and Landscaping Services Award" },
};

const t = (industry: IndustryId, id: string, title: string, also: string[], summary: string, duties: string[], essential: string[], desirable: string[], types: JobTemplate["types"], checks: string[], award: JobTemplate["award"]): JobTemplate => ({ id, industry, title, also, summary, duties, essential, desirable, types, checks, award });

export const JOB_TEMPLATES: JobTemplate[] = [
  // ---------------------------------------------------------------- hospitality
  t("hospitality", "barista", "Barista", ["coffee maker", "café all-rounder"], "Makes great coffee and keeps the café moving in busy periods.",
    ["Make espresso-based and specialty coffee to a consistent standard", "Take orders and payments, and look after customers at the counter", "Keep the coffee station, grinders and machine clean; dial in the grind each morning", "Help with food prep, serving and clearing when it's busy", "Follow food safety and cleaning routines"],
    ["Experience making espresso coffee in a commercial café", "Friendly, clear communication with customers", "Can work the café's hours, including weekends if the roster needs it"],
    ["Latte art", "Point-of-sale (POS) experience", "Food handling or food safety training"],
    ["casual", "part-time", "full-time"], ["Food safety training may be needed in your state for food handlers"], A.restaurant),
  t("hospitality", "cook", "Cook", ["chef", "line cook", "commis chef"], "Prepares and cooks the menu to standard, safely and on time.",
    ["Prepare and cook menu items to the recipe and presentation standard", "Set up and pack down the section; keep the kitchen clean", "Receive and store deliveries; rotate stock and label food", "Follow food safety, allergen and temperature-control procedures", "Help plan prep and keep waste down"],
    ["Experience cooking in a commercial kitchen", "Knows safe food handling, including allergens", "Works well under pressure in a team"],
    ["Commercial cookery qualification (e.g. Certificate III or IV)", "Experience with the kind of menu you run", "Ordering and stock control"],
    ["full-time", "part-time", "casual"], ["Food safety supervisor rules apply to some food businesses: check your state"], A.restaurant),
  t("hospitality", "kitchen-hand", "Kitchen hand", ["dishwasher", "kitchen assistant", "kitchen porter"], "Keeps the kitchen clean and helps with basic prep.",
    ["Wash dishes, pots and equipment", "Keep benches, floors and cool rooms clean and tidy", "Help with basic food prep as directed", "Put away deliveries and take out waste and recycling", "Follow food safety and cleaning schedules"],
    ["Reliable and on time", "Can work on your feet in a busy kitchen", "Follows instructions and safety procedures"],
    ["Kitchen or cleaning experience", "Food handling training"],
    ["casual", "part-time"], [], A.restaurant),
  t("hospitality", "front-of-house", "Waiter / front of house", ["waitress", "waitstaff", "food and beverage attendant", "server"], "Looks after guests from the door to the bill.",
    ["Greet and seat guests, take orders and serve food and drinks", "Know the menu, including allergens, and make good suggestions", "Take payments and handle bookings", "Set up and pack down the dining room", "Keep the floor clean and tidy"],
    ["Customer service experience", "Can carry plates and work busy services", "Clear communication and a friendly manner"],
    ["Responsible service of alcohol (RSA) certificate", "Experience with a booking or POS system", "Barista skills"],
    ["casual", "part-time"], ["An RSA certificate is needed to serve alcohol (the rules differ by state)"], A.restaurant),
  t("hospitality", "bar-attendant", "Bar attendant", ["bartender", "bar staff", "cocktail bartender"], "Serves drinks responsibly and keeps the bar running.",
    ["Serve beer, wine, spirits and cocktails to standard", "Serve alcohol responsibly and refuse service when required", "Keep the bar stocked, clean and organised", "Take payments and balance the till", "Look after customers and help keep the venue safe"],
    ["Responsible service of alcohol (RSA) certificate for your state", "Bar or customer service experience", "Can work nights and weekends"],
    ["Cocktail or wine knowledge", "Cellar and keg changes", "Responsible conduct of gambling (RCG), if you have gaming"],
    ["casual", "part-time", "full-time"], ["RSA certificate required to serve alcohol (the rules differ by state)"], A.hospitality),
  t("hospitality", "venue-manager", "Café or restaurant manager", ["venue manager", "restaurant supervisor", "shift manager"], "Runs service, the team and the numbers day to day.",
    ["Run daily service and lead the floor and kitchen teams", "Roster staff within the budget and train new starters", "Order stock, manage suppliers and control costs", "Handle customer feedback and complaints", "Make sure food safety, work health and safety and cash handling procedures are followed"],
    ["Experience supervising a hospitality team", "Rostering and stock ordering experience", "Calm, clear leader during busy service"],
    ["RSA certificate", "Food safety supervisor certificate", "Experience with rostering or POS software"],
    ["full-time"], ["RSA if the venue serves alcohol; a food safety supervisor may be required in your state"], A.restaurant),

  // ---------------------------------------------------------------- retail
  t("retail", "retail-assistant", "Retail assistant", ["sales assistant", "shop assistant", "retail team member"], "Helps customers, runs the till and keeps the store looking good.",
    ["Greet customers, find out what they need and help them choose", "Process sales, returns and lay-bys at the register", "Restock shelves and keep displays tidy", "Receive deliveries and help with stocktake", "Keep the store clean and safe"],
    ["Friendly customer service", "Can use a till or POS system, or learn quickly", "Available for the store's trading hours, including weekends if rostered"],
    ["Retail experience", "Product knowledge in your category", "Visual merchandising"],
    ["casual", "part-time", "full-time"], [], A.retail),
  t("retail", "store-supervisor", "Store supervisor / assistant manager", ["2IC", "assistant store manager", "shift supervisor"], "Leads shifts and steps in for the manager.",
    ["Open and close the store and lead the team on shift", "Coach team members on service and sales", "Handle customer complaints and returns", "Manage cash, banking and store security", "Help with rosters, stock and store standards"],
    ["Retail experience, including leading a shift or small team", "Cash handling and opening and closing procedures", "Good problem-solving with customers"],
    ["Rostering experience", "Stock control or inventory systems", "Visual merchandising"],
    ["full-time", "part-time"], [], A.retail),
  t("retail", "store-manager", "Store manager", ["shop manager", "retail manager"], "Runs the store: team, sales, stock and standards.",
    ["Lead, roster, train and support the store team", "Drive sales and customer service; track targets", "Manage stock, ordering and shrinkage", "Keep the store safe, clean and on brand", "Report to the owner on trading, costs and people"],
    ["Experience managing a retail store or department", "Leading and developing a team", "Comfortable with sales figures, rosters and budgets"],
    ["Experience in your product category", "Inventory or POS system experience"],
    ["full-time"], [], A.retail),
  t("retail", "pharmacy-assistant", "Pharmacy assistant", ["pharmacy retail assistant", "dispensary assistant"], "Helps customers and supports the pharmacist.",
    ["Serve customers and process sales", "Help customers find products and refer medicine questions to the pharmacist", "Restock and face shelves; check dates", "Help in the dispensary as directed (if trained)", "Keep the pharmacy clean and tidy"],
    ["Customer service experience", "Discreet with customers' health information", "Accurate and careful"],
    ["Pharmacy assistant qualification (e.g. Certificate II or III in Community Pharmacy)", "Dispensary experience"],
    ["casual", "part-time", "full-time"], [], A.pharmacy),

  // ---------------------------------------------------------------- cleaning
  t("cleaning", "cleaner", "Cleaner", ["commercial cleaner", "office cleaner", "contract cleaner"], "Cleans sites to the schedule and standard.",
    ["Clean offices, washrooms, kitchens and common areas to the site's schedule", "Vacuum, mop and empty bins and recycling", "Restock consumables and report maintenance issues", "Use chemicals and equipment safely", "Lock up and follow site security procedures"],
    ["Reliable and on time, with attention to detail", "Can follow cleaning schedules and safety procedures", "Can work the site's hours (early mornings or evenings)"],
    ["Commercial cleaning experience", "Floor machine experience", "Own transport or a driver licence (for several sites)"],
    ["casual", "part-time"], ["A police check may be needed for some sites"], A.cleaning),
  t("cleaning", "cleaning-supervisor", "Cleaning team leader", ["cleaning supervisor", "site supervisor"], "Leads a cleaning crew and keeps sites to standard.",
    ["Lead and roster a team of cleaners across one or more sites", "Inspect work and fix quality issues quickly", "Train new cleaners in methods, chemicals and safety", "Order supplies and look after equipment", "Be the contact for site managers"],
    ["Commercial cleaning experience, including leading a team", "Good communication with staff and clients", "Driver licence (travel between sites)"],
    ["First aid certificate", "Experience with rostering or quality apps"],
    ["full-time", "part-time"], ["A police check may be needed for some sites"], A.cleaning),

  // ---------------------------------------------------------------- trades and construction
  t("trades", "labourer", "Construction labourer", ["site labourer", "general hand", "builder's labourer"], "Keeps the site safe, clean and supplied.",
    ["Prepare, clean and tidy the site", "Move materials and help tradespeople", "Use hand and power tools safely", "Follow the site's safety plan and report hazards", "Load and unload deliveries"],
    ["General construction induction card (White Card)", "Physically able to do manual work", "Follows safety instructions"],
    ["Construction site experience", "Driver licence", "Tickets for plant or equipment you use (e.g. forklift)"],
    ["full-time", "casual"], ["White Card (general construction induction) required on construction sites", "High risk work licences for some equipment (e.g. forklift)"], A.construction),
  t("trades", "carpenter", "Carpenter", ["chippy", "builder", "formworker"], "Builds and fixes to plan, safely and to standard.",
    ["Read plans and set out work", "Frame, fit off and finish to the required standard", "Use tools and machinery safely", "Work with other trades and the site supervisor", "Keep the work area clean and safe"],
    ["Carpentry trade qualification or equivalent experience", "White Card", "Own hand tools and a driver licence"],
    ["Residential or commercial experience matching your work", "Supervising apprentices"],
    ["full-time"], ["White Card required on construction sites"], A.construction),
  t("trades", "electrician", "Electrician", ["sparky", "electrical tradesperson"], "Installs and maintains electrical work safely and to code.",
    ["Install, test and maintain wiring and fittings", "Find and fix faults", "Work to the wiring rules and complete compliance paperwork", "Quote small jobs and talk with customers on site", "Keep tools, test equipment and the van in order"],
    ["Electrical licence for your state", "White Card for construction sites", "Driver licence"],
    ["Experience with your type of work (domestic, commercial, industrial)", "Solar or data cabling"],
    ["full-time"], ["An electrical licence from the state regulator is required for electrical work"], A.electrical),
  t("trades", "plumber", "Plumber", ["plumbing tradesperson", "gasfitter"], "Installs and repairs plumbing to code and keeps customers happy.",
    ["Install and repair water, drainage and gas systems", "Diagnose problems and explain options to customers", "Complete compliance certificates and job paperwork", "Keep the van stocked and the site clean", "Work safely around sites and customers' homes"],
    ["Plumbing licence for your state", "Driver licence", "Good customer communication"],
    ["Gasfitting licence", "Maintenance or new-build experience"],
    ["full-time"], ["A plumbing (and gasfitting) licence from the state regulator is required"], A.plumbing),
  t("trades", "apprentice", "Apprentice (trade)", ["trainee", "first-year apprentice"], "Learns the trade on the job with training.",
    ["Learn the trade under a qualified tradesperson", "Help with jobs and keep tools and the van in order", "Attend training (TAFE or a registered training organisation) as scheduled", "Follow safety procedures on site", "Keep a record of work and training"],
    ["Keen to learn the trade", "Reliable and on time", "Can get to the workshop or sites"],
    ["Driver licence or learner's permit", "Some hands-on experience (school, part-time work)"],
    ["full-time"], ["An apprenticeship needs a training contract registered with the state training authority", "White Card before working on construction sites"], null),

  // ---------------------------------------------------------------- office and admin
  t("office", "receptionist", "Receptionist", ["front desk", "office receptionist", "customer service officer"], "The first contact for customers, calls and visitors.",
    ["Answer calls and emails, and greet visitors", "Manage bookings and the calendar", "Handle mail, deliveries and office supplies", "Keep records and simple data entry up to date", "Support the team with admin tasks"],
    ["Customer service or reception experience", "Clear phone and email manner", "Comfortable with email, calendar and Office-type software"],
    ["Experience with your booking or practice system", "Basic invoicing"],
    ["part-time", "full-time", "casual"], [], A.clerks),
  t("office", "office-admin", "Office administrator", ["admin assistant", "office coordinator", "administration officer"], "Keeps the office running: admin, records and support.",
    ["Handle day-to-day admin: correspondence, filing and records", "Enter data and keep systems up to date", "Help with invoices, purchase orders and supplier contact", "Coordinate meetings, travel and office supplies", "Support the owner and team with ad hoc tasks"],
    ["Office administration experience", "Accurate and organised", "Good with spreadsheets, email and documents"],
    ["Experience with your accounting or CRM software", "Rostering or payroll admin"],
    ["full-time", "part-time"], [], A.clerks),
  t("office", "bookkeeper", "Bookkeeper / accounts officer", ["accounts payable", "accounts receivable", "finance officer"], "Keeps the books accurate and on time.",
    ["Process supplier invoices and customer receipts", "Reconcile bank accounts", "Prepare invoices and follow up overdue accounts", "Help with payroll and BAS preparation", "Keep financial records in order"],
    ["Bookkeeping experience", "Experience with accounting software (e.g. Xero or MYOB)", "Accurate with numbers"],
    ["Payroll experience", "Registered BAS agent, or working with one"],
    ["part-time", "full-time"], ["BAS services for others need a registered BAS agent"], A.clerks),
  t("office", "office-manager", "Office manager", ["operations coordinator", "practice manager"], "Runs the office and supports the owner.",
    ["Run office operations, systems and suppliers", "Coordinate the team's admin and priorities", "Help with HR admin: onboarding paperwork and records", "Manage budgets for office costs", "Improve processes and keep records compliant"],
    ["Office or operations management experience", "Organised, with good judgement", "Confident with software and spreadsheets"],
    ["HR or payroll admin experience", "Experience in your industry"],
    ["full-time"], [], A.clerks),

  // ---------------------------------------------------------------- health, care and childcare
  t("care", "aged-care-worker", "Aged care worker", ["personal care worker", "PCW", "assistant in nursing"], "Provides personal care and support to older people.",
    ["Help residents or clients with personal care, meals and mobility", "Support their independence, dignity and wellbeing", "Record care and report changes to the nurse or coordinator", "Follow infection control and manual handling procedures", "Work with families and the care team"],
    ["Caring, respectful manner", "Can work rostered shifts, including weekends", "Follows care plans and procedures"],
    ["Certificate III in Individual Support (Ageing) or similar", "First aid certificate", "Aged care experience"],
    ["part-time", "casual", "full-time"], ["A police check (or aged care worker screening as required) before starting"], A.aged),
  t("care", "disability-support", "Disability support worker", ["support worker", "NDIS support worker", "community support worker"], "Supports people with disability to live the life they choose.",
    ["Support clients with daily living, community access and personal care", "Follow support plans and each client's goals", "Write shift notes and report incidents", "Drive clients to activities if required", "Respect clients' rights, choices and privacy"],
    ["Respectful, patient and reliable", "NDIS worker screening check", "Driver licence (if the role involves driving)"],
    ["Certificate III or IV in Disability or Individual Support", "First aid certificate", "Experience with complex support needs"],
    ["casual", "part-time"], ["NDIS worker screening check for NDIS-funded supports", "Working with children check if supporting children"], A.schads),
  t("care", "early-childhood-educator", "Early childhood educator", ["childcare worker", "child care educator", "room leader"], "Plans and delivers care and learning for young children.",
    ["Care for children's safety, health and wellbeing", "Plan and run play-based learning under the approved framework", "Document children's learning and share it with families", "Keep the room clean, safe and inviting", "Work with the team and families"],
    ["Early childhood qualification (e.g. Certificate III, or working towards one)", "Working with children check for your state", "First aid, asthma and anaphylaxis training"],
    ["Diploma in Early Childhood Education and Care", "Room leader experience"],
    ["full-time", "part-time", "casual"], ["Working with children check required (the name differs by state)", "Qualification requirements are set under the national law"], A.children),
  t("care", "medical-receptionist", "Medical receptionist", ["practice receptionist", "clinic receptionist", "patient services officer"], "Looks after patients at the front desk and keeps the clinic running.",
    ["Greet patients, make appointments and handle calls", "Process payments, claims and billing", "Keep patient records private and up to date", "Help keep the waiting room and front desk organised", "Support the practitioners with admin"],
    ["Reception or customer service experience", "Careful with private health information", "Calm with busy or unwell patients"],
    ["Experience with practice software", "Medicare and health fund billing"],
    ["part-time", "full-time", "casual"], [], A.health),
  t("care", "dental-assistant", "Dental assistant", ["dental nurse", "chairside assistant"], "Assists the dentist chairside and keeps the surgery safe.",
    ["Prepare the surgery and assist the dentist during treatment", "Sterilise instruments and follow infection control", "Help patients feel at ease", "Keep records and handle bookings and payments when needed", "Manage stock of dental supplies"],
    ["Dental assisting experience or qualification (or training towards one)", "Strict with infection control", "Friendly with patients"],
    ["Certificate III or IV in Dental Assisting", "Radiography qualification (where allowed)"],
    ["full-time", "part-time"], [], A.health),

  // ---------------------------------------------------------------- hair, beauty and fitness
  t("beauty", "hairdresser", "Hairdresser", ["hair stylist", "senior stylist", "colourist"], "Cuts, colours and styles, and keeps clients coming back.",
    ["Consult with clients and recommend services", "Cut, colour and style to a high standard", "Rebook clients and recommend products", "Keep your station and the salon clean and hygienic", "Help train juniors"],
    ["Hairdressing qualification (or equivalent experience)", "Strong cutting and colouring skills", "Great client service"],
    ["An existing client base", "Barbering or specialist colour skills"],
    ["full-time", "part-time", "casual"], [], A.hair),
  t("beauty", "beauty-therapist", "Beauty therapist", ["beautician", "skin therapist", "nail technician"], "Delivers treatments with care and great hygiene.",
    ["Consult clients and perform treatments (skin, waxing, lashes, nails, as offered)", "Keep treatment rooms clean and hygienic", "Recommend and sell products", "Rebook clients and keep records", "Follow safety and hygiene standards"],
    ["Beauty qualification (e.g. Certificate IV or Diploma of Beauty Therapy) or equivalent experience", "Excellent hygiene and client care"],
    ["Experience with your treatments and equipment", "Retail sales experience"],
    ["part-time", "full-time", "casual"], ["Some treatments need a licence or registration in some states: check yours"], A.hair),
  t("beauty", "personal-trainer", "Personal trainer / fitness instructor", ["PT", "group fitness instructor", "gym instructor"], "Trains clients safely and keeps them motivated.",
    ["Run personal training sessions and classes", "Assess clients and write programs", "Teach safe technique and use of equipment", "Help keep the gym floor clean and safe", "Support memberships and client retention"],
    ["Certificate III and IV in Fitness (or equivalent)", "Current first aid and CPR", "Great communication and motivation"],
    ["Registration with a fitness industry body", "Experience with group classes"],
    ["casual", "part-time", "full-time"], ["Working with children check if training under-18s"], A.fitness),

  // ---------------------------------------------------------------- transport and warehouse
  t("transport", "delivery-driver", "Delivery driver", ["courier", "van driver", "multi-drop driver"], "Delivers on time, safely and with care.",
    ["Load and deliver goods on schedule", "Plan routes and use the delivery app", "Check the vehicle before each shift and report faults", "Get signatures or photos as proof of delivery", "Look after customers at the door"],
    ["Current driver licence for the vehicle (e.g. car or light rigid)", "Good driving record", "Physically able to lift and carry deliveries"],
    ["Local knowledge", "Delivery or courier experience"],
    ["casual", "part-time", "full-time"], ["Licence class to suit the vehicle"], A.road),
  t("transport", "truck-driver", "Truck driver", ["MR driver", "HR driver", "rigid truck driver"], "Moves freight safely and on time.",
    ["Drive to schedule and within road rules and fatigue rules", "Load, restrain and unload freight", "Do pre-start checks and log faults", "Keep delivery paperwork or app records", "Look after the truck and equipment"],
    ["Heavy vehicle licence for the truck (e.g. MR or HR)", "Safe driving record", "Knows load restraint"],
    ["Forklift licence", "Experience with your freight type"],
    ["full-time", "casual"], ["Heavy vehicle licence class to suit the truck", "Fatigue management rules may apply"], A.road),
  t("transport", "storeperson", "Storeperson / warehouse hand", ["warehouse worker", "picker packer", "forklift operator"], "Receives, stores and sends out stock accurately.",
    ["Receive and check deliveries", "Pick, pack and dispatch orders accurately", "Keep the warehouse clean, safe and organised", "Operate equipment safely (including forklift if licensed)", "Help with stocktakes"],
    ["Warehouse or picking experience", "Accurate and safety-minded", "Physically able to do manual handling"],
    ["Forklift licence (LF)", "Experience with a warehouse system or scanners"],
    ["casual", "full-time", "part-time"], ["A high risk work licence is needed to operate a forklift"], A.storage),

  // ---------------------------------------------------------------- automotive
  t("automotive", "mechanic", "Mechanic / automotive technician", ["motor mechanic", "light vehicle technician", "service technician"], "Services and repairs vehicles to a high standard.",
    ["Service and repair vehicles to manufacturer specifications", "Diagnose faults using diagnostic equipment", "Explain work needed and record jobs accurately", "Road test vehicles and check quality", "Keep the workshop clean and safe"],
    ["Automotive trade qualification (or equivalent experience)", "Driver licence", "Diagnostic skills"],
    ["Experience with the makes you service", "Air-conditioning or other licences you need"],
    ["full-time"], ["Some work needs a licence (e.g. vehicle air-conditioning)"], A.vehicle),
  t("automotive", "service-advisor", "Service advisor", ["service receptionist", "workshop coordinator"], "Books jobs, talks with customers and keeps the workshop on schedule.",
    ["Book services and talk customers through work needed", "Write job cards and quotes", "Keep customers updated and handle payments", "Coordinate the workshop's schedule and parts", "Handle feedback and complaints"],
    ["Customer service experience", "Organised and clear on the phone", "Comfortable with booking and workshop software"],
    ["Automotive knowledge", "Experience in a workshop or dealership"],
    ["full-time", "part-time"], [], A.vehicle),

  // ---------------------------------------------------------------- gardening and landscaping
  t("outdoor", "gardener", "Gardener / landscaper", ["landscape labourer", "groundsperson", "maintenance gardener"], "Keeps gardens and grounds looking great, safely.",
    ["Mow, prune, weed and maintain gardens", "Install plants, irrigation and simple landscaping", "Use and maintain equipment safely", "Remove green waste and keep sites tidy", "Talk with clients about their gardens"],
    ["Experience in gardening or landscaping", "Driver licence", "Physically able to work outdoors"],
    ["Horticulture qualification", "Chemical handling certificate", "Trailer towing experience"],
    ["full-time", "casual", "part-time"], ["Chemical use may need training or a licence in your state"], A.gardening),
];

/** Industries matching the business profile's industry (best first); empty when nothing matches. */
export function industriesFor(profileIndustry: string | null): IndustryId[] {
  if (!profileIndustry) return [];
  return INDUSTRIES.filter((i) => i.words.test(profileIndustry)).map((i) => i.id);
}

/** Templates matching a search (title, other names, summary), best first. */
export function searchTemplates(q: string, industry?: IndustryId | null): JobTemplate[] {
  const w = q.toLowerCase().trim();
  const pool = industry ? JOB_TEMPLATES.filter((x) => x.industry === industry) : JOB_TEMPLATES;
  if (!w) return pool;
  const score = (x: JobTemplate) => (x.title.toLowerCase().includes(w) ? 3 : x.also.some((a) => a.toLowerCase().includes(w)) ? 2 : x.summary.toLowerCase().includes(w) ? 1 : 0);
  return JOB_TEMPLATES.map((x) => ({ x, s: score(x) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.x);
}

/**
 * What the job description says about pay (owner, 2026-09-29; design: NewJobEdit, NewJobPay). MeritAI never
 * works out pay: "award" names the template's likely award without a figure; "above" and "salary" copy what the
 * owner typed; "none" leaves pay out.
 */
export type PayMode = "award" | "above" | "salary" | "none";
export const PAY_MODES: { id: PayMode; label: string }[] = [
  { id: "award", label: "Award rate" },
  { id: "above", label: "Above award" },
  { id: "salary", label: "Salary" },
  { id: "none", label: "Don't show" },
];

/** Examples under the Hours field, by employment type (a click fills the field). No pay figures. */
export const HOURS_EXAMPLES: Record<string, string[]> = {
  "full-time": ["Mon to Fri, 38 hours a week", "Mon to Fri, 7 am to 3.30 pm"],
  "part-time": ["About 20 hours a week, days to agree", "Tue to Thu, 9 am to 3 pm"],
  casual: ["Weekend shifts as rostered", "Sat and Sun, 6 am to 10 am", "Evenings, about 15 hours a week"],
  "fixed-term": ["Mon to Fri, 38 hours a week, for 6 months", "Mon to Fri, 7 am to 3.30 pm, until [end date]"],
};

/** The pay line for a mode (null: no line). Without a mode, the older placeholder. */
export function payLine(t: JobTemplate, mode: PayMode | undefined, typed: string): string | null {
  const text = typed.trim();
  switch (mode) {
    case "award":
      return t.award ? `Award rate for the level (${t.award.name})` : "Award rate for the role and level";
    case "above":
      return text || "[Your hourly rate]";
    case "salary":
      return text || "[Your salary]";
    case "none":
      return null;
    default:
      return text || "[Rate under the award for the level, or your above-award rate]";
  }
}

export interface JdOptions {
  jobName: string;
  business: string | null;
  employmentType: string;
  hours: string;
  location: string;
  /** The owner's own figure, for "above" and "salary". */
  pay: string;
  payMode?: PayMode;
  start: string;
  duties: string[];
  essential: string[];
  desirable: string[];
}

/** The job description (markdown) from a template and the owner's choices; bracketed placeholders for what only they know. */
export function jobDescription(t: JobTemplate, o: JdOptions): string {
  const biz = o.business ?? "[Business name]";
  const bullet = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  const pay = payLine(t, o.payMode, o.pay);
  return [
    `# ${o.jobName}`,
    "",
    `**${biz}** · ${o.employmentType || "[Employment type]"} · ${o.location || "[Location]"}`,
    "",
    "## About us",
    "",
    `[One or two sentences about ${biz}: what you do, your customers, what it's like to work here.]`,
    "",
    "## The role",
    "",
    t.summary,
    "",
    "## What you'll do",
    "",
    bullet(o.duties),
    "",
    "## What you'll bring",
    "",
    bullet(o.essential),
    ...(o.desirable.length ? ["", "## Nice to have", "", bullet(o.desirable)] : []),
    "",
    pay === null ? "## Hours" : "## Hours and pay",
    "",
    `- Hours: ${o.hours || "[Days and hours]"}`,
    ...(pay === null ? [] : [`- Pay: ${pay}`]),
    ...(o.start ? [`- Start: ${o.start}`] : []),
    "",
    "## How to apply",
    "",
    "[How to apply: e.g. send your resume and a short note to [email] by [date].]",
    "",
  ].join("\n");
}
