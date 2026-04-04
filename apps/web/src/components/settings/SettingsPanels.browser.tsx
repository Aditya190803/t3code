import "../../index.css";

import { DEFAULT_SERVER_SETTINGS, type NativeApi, type ServerConfig } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { getTimestampFormatOptions } from "../../timestampFormat";
import { GeneralSettingsPanel } from "./SettingsPanels";

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function formatResetLabel(isoDate: string, timestampFormat: "locale" | "12-hour" | "24-hour") {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...getTimestampFormatOptions(timestampFormat, false),
  }).format(new Date(isoDate));
}

describe("GeneralSettingsPanel observability", () => {
  beforeEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    resetServerStateForTests();
    __resetNativeApiForTests();
    document.body.innerHTML = "";
  });

  it("shows diagnostics inside About with a single logs-folder action", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect.element(page.getByText("Diagnostics")).toBeInTheDocument();
    await expect.element(page.getByText("Open logs folder")).toBeInTheDocument();
    await expect
      .element(page.getByText("/repo/project/.t3/logs", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. OTLP exporting traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi.fn<NativeApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      shell: {
        openInEditor,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3/logs", "cursor");
  });

  it("renders both provider usage-limit rows when both windows exist", async () => {
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        {
          provider: "codex",
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready",
          auth: { status: "authenticated", label: "ChatGPT Pro Subscription" },
          checkedAt: "2026-04-04T00:00:00.000Z",
          models: [],
          usageLimits: {
            updatedAt: "2026-04-04T00:00:00.000Z",
            windows: [
              {
                kind: "session",
                label: "Session limit",
                usedPercentage: 61,
                resetsAt: "2026-04-04T05:00:00.000Z",
                windowDurationMins: 300,
              },
              {
                kind: "weekly",
                label: "Weekly limit",
                usedPercentage: 22,
                resetsAt: "2026-04-08T00:00:00.000Z",
                windowDurationMins: 10_080,
              },
            ],
          },
        },
      ],
    });

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Session limit")).toBeInTheDocument();
    await expect.element(page.getByText("Weekly limit")).toBeInTheDocument();
    await expect.element(page.getByText("39% remaining")).toBeInTheDocument();
    await expect.element(page.getByText("78% remaining")).toBeInTheDocument();
    await expect
      .element(page.getByText(`Resets ${formatResetLabel("2026-04-04T05:00:00.000Z", "locale")}`))
      .toBeInTheDocument();
    await expect
      .element(page.getByText(`Resets ${formatResetLabel("2026-04-08T00:00:00.000Z", "locale")}`))
      .toBeInTheDocument();
  });

  it("renders only weekly provider usage when the session window is absent", async () => {
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        {
          provider: "claudeAgent",
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready",
          auth: { status: "authenticated", label: "Claude Pro Subscription" },
          checkedAt: "2026-04-04T00:00:00.000Z",
          models: [],
          usageLimits: {
            updatedAt: "2026-04-04T00:00:00.000Z",
            windows: [
              {
                kind: "weekly",
                label: "Weekly limit",
                usedPercentage: 40,
                resetsAt: "2026-04-10T00:00:00.000Z",
                windowDurationMins: 10_080,
              },
            ],
          },
        },
      ],
    });

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Weekly limit")).toBeInTheDocument();
    await expect.element(page.getByText("60% remaining")).toBeInTheDocument();
    await expect.element(page.getByText("Session limit")).not.toBeInTheDocument();
  });

  it("keeps provider cards unchanged when usage limits are absent", async () => {
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        {
          provider: "codex",
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-04-04T00:00:00.000Z",
          models: [],
        },
      ],
    });

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Authenticated")).toBeInTheDocument();
    await expect.element(page.getByText("Session limit")).not.toBeInTheDocument();
    await expect.element(page.getByText("Weekly limit")).not.toBeInTheDocument();
  });
});
