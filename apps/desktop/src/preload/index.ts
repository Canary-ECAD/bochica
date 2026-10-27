import { AppInfo, type BochicaApi, ipcChannels } from "@bochica/shared";
import { contextBridge, ipcRenderer } from "electron";

const api: BochicaApi = {
  getAppInfo: async () => AppInfo.parse(await ipcRenderer.invoke(ipcChannels.appInfo)),
};

contextBridge.exposeInMainWorld("bochica", api);
