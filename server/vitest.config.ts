import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    // Built output holds compiled copies of these tests.
    exclude: ['dist/**', 'node_modules/**'],
  },
})
