import { z } from "zod";
import rawLock from "../../../components.lock.json";

// The EPLAN components are pinned to exact commits so that a push to another repository's main
// can never break a released app. Bump them with `bun run components:bump` (docs/releasing.md).
// eplan-mcp publishes tagged releases: its pin records the tag next to the commit it names.

const PinnedComponent = z.object({
  repository: z.url(),
  commit: z.string().regex(/^[0-9a-f]{40}$/, "must be a full 40-character commit SHA"),
  tag: z
    .string()
    .regex(/^v\d+\.\d+\.\d+$/, "must be a release tag vX.Y.Z")
    .optional(),
});

export const ComponentsLock = z.object({
  "eplan-mcp": PinnedComponent,
  "eplan-scripting-skill": PinnedComponent,
  "eec-pro-skill": PinnedComponent,
});
export type ComponentsLock = z.infer<typeof ComponentsLock>;

export const componentsLock: ComponentsLock = ComponentsLock.parse(rawLock);
