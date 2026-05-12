const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('shared/flow-capabilities.js', 'utf8');

function loadApi() {
  const scope = {};
  return new Function('self', `${source}; return self.MultiPageFlowCapabilities;`)(scope);
}

test('flow capability registry keeps OpenAI phone signup available only when runtime locks allow it', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry();

  const enabledState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'openai',
      panelMode: 'cpa',
      phoneVerificationEnabled: true,
      plusModeEnabled: false,
      contributionMode: false,
      signupMethod: 'phone',
    },
  });

  assert.equal(enabledState.canUsePhoneSignup, true);
  assert.equal(enabledState.effectiveSignupMethod, 'phone');
  assert.equal(enabledState.shouldWarnCpaPhoneSignup, true);
  assert.deepEqual(enabledState.effectiveSignupMethods, ['email', 'phone']);

  const plusLockedState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'openai',
      panelMode: 'sub2api',
      phoneVerificationEnabled: true,
      plusModeEnabled: true,
      contributionMode: false,
      signupMethod: 'phone',
    },
  });

  assert.equal(plusLockedState.canUsePhoneSignup, false);
  assert.equal(plusLockedState.effectiveSignupMethod, 'email');
  assert.equal(plusLockedState.shouldWarnCpaPhoneSignup, false);
  assert.deepEqual(plusLockedState.effectiveSignupMethods, ['email']);
});

test('flow capability registry defaults unknown flows to minimal non-phone capabilities', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry();

  const capabilityState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'site-a',
      panelMode: 'codex2api',
      phoneVerificationEnabled: true,
      plusModeEnabled: true,
      contributionMode: true,
      signupMethod: 'phone',
    },
  });

  assert.equal(capabilityState.activeFlowId, 'site-a');
  assert.equal(capabilityState.canShowPhoneSettings, false);
  assert.equal(capabilityState.canShowPlusSettings, false);
  assert.equal(capabilityState.canShowLuckmail, false);
  assert.equal(capabilityState.canUsePhoneSignup, false);
  assert.equal(capabilityState.effectiveSignupMethod, 'email');
  assert.equal(capabilityState.panelMode, 'codex2api');
  assert.deepEqual(capabilityState.supportedPanelModes, []);
});
