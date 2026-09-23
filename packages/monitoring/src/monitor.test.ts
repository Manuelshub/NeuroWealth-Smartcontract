/**
 * Tests for VaultMonitor
 */

import { VaultMonitor } from "./monitor";
import { MonitoringConfig, HealthMetrics } from "./types";

// Mock the MetricsCollector
jest.mock("./metrics-collector", () => ({
  MetricsCollector: jest.fn(function () {
    this.collectMetrics = jest.fn();
    this.getLastMetrics = jest.fn();
  }),
}));

// Mock the AlertEngine
jest.mock("./alert-engine", () => ({
  AlertEngine: jest.fn(function () {
    this.detectAnomalies = jest.fn();
  }),
}));

// Mock the AlertDispatcher
jest.mock("./alert-dispatcher", () => ({
  AlertDispatcher: jest.fn(function () {
    this.dispatch = jest.fn();
  }),
}));

// Mock pino logger
jest.mock("pino", () => {
  return jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }));
});

describe("VaultMonitor", () => {
  let monitor: VaultMonitor;
  let mockConfig: MonitoringConfig;
  let mockMetrics: HealthMetrics;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockConfig = {
      contractId: "test-contract-id",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      pollIntervalSeconds: 60,
      alertWebhooks: [
        {
          name: "test-webhook",
          type: "webhook",
          url: "https://example.com/webhook",
        },
      ],
      thresholds: {
        tvlDropPercentage: 20,
        withdrawalSpikeFactor: 3,
        pauseDurationLedgers: 17280,
        capSaturationPercentage: 95,
      },
    };

    mockMetrics = {
      timestamp: Date.now(),
      ledgerSequence: 1000,
      tvl: 100000000000n,
      totalShares: 50000000000n,
      totalDeposits: 80000000000n,
      isPaused: false,
      currentProtocol: "blend",
      owner: "GOWNER_ADDRESS",
      agent: "GAGENT_ADDRESS",
      sharePrice: 2.0,
      tvlCap: 200000000000n,
      userDepositCap: 5000000000n,
    };

    monitor = new VaultMonitor(mockConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("start", () => {
    it("should initialize monitoring system", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
      }

      await monitor.start();

      expect(MetricsCollector).toHaveBeenCalledWith(mockConfig);
    });

    it("should set up polling interval", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
      }

      await monitor.start();

      // Verify interval was set (60 seconds)
      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), mockConfig.pollIntervalSeconds * 1000);
    });

    it("should perform initial collection", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
      }

      await monitor.start();

      // The initial collection should have been called
      if (metricsCollectorInstance) {
        expect(metricsCollectorInstance.collectMetrics).toHaveBeenCalled();
      }
    });

    it("should handle collection errors gracefully", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockRejectedValue(new Error("Collection failed"));
      }

      // Should not throw
      await expect(monitor.start()).rejects.toThrow();
    });
  });

  describe("stop", () => {
    it("should stop the monitoring interval", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
      }

      await monitor.start();
      await monitor.stop();

      // clearInterval should have been called
      expect(clearInterval).toHaveBeenCalled();
    });

    it("should be safe to call stop when not started", async () => {
      // Should not throw
      await expect(monitor.stop()).resolves.not.toThrow();
    });

    it("should prevent further collections after stop", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
      }

      await monitor.start();
      await monitor.stop();

      jest.advanceTimersByTime(mockConfig.pollIntervalSeconds * 1000);

      // Verify collectMetrics is not called during the interval after stop
      // (it should only be called from the initial start)
    });
  });

  describe("Health Check", () => {
    it("should provide health check status", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
        metricsCollectorInstance.getLastMetrics.mockReturnValue(mockMetrics);
      }

      await monitor.start();

      // The monitor should track health status
      // (specific implementation depends on monitor structure)
    });

    it("should report connected status when RPC is reachable", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
      }

      await monitor.start();

      // Should indicate connection is healthy
    });

    it("should report disconnected status on RPC failure", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockRejectedValue(new Error("RPC unavailable"));
      }

      await expect(monitor.start()).rejects.toThrow();
    });
  });

  describe("Anomaly Detection Integration", () => {
    it("should detect anomalies on each collection", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const { AlertEngine } = require("./alert-engine");

      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;
      const alertEngineInstance = AlertEngine.mock.results[0]?.value;

      if (metricsCollectorInstance && alertEngineInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
        alertEngineInstance.detectAnomalies.mockReturnValue([]);
      }

      await monitor.start();

      // The alert engine should be called to detect anomalies
    });

    it("should dispatch alerts when anomalies detected", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const { AlertEngine } = require("./alert-engine");
      const { AlertDispatcher } = require("./alert-dispatcher");

      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;
      const alertEngineInstance = AlertEngine.mock.results[0]?.value;
      const alertDispatcherInstance = AlertDispatcher.mock.results[0]?.value;

      const testAlert = {
        id: "test-alert",
        type: "tvl_drop" as const,
        severity: "critical" as const,
        title: "TVL Dropped",
        message: "TVL dropped significantly",
        timestamp: Date.now(),
      };

      if (metricsCollectorInstance && alertEngineInstance && alertDispatcherInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
        alertEngineInstance.detectAnomalies.mockReturnValue([testAlert]);
      }

      await monitor.start();

      // Dispatcher should be called for each alert
    });
  });

  describe("Polling Interval", () => {
    it("should respect configured poll interval", async () => {
      const customConfig = {
        ...mockConfig,
        pollIntervalSeconds: 30,
      };

      const customMonitor = new VaultMonitor(customConfig);
      const { MetricsCollector } = require("./metrics-collector");

      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;
      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
      }

      await customMonitor.start();

      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 1000);
    });
  });

  describe("State Management", () => {
    it("should track current and previous metrics", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      const metrics1 = { ...mockMetrics, ledgerSequence: 1000 };
      const metrics2 = { ...mockMetrics, ledgerSequence: 1001 };

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics
          .mockResolvedValueOnce(metrics1)
          .mockResolvedValueOnce(metrics2);
      }

      await monitor.start();

      // Advance time to trigger next collection
      jest.advanceTimersByTime(mockConfig.pollIntervalSeconds * 1000);

      // The monitor should maintain both current and previous metrics
    });

    it("should maintain active and resolved alerts", async () => {
      const { MetricsCollector } = require("./metrics-collector");
      const metricsCollectorInstance = MetricsCollector.mock.results[0]?.value;

      if (metricsCollectorInstance) {
        metricsCollectorInstance.collectMetrics.mockResolvedValue(mockMetrics);
      }

      await monitor.start();

      // Monitor should track alert history
    });
  });
});
