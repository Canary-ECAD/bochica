import { isEmpty, type PartRecord } from "./document";

// The doctor's rules: one row per check, so a new rule is a row and a test. Property numbers
// and names are EPLAN's (the API documentation it installs, Eplan.EplApi.DataModelu.xml).

export type Severity = "serious" | "medium" | "minor";

export const SEVERITIES: readonly Severity[] = ["serious", "medium", "minor"];

export interface PartRule {
  id: string;
  /** EPLAN's property number, when the rule is about one property. */
  propertyId?: number;
  /** The export attribute it reads, when there is one. */
  property?: string;
  severity: Severity;
  /** The field `parts_fix` can set to fix it, if it can. */
  fixField?: FixField;
  fails(part: PartRecord): boolean;
}

/** What `parts_fix` may change: the rules' properties, never the part number. */
export const FIX_FIELDS = {
  erp: "P_ARTICLE_ERPNR",
  manufacturer: "P_ARTICLE_MANUFACTURER",
  description: "P_ARTICLE_NOTE",
  schematicMacro: "P_ARTICLE_GROUPSYMBOLMACRO",
  picture: "P_ARTICLE_PICTUREFILE",
} as const;
export type FixField = keyof typeof FIX_FIELDS;

/** The fields that hold text per language. */
export const MULTI_LANGUAGE_FIELDS: ReadonlySet<FixField> = new Set(["description"]);

const empty =
  (property: string) =>
  (part: PartRecord): boolean =>
    isEmpty(part.properties[property]);

export const PART_RULES: readonly PartRule[] = [
  {
    id: "part-number",
    propertyId: 22001,
    property: "P_ARTICLE_PARTNR",
    severity: "minor",
    fails: empty("P_ARTICLE_PARTNR"),
  },
  {
    id: "erp-number",
    propertyId: 22056,
    property: "P_ARTICLE_ERPNR",
    severity: "serious",
    fixField: "erp",
    // A discontinued part (22258) doesn't need one.
    fails: (part) =>
      isEmpty(part.properties["P_ARTICLE_ERPNR"]) &&
      part.properties["P_ARTICLE_DISCONTINUED"] !== "1",
  },
  {
    id: "manufacturer",
    propertyId: 22007,
    property: "P_ARTICLE_MANUFACTURER",
    severity: "serious",
    fixField: "manufacturer",
    fails: empty("P_ARTICLE_MANUFACTURER"),
  },
  {
    id: "description",
    propertyId: 22009,
    property: "P_ARTICLE_NOTE",
    severity: "serious",
    fixField: "description",
    fails: empty("P_ARTICLE_NOTE"),
  },
  {
    id: "schematic-macro",
    propertyId: 22145,
    property: "P_ARTICLE_GROUPSYMBOLMACRO",
    severity: "medium",
    fixField: "schematicMacro",
    fails: empty("P_ARTICLE_GROUPSYMBOLMACRO"),
  },
  {
    id: "picture",
    propertyId: 22045,
    property: "P_ARTICLE_PICTUREFILE",
    severity: "medium",
    fixField: "picture",
    fails: empty("P_ARTICLE_PICTUREFILE"),
  },
  {
    id: "function-templates",
    severity: "medium",
    fails: (part) => part.functionTemplates === 0,
  },
];

export const RULE_IDS: readonly string[] = PART_RULES.map((rule) => rule.id);
