import type { BochicaApi } from "@bochica/shared";

declare global {
  interface Window {
    bochica: BochicaApi;
  }
}
