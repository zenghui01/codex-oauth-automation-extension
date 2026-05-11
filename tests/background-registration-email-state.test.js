const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadRegistrationEmailStateApi() {
  const source = fs.readFileSync('background/registration-email-state.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageRegistrationEmailState;`)(globalScope);
}

test('registration email state preserves the previous baseline when current email is cleared for recovery', () => {
  const api = loadRegistrationEmailStateApi();
  const helpers = api.createRegistrationEmailStateHelpers();

  const updates = helpers.buildRegistrationEmailStateUpdates({
    email: 'old.user@example.com',
    registrationEmailState: {
      current: 'old.user@example.com',
      previous: 'old.user@example.com',
      source: 'generated:duck',
      updatedAt: 1,
    },
  }, {
    currentEmail: null,
    preservePrevious: true,
    source: 'step8_recovery',
  });

  assert.deepStrictEqual(updates, {
    email: null,
    registrationEmailState: {
      current: '',
      previous: 'old.user@example.com',
      source: 'generated:duck',
      updatedAt: updates.registrationEmailState.updatedAt,
    },
  });
  assert.ok(updates.registrationEmailState.updatedAt > 0);
});

test('registration email baseline prefers the current UI email over preserved runtime state', () => {
  const api = loadRegistrationEmailStateApi();
  const helpers = api.createRegistrationEmailStateHelpers();

  const baseline = helpers.getRegistrationEmailBaseline({
    email: '',
    registrationEmailState: {
      current: '',
      previous: 'preserved@duck.com',
      source: 'generated:duck',
      updatedAt: 1,
    },
  }, {
    preferredEmail: 'visible@duck.com',
  });

  assert.equal(baseline, 'visible@duck.com');
});
