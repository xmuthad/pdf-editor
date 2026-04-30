module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'pdf-utils.js',
    'ocr-engine.js',
    'perf-monitor.js',
    'pdf-editor.js'
  ],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  moduleFileExtensions: ['js', 'json'],
  verbose: true,
  globals: {
    window: {
      PDFEditor: null,
      document: {
        getElementById: () => null
      }
    }
  }
};