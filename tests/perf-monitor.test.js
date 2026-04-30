// Performance Monitor tests

describe('PerformanceMonitor', () => {
  let perfMonitor;

  beforeAll(() => {
    perfMonitor = require('../perf-monitor');
  });

  beforeEach(() => {
    perfMonitor.clear();
    perfMonitor.enable();
  });

  describe('enable/disable', () => {
    test('should enable monitoring', () => {
      perfMonitor.disable();
      expect(perfMonitor.isEnabled).toBe(false);
      
      perfMonitor.enable();
      expect(perfMonitor.isEnabled).toBe(true);
    });

    test('should disable monitoring', () => {
      perfMonitor.disable();
      expect(perfMonitor.isEnabled).toBe(false);
    });
  });

  describe('startTimer/endTimer', () => {
    test('should measure duration', (done) => {
      perfMonitor.startTimer('test-operation');
      
      setTimeout(() => {
        const duration = perfMonitor.endTimer('test-operation');
        expect(duration).toBeGreaterThan(0);
        expect(duration).toBeLessThan(200);
        done();
      }, 50);
    });

    test('should handle timer not started', () => {
      const result = perfMonitor.endTimer('non-existent-timer');
      expect(result).toBeNull();
    });

    test('should store metrics', () => {
      perfMonitor.startTimer('test-metric');
      perfMonitor.endTimer('test-metric', { foo: 'bar' });
      
      const metrics = perfMonitor.getMetrics('test-metric');
      expect(metrics).toBeDefined();
      expect(metrics.completed).toBe(true);
      expect(metrics.metadata.foo).toBe('bar');
    });

    test('should not record when disabled', () => {
      perfMonitor.disable();
      perfMonitor.startTimer('disabled-timer');
      const result = perfMonitor.endTimer('disabled-timer');
      expect(result).toBeNull();
    });
  });

  describe('record', () => {
    test('should record metric', () => {
      perfMonitor.record('memory-usage', 1024, 'MB', { type: 'heap' });
      
      const logs = perfMonitor.getLogs({ name: 'memory-usage' });
      expect(logs.length).toBe(1);
      expect(logs[0].value).toBe(1024);
      expect(logs[0].unit).toBe('MB');
    });

    test('should not record when disabled', () => {
      perfMonitor.disable();
      perfMonitor.record('test-metric', 100);
      
      const logs = perfMonitor.getLogs({ name: 'test-metric' });
      expect(logs.length).toBe(0);
    });
  });

  describe('getLogs', () => {
    beforeEach(() => {
      perfMonitor.record('metric1', 10);
      perfMonitor.record('metric2', 20);
      perfMonitor.record('metric1', 30);
    });

    test('should get all logs', () => {
      const logs = perfMonitor.getLogs();
      expect(logs.length).toBe(3);
    });

    test('should filter by type', () => {
      const logs = perfMonitor.getLogs({ type: 'metric' });
      expect(logs.length).toBe(3);
    });

    test('should filter by name', () => {
      const logs = perfMonitor.getLogs({ name: 'metric1' });
      expect(logs.length).toBe(2);
    });

    test('should filter by start time', () => {
      const pastTime = new Date(Date.now() - 10000).toISOString();
      perfMonitor.record('future-metric', 100);
      const logs = perfMonitor.getLogs({ startTime: pastTime });
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('getStatistics', () => {
    test('should return statistics', () => {
      perfMonitor.startTimer('stat-test');
      perfMonitor.endTimer('stat-test');
      
      const stats = perfMonitor.getStatistics();
      expect(stats.totalLogs).toBeGreaterThan(0);
      expect(stats.totalMetrics).toBeGreaterThan(0);
      expect(stats.completedTimers).toBeGreaterThan(0);
    });

    test('should calculate average duration', () => {
      perfMonitor.startTimer('avg1');
      perfMonitor.endTimer('avg1');
      perfMonitor.startTimer('avg2');
      perfMonitor.endTimer('avg2');
      
      const stats = perfMonitor.getStatistics();
      expect(stats.averageDuration).toBeDefined();
    });

    test('should return slowest operations', () => {
      for (let i = 0; i < 15; i++) {
        perfMonitor.startTimer(`slow-${i}`);
        perfMonitor.endTimer(`slow-${i}`);
      }
      
      const stats = perfMonitor.getStatistics();
      expect(stats.slowestOperations.length).toBeLessThanOrEqual(10);
    });
  });

  describe('clear', () => {
    test('should clear all data', () => {
      perfMonitor.record('test', 100);
      perfMonitor.startTimer('timer');
      perfMonitor.endTimer('timer');
      
      perfMonitor.clear();
      
      expect(perfMonitor.getLogs().length).toBe(0);
      expect(perfMonitor.getMetrics().size || 0).toBe(0);
    });
  });

  describe('export', () => {
    beforeEach(() => {
      perfMonitor.record('export-test', 42);
    });

    test('should export to JSON', () => {
      const json = perfMonitor.export('json');
      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    test('should export to CSV', () => {
      const csv = perfMonitor.export('csv');
      expect(typeof csv).toBe('string');
      expect(csv).toContain('timestamp,type,name,value,unit,metadata');
    });

    test('should export to object', () => {
      const obj = perfMonitor.export('object');
      expect(typeof obj).toBe('object');
      expect(obj.logs).toBeDefined();
      expect(obj.metrics).toBeDefined();
    });
  });

  describe('report', () => {
    test('should log report to console', () => {
      const consoleGroupSpy = jest.spyOn(console, 'group').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleGroupEndSpy = jest.spyOn(console, 'groupEnd').mockImplementation();

      perfMonitor.startTimer('report-test');
      perfMonitor.endTimer('report-test');
      
      perfMonitor.report();
      
      expect(consoleGroupSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleGroupEndSpy).toHaveBeenCalled();

      consoleGroupSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleGroupEndSpy.mockRestore();
    });
  });
});
