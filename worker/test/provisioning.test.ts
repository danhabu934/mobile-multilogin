import assert from 'node:assert/strict'
import test from 'node:test'
import { assertProvisionStateIsSafe } from '../src/provisioning.js'

test('accepts non-auth profile state', () => {
  assert.doesNotThrow(() => assertProvisionStateIsSafe({
    theme: 'dark',
    onboarding: { completed: true },
    ui: { density: 'compact' },
  }))
})

test('rejects authentication and session material recursively', () => {
  for (const state of [
    { sessionid: 'value' },
    { nested: { sid_guard: 'value' } },
    { cookies: [{ name: 'example', value: 'value' }] },
    { auth_token: 'value' },
    { msToken: 'value' },
  ]) {
    assert.throws(() => assertProvisionStateIsSafe(state), /Authentication\/session material/)
  }
})
