import {
  AppInfo,
  type BochicaApi,
  ConnectionResult,
  CredentialList,
  ipcChannels,
} from "@bochica/shared";
import { contextBridge, ipcRenderer } from "electron";

const api: BochicaApi = {
  getAppInfo: async () => AppInfo.parse(await ipcRenderer.invoke(ipcChannels.appInfo)),
  credentials: {
    list: async () => CredentialList.parse(await ipcRenderer.invoke(ipcChannels.credentialsList)),
    set: async (request) =>
      CredentialList.parse(await ipcRenderer.invoke(ipcChannels.credentialsSet, request)),
    remove: async (id) =>
      CredentialList.parse(await ipcRenderer.invoke(ipcChannels.credentialsDelete, id)),
    test: async (provider) =>
      ConnectionResult.parse(await ipcRenderer.invoke(ipcChannels.credentialsTest, provider)),
  },
};

contextBridge.exposeInMainWorld("bochica", api);
