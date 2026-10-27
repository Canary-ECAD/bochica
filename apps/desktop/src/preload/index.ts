import {
  AppInfo,
  ApprovalRequest,
  type BochicaApi,
  ChatEvent,
  ConnectionResult,
  CredentialList,
  EplanStatus,
  ipcChannels,
  McpServerList,
  ModelList,
  SessionDetail,
  SessionSummary,
} from "@bochica/shared";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { z } from "zod";

/** Listens to a main → renderer channel, passing on only payloads that match the schema. */
function subscribe<T>(channel: string, schema: z.ZodType<T>, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, payload: unknown): void => {
    const parsed = schema.safeParse(payload);
    if (parsed.success) listener(parsed.data);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

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
  models: {
    list: async (provider) =>
      ModelList.parse(await ipcRenderer.invoke(ipcChannels.modelsList, provider)),
  },
  chat: {
    send: async (request) => {
      await ipcRenderer.invoke(ipcChannels.chatSend, request);
    },
    stop: async (turnId) => {
      await ipcRenderer.invoke(ipcChannels.chatStop, turnId);
    },
    onEvent: (listener) => subscribe(ipcChannels.chatEvent, ChatEvent, listener),
  },
  mcp: {
    list: async () => McpServerList.parse(await ipcRenderer.invoke(ipcChannels.mcpList)),
    setEnabled: async (request) =>
      McpServerList.parse(await ipcRenderer.invoke(ipcChannels.mcpSetEnabled, request)),
    onChange: (listener) => subscribe(ipcChannels.mcpChanged, McpServerList, listener),
  },
  approvals: {
    onRequest: (listener) => subscribe(ipcChannels.approvalRequest, ApprovalRequest, listener),
    respond: async (response) => {
      await ipcRenderer.invoke(ipcChannels.approvalRespond, response);
    },
  },
  sessions: {
    list: async () =>
      SessionSummary.array().parse(await ipcRenderer.invoke(ipcChannels.sessionsList)),
    get: async (id) =>
      SessionDetail.nullable().parse(await ipcRenderer.invoke(ipcChannels.sessionsGet, id)),
    rename: async (request) => {
      await ipcRenderer.invoke(ipcChannels.sessionsRename, request);
    },
    remove: async (id) => {
      await ipcRenderer.invoke(ipcChannels.sessionsDelete, id);
    },
    removeMessages: async (request) => {
      await ipcRenderer.invoke(ipcChannels.messagesDelete, request);
    },
  },
  eplan: {
    status: async () => EplanStatus.parse(await ipcRenderer.invoke(ipcChannels.eplanStatus)),
    onStatus: (listener) => subscribe(ipcChannels.eplanStatusChanged, EplanStatus, listener),
  },
};

contextBridge.exposeInMainWorld("bochica", api);
