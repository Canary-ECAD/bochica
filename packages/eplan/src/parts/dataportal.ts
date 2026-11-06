import { z } from "zod";

// The EPLAN Data Portal's public web API (https://dataportal.eplan.com/api/doc): part checks and
// part details answer without a token. Only documented endpoints are used, never the add-in's
// internal calls, which carry the EPLAN licence.

const DATA_PORTAL_API = "https://dataportal.eplan.com/api";
const USER_AGENT = "Bochica (github.com/Canary-ECAD/bochica)";
/** Numbers per `partscheck` request. */
const CHECK_CHUNK = 50;
const TIMEOUT_MS = 30_000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const Languages = z.record(z.string(), z.string()).catch({});

const CheckResult = z.object({
  data: z.array(
    z.object({
      type: z.string(),
      attributes: z.object({
        search: z.string(),
        partid: z.number().optional(),
        partnr: z.string().optional(),
        data_supplier: z.string().optional(),
        url: z.string().optional(),
      }),
    }),
  ),
});

const Relation = z
  .object({ data: z.union([z.array(z.unknown()), z.looseObject({}), z.null()]) })
  .optional();

const PartDetail = z.object({
  data: z.object({
    id: z.string(),
    attributes: z.object({
      part_number: z.string(),
      designation: Languages.optional(),
      description: Languages.optional(),
      data_supplier: z.string().optional(),
      group_symbol_macro_path: z.string().nullable().optional(),
      lifecycle: z.object({ name: z.string() }).partial().nullable().optional(),
    }),
    relationships: z
      .object({
        function_templates: Relation,
        picture_file: Relation,
      })
      .optional(),
  }),
});

export interface PortalPart {
  /** What was looked up. */
  search: string;
  found: boolean;
  id?: number;
  partNumber?: string;
  manufacturer?: string;
  url?: string;
  description?: Record<string, string>;
  designation?: Record<string, string>;
  schematicMacro?: string;
  functionTemplates?: number;
  picture?: boolean;
  lifecycle?: string;
}

export class DataPortalError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function request(fetcher: Fetch, path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(`${DATA_PORTAL_API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.api+json",
        "User-Agent": USER_AGENT,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    throw new DataPortalError(
      `The EPLAN Data Portal could not be reached (${error instanceof Error ? error.message : String(error)}). Check the internet connection or a proxy, and try again later.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) return null;
  if (response.status === 429) {
    throw new DataPortalError(
      "The EPLAN Data Portal asked to slow down (429). Wait a minute before looking up more parts.",
      429,
    );
  }
  if (!response.ok) {
    throw new DataPortalError(
      `The EPLAN Data Portal answered ${response.status}. It may be down; try again later.`,
      response.status,
    );
  }
  return response.json();
}

/** Which of these numbers (part, type or order numbers) the portal has. */
export async function checkParts(
  fetcher: Fetch,
  numbers: readonly string[],
): Promise<PortalPart[]> {
  const out: PortalPart[] = [];
  const unique = [...new Set(numbers.map((n) => n.trim()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += CHECK_CHUNK) {
    const chunk = unique.slice(i, i + CHECK_CHUNK);
    // One request at a time is kinder to the portal.
    // oxlint-disable-next-line no-await-in-loop
    const body = await request(fetcher, "/partscheck", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: chunk.join("\n"),
    });
    const parsed = body === null ? { data: [] } : CheckResult.parse(body);
    const bySearch = new Map<string, PortalPart>();
    for (const item of parsed.data) {
      const a = item.attributes;
      if (bySearch.has(a.search)) continue;
      bySearch.set(
        a.search,
        item.type === "partscheckresult" && a.partid !== undefined
          ? {
              search: a.search,
              found: true,
              id: a.partid,
              ...(a.partnr ? { partNumber: a.partnr } : {}),
              ...(a.data_supplier ? { manufacturer: a.data_supplier } : {}),
              ...(a.url ? { url: a.url } : {}),
            }
          : { search: a.search, found: false },
      );
    }
    for (const search of chunk) out.push(bySearch.get(search) ?? { search, found: false });
  }
  return out;
}

const count = (relation: z.infer<typeof Relation>): number => {
  const data = relation?.data;
  if (Array.isArray(data)) return data.length;
  return data ? 1 : 0;
};

/** A part's details: descriptions per language, schematic macro, function templates, picture. */
export async function partDetails(
  fetcher: Fetch,
  id: number,
): Promise<Omit<PortalPart, "search" | "found"> | null> {
  const body = await request(fetcher, `/parts/${id}`);
  if (body === null) return null;
  const { data } = PartDetail.parse(body);
  const a = data.attributes;
  return {
    id: Number(data.id),
    partNumber: a.part_number,
    ...(a.data_supplier ? { manufacturer: a.data_supplier } : {}),
    ...(a.description ? { description: a.description } : {}),
    ...(a.designation ? { designation: a.designation } : {}),
    ...(a.group_symbol_macro_path ? { schematicMacro: a.group_symbol_macro_path } : {}),
    functionTemplates: count(data.relationships?.function_templates),
    picture: count(data.relationships?.picture_file) > 0,
    ...(a.lifecycle?.name ? { lifecycle: a.lifecycle.name } : {}),
  };
}

/**
 * Looks parts up by their part number, with their details. A number not found as is, of the form
 * `MFR.rest`, is tried again as `rest`, and kept only if the portal's manufacturer is `MFR`. A hit
 * whose manufacturer differs from `manufacturers[number]` is not a match.
 */
export async function lookUpParts(
  fetcher: Fetch,
  partNumbers: readonly string[],
  manufacturers: ReadonlyMap<string, string> = new Map(),
): Promise<PortalPart[]> {
  const first = await checkParts(fetcher, partNumbers);
  const retry = new Map<string, string>();
  for (const result of first) {
    const dot = result.search.indexOf(".");
    if (!result.found && dot > 0) retry.set(result.search.slice(dot + 1), result.search);
  }
  const second = retry.size > 0 ? await checkParts(fetcher, [...retry.keys()]) : [];
  const results = new Map(first.map((r) => [r.search, r]));
  for (const hit of second) {
    const original = retry.get(hit.search);
    if (!original || !hit.found) continue;
    const prefix = original.slice(0, original.indexOf("."));
    if (hit.manufacturer?.toLowerCase() === prefix.toLowerCase()) {
      results.set(original, { ...hit, search: original });
    }
  }
  const out: PortalPart[] = [];
  for (const number of partNumbers) {
    const result = results.get(number.trim()) ?? { search: number, found: false };
    const expected = manufacturers.get(number)?.toLowerCase();
    if (
      result.found &&
      expected &&
      result.manufacturer &&
      result.manufacturer.toLowerCase() !== expected
    ) {
      out.push({ search: number, found: false });
      continue;
    }
    if (result.found && result.id !== undefined) {
      // One request at a time is kinder to the portal.
      // oxlint-disable-next-line no-await-in-loop
      const details = await partDetails(fetcher, result.id);
      out.push({ ...result, ...details, search: number, found: true });
    } else {
      out.push(result);
    }
  }
  return out;
}
