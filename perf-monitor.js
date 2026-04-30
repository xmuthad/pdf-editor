// Performance monitoring and logging utility

class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.logs = [];
    this.maxLogs = 1000;
    this.isEnabled = true;
  }

  enable() {
    this.isEnabled = true;
  }

  disable() {
    this.isEnabled = false;
  }

  startTimer(name) {
    if (!this.isEnabled) return;
    
    const startTime = performance.now();
    this.metrics.set(name, {
      startTime,
      endTime: null,
      duration: null,
      completed: false
    });
  }

  endTimer(name, metadata = {}) {
    if (!this.isEnabled) return null;
    
    const metric = this.metrics.get(name);
    if (!metric) {
      console.warn(`[Perf] Timer "${name}" not started`);
      return null;
    }

    const endTime = performance.now();
    metric.endTime = endTime;
    metric.duration = endTime - metric.startTime;
    metric.completed = true;
    metric.metadata = metadata;

    const logEntry = {
      type: 'performance',
      timestamp: new Date().toISOString(),
      name,
      duration: metric.duration.toFixed(2),
      unit: 'ms',
      metadata
    };

    this.addLog(logEntry);
    console.log(`[Perf] ${name}: ${metric.duration.toFixed(2)}ms`, metadata);
    
    return metric.duration;
  }

  record(name, value, unit = 'ms', metadata = {}) {
    if (!this.isEnabled) return;

    const logEntry = {
      type: 'metric',
      timestamp: new Date().toISOString(),
      name,
      value,
      unit,
      metadata
    };

    this.addLog(logEntry);
    console.log(`[Metric] ${name}: ${value}${unit}`, metadata);
  }

  addLog(entry) {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  getLogs(filter = {}) {
    let filtered = this.logs;
    
    if (filter.type) {
      filtered = filtered.filter(log => log.type === filter.type);
    }
    if (filter.name) {
      filtered = filtered.filter(log => log.name === filter.name);
    }
    if (filter.startTime) {
      filtered = filtered.filter(log => log.timestamp >= filter.startTime);
    }
    if (filter.endTime) {
      filtered = filtered.filter(log => log.timestamp <= filter.endTime);
    }

    return filtered;
  }

  getMetrics(name = null) {
    if (!name) {
      return Object.fromEntries(this.metrics);
    }
    return this.metrics.get(name);
  }

  getStatistics() {
    const stats = {
      totalLogs: this.logs.length,
      totalMetrics: this.metrics.size,
      completedTimers: 0,
      averageDuration: 0,
      slowestOperations: []
    };

    const completed = Array.from(this.metrics.values())
      .filter(m => m.completed && m.duration !== null);

    stats.completedTimers = completed.length;

    if (completed.length > 0) {
      const totalDuration = completed.reduce((sum, m) => sum + m.duration, 0);
      stats.averageDuration = (totalDuration / completed.length).toFixed(2);

      stats.slowestOperations = completed
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map(m => ({
          name: m.name,
          duration: m.duration.toFixed(2),
          metadata: m.metadata
        }));
    }

    return stats;
  }

  clear() {
    this.metrics.clear();
    this.logs = [];
  }

  export(format = 'json') {
    const data = {
      timestamp: new Date().toISOString(),
      statistics: this.getStatistics(),
      logs: this.logs,
      metrics: Object.fromEntries(this.metrics)
    };

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    } else if (format === 'csv') {
      return this.exportToCSV();
    }

    return data;
  }

  exportToCSV() {
    const headers = ['timestamp', 'type', 'name', 'value', 'unit', 'metadata'];
    const rows = this.logs.map(log => [
      log.timestamp,
      log.type,
      log.name,
      log.value || log.duration || '',
      log.unit || '',
      JSON.stringify(log.metadata || {})
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  report() {
    const stats = this.getStatistics();
    console.group('[Performance Report]');
    console.log(`Total Logs: ${stats.totalLogs}`);
    console.log(`Total Metrics: ${stats.totalMetrics}`);
    console.log(`Completed Timers: ${stats.completedTimers}`);
    console.log(`Average Duration: ${stats.averageDuration}ms`);
    
    if (stats.slowestOperations.length > 0) {
      console.log('Slowest Operations:');
      stats.slowestOperations.forEach((op, index) => {
        console.log(`  ${index + 1}. ${op.name}: ${op.duration}ms`);
      });
    }
    
    console.groupEnd();
  }
}

const perfMonitor = new PerformanceMonitor();

if (typeof window !== 'undefined') {
  window.perfMonitor = perfMonitor;
}

module.exports = perfMonitor;
