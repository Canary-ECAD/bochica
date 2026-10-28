import { z } from "zod";
import rawLock from "../../../components.lock.json";

// The EPLAN components are pinned to exact commits so that a push to another repository's main
// can never break a released app. Bump them by editing components.lock.json at the repo root.

const PinnedComponent = z.object({
  repository: z.url(),
  commit: z.string().regex(/^[0-9a-f]{40}$/, "must be a full 40-character commit SHA"),
});

export const ComponentsLock = z.object({
  "eplan-mcp": PinnedComponent,
  "eplan-scripting-skill": PinnedComponent,
  "eec-pro-skill": PinnedComponent,
});
export type ComponentsLock = z.infer<typeof ComponentsLock>;

export const componentsLock: ComponentsLock = ComponentsLock.parse(rawLock);
