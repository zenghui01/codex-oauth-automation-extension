const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports step 0~10 modules', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  [
    'background/steps/prefetch-add-phone-number.js',
    'background/steps/open-chatgpt.js',
    'background/steps/submit-signup-email.js',
    'background/steps/fill-password.js',
    'background/steps/fetch-signup-code.js',
    'background/steps/fill-profile.js',
    'background/steps/wait-registration-success.js',
    'background/steps/oauth-login.js',
    'background/steps/fetch-login-code.js',
    'background/steps/confirm-oauth.js',
    'background/steps/platform-verify.js',
  ].forEach((path) => {
    assert.match(source, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('background wires step 0 prefetch retry alarm helpers and listener', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /STEP0_PREFETCH_RETRY_ALARM_NAME\s*=\s*'step0-prefetch-retry'/);
  assert.match(source, /clearStep0PrefetchRetryState:\s*\(/);
  assert.match(source, /ensureStep0PrefetchRetryAlarm:\s*\(/);
  assert.match(source, /if\s*\(alarm\.name === STEP0_PREFETCH_RETRY_ALARM_NAME\)/);
  assert.match(source, /resumeStep0PrefetchRetryFromAlarm/);
});

test('step 0 module persists 30-second retry alarms for prefetch resume', () => {
  const source = fs.readFileSync('background/steps/prefetch-add-phone-number.js', 'utf8');
  assert.match(source, /STEP0_RETRY_DELAY_MS\s*=\s*30000/);
  assert.match(source, /ensureStep0PrefetchRetryAlarm/);
  assert.match(source, /clearStep0PrefetchRetryState/);
  assert.match(source, /step0PrefetchRetry/);
  assert.doesNotMatch(source, /sleepWithStop\(STEP0_RETRY_DELAY_MS\)/);
});

test('step 0 schedules a 30-second retry alarm after failed prefetch and clears it after success', async () => {
  const source = fs.readFileSync('background/steps/prefetch-add-phone-number.js', 'utf8');
  const sandbox = {};
  const moduleApi = new Function('self', `${source}; return self.MultiPageBackgroundPrefetchAddPhoneNumber;`)(sandbox);
  const logs = [];
  const states = [];
  const alarmFireAts = [];
  const clearedReasons = [];
  let prepareCalls = 0;
  let completed = false;
  let currentState = {
    phoneVerificationEnabled: true,
    currentPhoneActivation: null,
    step0PrefetchRetry: null,
  };

  const executor = moduleApi.createPrefetchAddPhoneNumberExecutor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    clearStep0PrefetchRetryState: async (reason = '') => {
      clearedReasons.push(reason);
      currentState.step0PrefetchRetry = null;
    },
    completeStepFromBackground: async () => {
      completed = true;
    },
    ensureStep0PrefetchRetryAlarm: async (fireAt) => {
      alarmFireAts.push(fireAt);
    },
    getState: async () => ({ ...currentState }),
    phoneVerificationHelpers: {
      normalizeActivation: () => null,
      prepareAddPhoneActivation: async () => {
        prepareCalls += 1;
        if (prepareCalls === 2) {
          currentState.currentPhoneActivation = {
            activationId: 'step0-retry-success',
            phoneNumber: '66830000000',
            provider: 'hero-sms',
          };
          return {
            activationId: 'step0-retry-success',
            phoneNumber: '66830000000',
            provider: 'hero-sms',
          };
        }
        throw new Error('simulated no numbers');
      },
    },
    setStepStatus: async () => {},
    setState: async (updates) => {
      states.push(updates);
      currentState = { ...currentState, ...updates };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const startedAt = Date.now();
  const firstResult = await executor.executeStep0(currentState);
  const finishedAt = Date.now();

  assert.equal(firstResult, null);
  assert.equal(completed, false);
  assert.equal(prepareCalls, 1);
  assert.equal(alarmFireAts.length, 1);
  assert.ok(alarmFireAts[0] >= startedAt + 29000);
  assert.ok(alarmFireAts[0] <= finishedAt + 30100);
  assert.equal(typeof states[0].step0PrefetchRetry, 'object');
  assert.equal(states[0].step0PrefetchRetry.attempt, 2);
  assert.ok(logs.some((message) => message.includes('30 秒后通过 chrome.alarms 继续预取')));

  const activation = await executor.executeStep0(currentState);

  assert.equal(activation.phoneNumber, '66830000000');
  assert.equal(completed, true);
  assert.equal(prepareCalls, 2);
  assert.equal(clearedReasons.length > 0, true);
  assert.equal(alarmFireAts.length, 1);
});

test('step 0 with real HeroSMS helper keeps retrying inside provider until a number is acquired', async () => {
  const step0Source = fs.readFileSync('background/steps/prefetch-add-phone-number.js', 'utf8');
  const phoneSource = fs.readFileSync('background/phone-verification-flow.js', 'utf8');
  const sandbox = {};
  const step0Api = new Function('self', `${step0Source}; return self.MultiPageBackgroundPrefetchAddPhoneNumber;`)(sandbox);
  const phoneApi = new Function('self', `${phoneSource}; return self.MultiPageBackgroundPhoneVerification;`)(sandbox);
  const logs = [];
  const requests = [];
  const states = [];
  let getNumberCalls = 0;
  let completed = false;

  let currentState = {
    phoneVerificationEnabled: true,
    heroSmsApiKey: 'demo-key',
    phoneSmsProvider: 'hero-sms',
    phoneSmsProviderOrder: ['hero-sms'],
    heroSmsCountryId: 52,
    heroSmsCountryLabel: 'Thailand',
    heroSmsCountryFallback: [],
    heroSmsMaxPrice: '0.08',
    heroSmsActivationRetryRounds: 3,
    currentPhoneActivation: null,
    reusablePhoneActivation: null,
  };

  const phoneVerificationHelpers = phoneApi.createPhoneVerificationHelpers({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    ensureStep8SignupPageReady: async () => {},
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      requests.push(parsedUrl);
      const action = parsedUrl.searchParams.get('action');
      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            52: {
              dr: {
                cost: 0.08,
                count: 10,
                physicalCount: 10,
              },
            },
          }),
        };
      }
      if (action === 'getNumber' || action === 'getNumberV2') {
        if (action === 'getNumber') {
          getNumberCalls += 1;
          if (getNumberCalls >= 3) {
            return {
              ok: true,
              text: async () => 'ACCESS_NUMBER:retry-success:66830001111',
            };
          }
        }
        return {
          ok: true,
          text: async () => 'NO_NUMBERS',
        };
      }
      throw new Error(`Unexpected HeroSMS action: ${action}`);
    },
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({ ...currentState }),
    sendToContentScriptResilient: async () => ({}),
    setState: async (updates) => {
      currentState = { ...currentState, ...updates };
      states.push(updates);
    },
    sleepWithStop: async (ms) => {
      states.push({ sleepMs: ms });
    },
    throwIfStopped: () => {},
  });

  const executor = step0Api.createPrefetchAddPhoneNumberExecutor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    clearStep0PrefetchRetryState: async () => {},
    completeStepFromBackground: async () => {
      completed = true;
    },
    ensureStep0PrefetchRetryAlarm: async () => {},
    getState: async () => ({ ...currentState }),
    phoneVerificationHelpers,
    setStepStatus: async () => {},
    setState: async (updates) => {
      currentState = { ...currentState, ...updates };
      states.push(updates);
    },
    sleepWithStop: async (ms) => {
      states.push({ step0SleepMs: ms });
    },
    throwIfStopped: () => {},
  });

  const activation = await executor.executeStep0(currentState);

  const numberRequests = requests
    .filter((url) => ['getNumber', 'getNumberV2'].includes(url.searchParams.get('action')));
  assert.equal(activation.phoneNumber, '66830001111');
  assert.equal(completed, true);
  assert.equal(numberRequests.length, 5);
  assert.deepStrictEqual(
    states.filter((entry) => Object.prototype.hasOwnProperty.call(entry, 'sleepMs')).map((entry) => entry.sleepMs),
    [30000, 30000]
  );
  assert.equal(
    logs.filter((message) => message.includes('HeroSMS 正在获取手机号')).length,
    3
  );
  assert.equal(
    logs.filter((message) => message.includes('步骤 0：正在预取接码号码')).length,
    1
  );
});

