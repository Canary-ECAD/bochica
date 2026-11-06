import { describe, expect, test } from "bun:test";
import { checkParts, DataPortalError, type Fetch, lookUpParts, partDetails } from "./dataportal";

// A made-up portal: DEMO.CT-100 by its part number, CT-200 by its type number (manufacturer
// DEMO), OTHER-1 belongs to another manufacturer.
const known: Record<string, { id: number; partnr: string; supplier: string }> = {
  "DEMO.CT-100": { id: 11, partnr: "DEMO.CT-100", supplier: "DEMO" },
  "CT-200": { id: 12, partnr: "DEMO.CT-200", supplier: "DEMO" },
  "OTHER-1": { id: 13, partnr: "ACME.OTHER-1", supplier: "ACME" },
};

function portal(calls: string[] = []): Fetch {
  return async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url.replace("https://dataportal.eplan.com/api", "")}`);
    if (url.endsWith("/partscheck")) {
      const searches = String(init?.body).split("\n");
      const data = searches.map((search) => {
        const hit = known[search];
        return hit
          ? {
              type: "partscheckresult",
              attributes: {
                search,
                partid: hit.id,
                partnr: hit.partnr,
                data_supplier: hit.supplier,
                url: `https://dataportal.eplan.com/part-details/${hit.supplier}/${hit.partnr}/id-${hit.id}`,
              },
            }
          : { type: "partscheckmissingresult", attributes: { search } };
      });
      return Response.json({ data });
    }
    const id = Number(url.split("/").at(-1));
    const hit = Object.values(known).find((k) => k.id === id);
    if (!hit) return new Response("", { status: 404 });
    return Response.json({
      data: {
        id: String(id),
        attributes: {
          part_number: hit.partnr,
          description: { en_US: `Part ${id}`, es_ES: `Pieza ${id}` },
          data_supplier: hit.supplier,
          group_symbol_macro_path: `Demo\\${id}.ema`,
          lifecycle: { value: 0, name: "Active" },
        },
        relationships: {
          function_templates: { data: [{ type: "function_template", id: "1" }] },
          picture_file: { data: null },
        },
      },
    });
  };
}

const busy: Fetch = async () => new Response("", { status: 429 });
const offline: Fetch = async () => {
  throw new Error("ECONNREFUSED");
};

describe("Data Portal", () => {
  test("partscheck splits found and missing, in chunks of 50", async () => {
    const calls: string[] = [];
    const numbers = ["DEMO.CT-100", ...Array.from({ length: 60 }, (_, i) => `NOPE-${i}`)];
    const results = await checkParts(portal(calls), numbers);
    expect(results).toHaveLength(61);
    expect(results[0]).toMatchObject({ found: true, id: 11, manufacturer: "DEMO" });
    expect(results[1]).toEqual({ search: "NOPE-0", found: false });
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(2);
  });

  test("details: descriptions, macro, function templates, picture, lifecycle", async () => {
    const details = await partDetails(portal(), 11);
    expect(details).toMatchObject({
      partNumber: "DEMO.CT-100",
      description: { es_ES: "Pieza 11" },
      schematicMacro: "Demo\\11.ema",
      functionTemplates: 1,
      picture: false,
      lifecycle: "Active",
    });
    expect(await partDetails(portal(), 999)).toBeNull();
  });

  test("lookup retries MFR.number as number and keeps it only for that manufacturer", async () => {
    const results = await lookUpParts(
      portal(),
      ["DEMO.CT-100", "DEMO.CT-200", "DEMO.OTHER-1", "MISSING"],
      new Map([["DEMO.CT-100", "DEMO"]]),
    );
    expect(results.map((r) => [r.search, r.found])).toEqual([
      ["DEMO.CT-100", true],
      ["DEMO.CT-200", true],
      ["DEMO.OTHER-1", false],
      ["MISSING", false],
    ]);
    expect(results[1]?.id).toBe(12);
  });

  test("a different manufacturer in the database is not a match", async () => {
    const results = await lookUpParts(
      portal(),
      ["DEMO.CT-100"],
      new Map([["DEMO.CT-100", "ACME"]]),
    );
    expect(results[0]?.found).toBe(false);
  });

  test("429 and network failures become sentences", async () => {
    expect(checkParts(busy, ["X"])).rejects.toThrow("slow down");
    const error = await checkParts(offline, ["X"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataPortalError);
    expect(String(error)).toContain("could not be reached");
  });
});
