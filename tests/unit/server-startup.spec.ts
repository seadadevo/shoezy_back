import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
  disconnectSockets: vi.fn(),
  disconnectDatabase: vi.fn(),
  initStorage: vi.fn(),
  startWorker: vi.fn(),
  stopWorker: vi.fn(),
}));

vi.mock("../../src/config/env", () => ({ env: { PORT: 4317 } }));
vi.mock("../../src/app", () => ({ createApp: vi.fn() }));
vi.mock("node:http", () => ({ createServer: () => ({ listen: mocks.listen, on: mocks.on, close: mocks.close }) }));
vi.mock("../../src/config/database", () => ({ prisma: { $disconnect: mocks.disconnectDatabase } }));
vi.mock("../../src/jobs/cart-cleanup.job", () => ({ cartCleanupJob: vi.fn() }));
vi.mock("../../src/modules/products/media-storage", () => ({ initMediaStorage: mocks.initStorage }));
vi.mock("../../src/modules/notifications/notifications.socket", () => ({
  createNotificationSocketServer: () => ({ disconnectSockets: mocks.disconnectSockets }),
}));
vi.mock("../../src/modules/notifications/notifications.worker", () => ({ startNotificationOutboxWorker: mocks.startWorker }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.initStorage.mockResolvedValue(undefined);
  mocks.disconnectDatabase.mockResolvedValue(undefined);
  mocks.startWorker.mockReturnValue(mocks.stopWorker);
  mocks.close.mockImplementation((done: (error?: Error) => void) => done());
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "on").mockReturnValue(process);
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("container server lifecycle", () => {
  it("initializes storage before listening on the configured port on all IPv4 interfaces", async () => {
    let ready!: () => void;
    mocks.initStorage.mockReturnValue(new Promise<void>((resolve) => { ready = resolve; }));
    await import("../../src/server.js");
    expect(mocks.listen).not.toHaveBeenCalled();
    ready();
    await Promise.resolve();
    expect(mocks.listen).toHaveBeenCalledWith(4317, "0.0.0.0", expect.any(Function));
    expect(mocks.startWorker).toHaveBeenCalledTimes(1);
  });

  it("exits clearly without accepting requests when storage initialization fails", async () => {
    const error = new Error("Storage is not writable");
    mocks.initStorage.mockRejectedValue(error);
    await import("../../src/server.js");
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("Failed to initialize media storage:", error);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("reports listener failures and exits unsuccessfully", async () => {
    await import("../../src/server.js");
    const fail = mocks.on.mock.calls.find(([event]) => event === "error")?.[1] as (error: Error) => void;
    fail(Object.assign(new Error("Address already in use"), { code: "EADDRINUSE" }));
    expect(console.error).toHaveBeenCalledWith("HTTP server failed", { code: "EADDRINUSE", message: "Address already in use" });
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it.each(["SIGTERM", "SIGINT"])("stops the worker, sockets and database on %s only once", async (signal) => {
    await import("../../src/server.js");
    const shutdown = vi.mocked(process.on).mock.calls.find(([event]) => event === signal)?.[1] as () => void;
    shutdown();
    shutdown();
    await Promise.resolve();
    expect(mocks.stopWorker).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectSockets).toHaveBeenCalledWith(true);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectDatabase).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