test('step 0 discards stale current activation before prefetching again', async () => {
  const source = fs.readFileSync('background/steps/prefetch-add-phone-number.js', 'utf8');
  const sandbox = {};
  const moduleApi = new Function('self', `${source}; return self.MultiPageBackgroundPrefetchAddPhoneNumber;`)(sandbox);
  const logs = [];
  const updates = [];
  let currentState = {
    phoneVerificationEnabled: true,
    currentPhoneActivation: {
      activationId: 'old-activation',
      phoneNumber: '66810000000',
      provider: 'hero-sms',
      phoneCodeReceived: true,
    },
    currentPhoneVerificationCode: '123456',
    currentPhoneVerificationCountdownEndsAt: Date.now() + 1000,
  };
  let prepareCalls = 0;

  const executor = moduleApi.createPrefetchAddPhoneNumberExecutor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    clearStep0PrefetchRetryState: async () => {},
    completeStepFromBackground: async () => {},
    ensureStep0PrefetchRetryAlarm: async () => {},
    getState: async () => ({ ...currentState }),
    phoneVerificationHelpers: {
      normalizeActivation: (record) => {
        if (!record?.activationId || !record?.phoneNumber) return null;
        return { ...record };
      },
      prepareAddPhoneActivation: async () => {
        prepareCalls += 1;
        currentState.currentPhoneActivation = {
          activationId: 'new-activation',
          phoneNumber: '66820000000',
          provider: 'hero-sms',
        };
        return currentState.currentPhoneActivation;
      },
    },
    setStepStatus: async () => {},
    setState: async (nextUpdates) => {
      updates.push(nextUpdates);
      currentState = { ...currentState, ...nextUpdates };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const activation = await executor.executeStep0(currentState);

  assert.equal(activation.phoneNumber, '66820000000');
  assert.equal(prepareCalls, 1);
  assert.equal(updates.some((entry) => entry.currentPhoneActivation === null), true);
  assert.ok(logs.some((message) => message.includes('带有验证码/倒计时或已过期')));
});

test('step 7 dispatches login command after opening fresh OAuth tab without tab-status gating', async () => {
  const source = fs.readFileSync('background/steps/oauth-login.js', 'utf8');
  const sandbox = {};
  const moduleApi = new Function('self', `${source}; return self.MultiPageBackgroundStep7;`)(sandbox);
  const events = [];
  let completedStep = null;

  const executor = moduleApi.createStep7Executor({
    addLog: async (message) => {
      events.push(['log', String(message || '')]);
    },
    completeStepFromBackground: async (step) => {
      completedStep = step;
      events.push(['complete', step]);
    },
    getErrorMessage: (error) => error?.message || String(error || ''),
    getLoginAuthStateLabel: () => '登录验证码页',
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({
      email: 'user@example.com',
      password: 'secret',
    }),
    isStep6RecoverableResult: () => false,
    isStep6SuccessResult: (result) => Boolean(result?.success),
    refreshOAuthUrlBeforeStep6: async () => {
      events.push(['refresh']);
      return 'https://auth.openai.com/oauth';
    },
    reuseOrCreateTab: async (_source, _url, options) => {
      assert.equal(options.forceNew, true);
      events.push(['open-tab']);
      return 42;
    },
    sendToContentScriptResilient: async () => {
      events.push(['send-login']);
      return { success: true };
    },
    startOAuthFlowTimeoutWindow: async () => {
      events.push(['start-timeout']);
    },
    STEP6_MAX_ATTEMPTS: 3,
    throwIfStopped: () => {},
  });

  await executor.executeStep7({
    email: 'user@example.com',
    password: 'secret',
    visibleStep: 7,
  });

  assert.equal(completedStep, 7);
  assert.deepStrictEqual(
    events.map(([name]) => name).filter((name) => ['open-tab', 'send-login'].includes(name)),
    ['open-tab', 'send-login']
  );
});

test('step 0 applies persisted step 9 phone selection hints and clears them after success', async () => {
  const source = fs.readFileSync('background/steps/prefetch-add-phone-number.js', 'utf8');
  const sandbox = {};
  const moduleApi = new Function('self', `${source}; return self.MultiPageBackgroundPrefetchAddPhoneNumber;`)(sandbox);
  const logs = [];
  const updates = [];
  const prepareOptions = [];
  let completed = false;
  let currentState = {
    phoneVerificationEnabled: true,
    currentPhoneActivation: null,
    step0PhoneBlockedCountryIds: ['52'],
    step0PhoneCountryPriceFloorByCountryId: { 52: 0.08 },
  };

  const executor = moduleApi.createPrefetchAddPhoneNumberExecutor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    clearStep0PrefetchRetryState: async () => {},
    completeStepFromBackground: async () => {
      completed = true;
    },
    ensureStep0PrefetchRetryAlarm: async () => {},
    getState: async () => ({ ...currentState }),
    phoneVerificationHelpers: {
      normalizeActivation: (record) => {
        if (!record?.activationId || !record?.phoneNumber) return null;
        return { ...record };
      },
      prepareAddPhoneActivation: async (_state, options) => {
        prepareOptions.push(options);
        const activation = {
          activationId: 'hinted-activation',
          phoneNumber: '66830000000',
          provider: 'hero-sms',
        };
        currentState.currentPhoneActivation = activation;
        return activation;
      },
    },
    setStepStatus: async () => {},
    setState: async (nextUpdates) => {
      updates.push(nextUpdates);
      currentState = { ...currentState, ...nextUpdates };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const activation = await executor.executeStep0(currentState);

  assert.equal(completed, true);
  assert.equal(activation.phoneNumber, '66830000000');
  assert.deepStrictEqual(prepareOptions[0], {
    blockedCountryIds: ['52'],
    countryPriceFloorByCountryId: { 52: 0.08 },
  });
  assert.ok(logs.some((message) => message.includes('收码失败学习结果')));
  assert.equal(
    updates.some((entry) => (
      Array.isArray(entry.step0PhoneBlockedCountryIds)
      && entry.step0PhoneBlockedCountryIds.length === 0
      && entry.step0PhoneCountryPriceFloorByCountryId
      && Object.keys(entry.step0PhoneCountryPriceFloorByCountryId).length === 0
    )),
    true
  );
});

test('step 9 finalizes pending phone activation after localhost callback is saved', async () => {
  const source = fs.readFileSync('background/steps/confirm-oauth.js', 'utf8');
  const sandbox = {};
  const moduleApi = new Function('self', `${source}; return self.MultiPageBackgroundStep9;`)(sandbox);
  const events = [];
  let tabUpdatedListener = null;

  const executor = moduleApi.createStep9Executor({
    addLog: async (message, level) => {
      events.push(['log', level || 'info', String(message || '')]);
    },
    chrome: {
      tabs: {
        update: async () => {},
        onUpdated: {
          addListener: () => {},
        },
      },
      webNavigation: {
        onBeforeNavigate: {
          addListener: () => {},
        },
        onCommitted: {
          addListener: () => {},
        },
      },
    },
    clearPendingPhoneActivationConfirmation: async (reason) => {
      events.push(['clear-pending', reason]);
    },
    clearPendingFreeReusablePhoneActivationSuccess: async (reason) => {
      events.push(['clear-free-reuse-pending', reason]);
    },
    cleanupStep8NavigationListeners: () => {
      events.push(['cleanup']);
    },
    clickWithDebugger: async () => {},
    completeStepFromBackground: async (step, payload) => {
      events.push(['complete', step, payload.localhostUrl]);
    },
    ensureStep8SignupPageReady: async () => {
      tabUpdatedListener?.(42, { url: 'http://localhost:1455/auth/callback?code=ok&state=s' }, {
        url: 'http://localhost:1455/auth/callback?code=ok&state=s',
      });
    },
    finalizePendingPhoneActivationConfirmation: async () => {
      events.push(['finalize-pending']);
    },
    finalizePendingFreeReusablePhoneActivationSuccess: async () => {
      events.push(['finalize-free-reuse-pending']);
    },
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getStep8CallbackUrlFromNavigation: () => '',
    getStep8CallbackUrlFromTabUpdate: (_tabId, changeInfo, tab) => changeInfo.url || tab.url || '',
    getStep8EffectLabel: () => '已跳转',
    getTabId: async () => 42,
    isTabAlive: async () => true,
    prepareStep8DebuggerClick: async () => ({}),
    recoverOAuthLocalhostTimeout: async () => null,
    reloadStep8ConsentPage: async () => {},
    reuseOrCreateTab: async () => 42,
    sleepWithStop: async () => {},
    STEP8_CLICK_RETRY_DELAY_MS: 1,
    STEP8_MAX_ROUNDS: 1,
    STEP8_READY_WAIT_TIMEOUT_MS: 1,
    STEP8_STRATEGIES: [{ mode: 'content', label: 'content', strategy: 'requestSubmit' }],
    throwIfStep8SettledOrStopped: (settled) => {
      if (settled) throw new Error('settled');
    },
    triggerStep8ContentStrategy: async () => {},
    waitForStep8ClickEffect: async () => ({ progressed: true }),
    waitForStep8Ready: async () => ({ consentReady: true, url: 'https://auth.openai.com/authorize' }),
    setWebNavListener: () => {},
    setWebNavCommittedListener: () => {},
    setStep8PendingReject: () => {},
    setStep8TabUpdatedListener: (listener) => {
      tabUpdatedListener = listener;
    },
    getWebNavListener: () => () => {},
    getWebNavCommittedListener: () => () => {},
    getStep8TabUpdatedListener: () => tabUpdatedListener,
  });

  await executor.executeStep9({
    oauthUrl: 'https://auth.openai.com/authorize',
    visibleStep: 9,
  });

  assert.deepStrictEqual(
    events
      .filter(([name]) => [
        'clear-pending',
        'clear-free-reuse-pending',
        'complete',
        'finalize-free-reuse-pending',
        'finalize-pending',
      ].includes(name))
      .map(([name]) => name),
    [
      'clear-pending',
      'clear-free-reuse-pending',
      'complete',
      'finalize-free-reuse-pending',
      'finalize-pending',
    ]
  );
});
