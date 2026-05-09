const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

function getStep5OutcomeBundle() {
  return [
    extractFunction('getStep5ProfilePathPatterns'),
    extractFunction('getStep5AuthRetryPathPatterns'),
    extractFunction('isStep5ProfilePageUrl'),
    extractFunction('getStep5AuthRetryPageState'),
    extractFunction('getStep5SubmitButton'),
    extractFunction('waitForStep5SubmitButton'),
    extractFunction('isStep5SubmitButtonClickable'),
    extractFunction('isStep5ProfileStillVisible'),
    extractFunction('getStep5PostSubmitSuccessState'),
    extractFunction('installStep5NavigationCompletionReporter'),
    extractFunction('waitForStep5SubmitOutcome'),
  ].join('\n');
}

function getStep5Bundle() {
  return [
    extractFunction('getStep5DirectCompletionPayload'),
    extractFunction('isSignupProfilePageUrl'),
    extractFunction('isStep5AllConsentText'),
    extractFunction('findStep5AllConsentCheckbox'),
    extractFunction('isStep5CheckboxChecked'),
    getStep5OutcomeBundle(),
    extractFunction('step5_fillNameBirthday'),
  ].join('\n');
}

test('step 5 waits for post-submit outcome before completing on birthday page', async () => {
  const step5Source = extractFunction('step5_fillNameBirthday');
  assert.ok(
    step5Source.includes('waitForStep5SubmitOutcome('),
    'Step 5 提交后必须等待页面结果'
  );
  assert.ok(
    !step5Source.includes('不再等待页面结果'),
    'Step 5 不应再保留直接完成的旧日志'
  );

  const api = new Function(`
const logs = [];
const completions = [];
const clicks = [];
const selectedBirthday = {};

const nameInput = { value: '', hidden: false };
const hiddenBirthday = {
  value: '',
  hidden: false,
  dispatchEvent() {},
};
const completeButton = {
  tagName: 'BUTTON',
  textContent: '完成帐户创建',
  hidden: false,
  getAttribute() { return ''; },
};

const birthdaySelects = {
  '年': { label: '年', button: { hidden: false }, nativeSelect: {} },
  '月': { label: '月', button: { hidden: false }, nativeSelect: {} },
  '天': { label: '天', button: { hidden: false }, nativeSelect: {} },
};

const location = {
  href: 'https://auth.openai.com/u/signup/profile',
};

const document = {
  querySelector(selector) {
    switch (selector) {
      case '[role="spinbutton"][data-type="year"]':
      case '[role="spinbutton"][data-type="month"]':
      case '[role="spinbutton"][data-type="day"]':
      case 'input[name="age"]':
        return null;
      case 'input[name="birthday"]':
        return hiddenBirthday;
      case 'button[type="submit"], input[type="submit"]':
      case 'button[type="submit"]':
        return completeButton;
      default:
        return null;
    }
  },
  querySelectorAll(selector) {
    if (selector === 'input[name="allCheckboxes"][type="checkbox"]') {
      return [];
    }
    if (selector === 'button, [role="button"], input[type="button"], input[type="submit"]') {
      return [completeButton];
    }
    return [];
  },
  execCommand() {},
};

function Event(type, init = {}) {
  this.type = type;
  this.bubbles = Boolean(init.bubbles);
}

function log(message, level = 'info') {
  logs.push({ message, level });
}

function throwIfStopped() {}
async function waitForElement() { return nameInput; }
async function humanPause() {}
async function sleep() {}

function fillInput(input, value) {
  input.value = value;
}

function findBirthdayReactAriaSelect(label) {
  return birthdaySelects[label] || null;
}

function isVisibleElement(el) {
  return Boolean(el) && !el.hidden;
}

function isActionEnabled(el) {
  return Boolean(el) && !el.disabled && el.getAttribute?.('aria-disabled') !== 'true';
}

function getActionText(el) {
  return el.textContent || '';
}

async function setReactAriaBirthdaySelect(select, value) {
  selectedBirthday[select.label] = String(value).padStart(select.label === '年' ? 4 : 2, '0');
  if (selectedBirthday['年'] && selectedBirthday['月'] && selectedBirthday['天']) {
    hiddenBirthday.value = \`\${selectedBirthday['年']}-\${selectedBirthday['月']}-\${selectedBirthday['天']}\`;
  }
}

async function waitForElementByText() {
  throw new Error('waitForElementByText should not run in this test');
}

function simulateClick(el) {
  clicks.push(el.textContent || el.tagName || 'element');
  if (el === completeButton) {
    location.href = 'https://chatgpt.com/';
  }
}

function reportComplete(step, payload) {
  completions.push({ step, payload });
}

function normalizeInlineText(text) {
  return String(text || '').replace(/\\s+/g, ' ').trim();
}
function getSignupAuthRetryPathPatterns() { return []; }
function getAuthTimeoutErrorPageState() { return null; }
async function recoverCurrentAuthRetryPage() { throw new Error('should not recover retry page'); }
function createSignupUserAlreadyExistsError() { return new Error('user already exists'); }
function createAuthMaxCheckAttemptsError() { return new Error('max_check_attempts'); }
function getStep5ErrorText() { return ''; }
function isStep5Ready() { return /^https:\\/\\/auth\\.openai\\.com\\//.test(location.href); }
function isLikelyLoggedInChatgptHomeUrl() { return /^https:\\/\\/chatgpt\\.com\\//.test(location.href); }
function isOAuthConsentPage() { return false; }
function isAddPhonePageReady() { return false; }

${getStep5Bundle()}

return {
  async run(payload) {
    return step5_fillNameBirthday(payload);
  },
  snapshot() {
    return {
      logs,
      completions,
      clicks,
      nameValue: nameInput.value,
      birthdayValue: hiddenBirthday.value,
    };
  },
};
`)();

  const result = await api.run({
    firstName: 'Test',
    lastName: 'User',
    year: 2003,
    month: 6,
    day: 19,
  });

  const snapshot = api.snapshot();
  assert.deepStrictEqual(result, {
    profileSubmitted: true,
    postSubmitChecked: true,
    outcome: 'logged_in_home',
    url: 'https://chatgpt.com/',
  });
  assert.deepStrictEqual(snapshot.completions, [
    {
      step: 5,
      payload: {
        profileSubmitted: true,
        postSubmitChecked: true,
        outcome: 'logged_in_home',
        url: 'https://chatgpt.com/',
      },
    },
  ]);
  assert.deepStrictEqual(snapshot.clicks, ['完成帐户创建']);
  assert.equal(snapshot.nameValue, 'Test User');
  assert.equal(snapshot.birthdayValue, '2003-06-19');
  assert.ok(
    snapshot.logs.some(({ message }) => /资料提交结果已确认/.test(message)),
    '日志应明确说明 Step 5 已完成提交后检测'
  );
});

test('step 5 retries submit while profile page remains visible', async () => {
  const api = new Function(`
const realDateNow = Date.now;
let now = 0;
const logs = [];
const completions = [];
const clicks = [];
const nameInput = { value: '', hidden: false };
const ageInput = { value: '', hidden: false };
const completeButton = {
  tagName: 'BUTTON',
  textContent: '完成帐户创建',
  hidden: false,
  getAttribute() { return ''; },
};
const location = {
  href: 'https://auth.openai.com/u/signup/profile',
};
const document = {
  querySelector(selector) {
    switch (selector) {
      case '[role="spinbutton"][data-type="year"]':
      case '[role="spinbutton"][data-type="month"]':
      case '[role="spinbutton"][data-type="day"]':
      case 'input[name="birthday"]':
        return null;
      case 'input[name="age"]':
        return /^https:\\/\\/auth\\.openai\\.com\\//.test(location.href) ? ageInput : null;
      case 'button[type="submit"], input[type="submit"]':
      case 'button[type="submit"]':
        return completeButton;
      default:
        return null;
    }
  },
  querySelectorAll(selector) {
    if (selector === 'input[name="allCheckboxes"][type="checkbox"]') return [];
    if (selector === 'input[type="checkbox"]') return [];
    if (selector === 'button, [role="button"], input[type="button"], input[type="submit"]') return [completeButton];
    return [];
  },
  execCommand() {},
};

Date.now = () => now;
function log(message, level = 'info') { logs.push({ message, level }); }
function throwIfStopped() {}
async function waitForElement() { return nameInput; }
async function humanPause() {}
async function sleep(ms = 0) { now += ms || 250; }
function fillInput(input, value) { input.value = value; }
function findBirthdayReactAriaSelect() { return null; }
function isVisibleElement(el) { return Boolean(el) && !el.hidden; }
function isActionEnabled(el) { return Boolean(el) && !el.disabled && el.getAttribute?.('aria-disabled') !== 'true'; }
function getActionText(el) { return el.textContent || ''; }
async function setReactAriaBirthdaySelect() { throw new Error('setReactAriaBirthdaySelect should not run'); }
async function waitForElementByText() { return completeButton; }
function simulateClick(el) {
  clicks.push(el.textContent || el.tagName || 'element');
  if (el === completeButton && clicks.filter((text) => text === '完成帐户创建').length >= 3) {
    location.href = 'https://chatgpt.com/';
  }
}
function reportComplete(step, payload) { completions.push({ step, payload }); }
function normalizeInlineText(text) { return String(text || '').replace(/\\s+/g, ' ').trim(); }
function getSignupAuthRetryPathPatterns() { return []; }
function getAuthTimeoutErrorPageState() { return null; }
async function recoverCurrentAuthRetryPage() { throw new Error('should not recover retry page'); }
function createSignupUserAlreadyExistsError() { return new Error('user already exists'); }
function createAuthMaxCheckAttemptsError() { return new Error('max_check_attempts'); }
function getStep5ErrorText() { return ''; }
function isStep5Ready() { return /^https:\\/\\/auth\\.openai\\.com\\//.test(location.href); }
function isLikelyLoggedInChatgptHomeUrl() { return /^https:\\/\\/chatgpt\\.com\\//.test(location.href); }
function isOAuthConsentPage() { return false; }
function isAddPhonePageReady() { return false; }

${getStep5Bundle()}

return {
  run() {
    return step5_fillNameBirthday({
      firstName: 'Mia',
      lastName: 'Harris',
      age: 19,
    });
  },
  snapshot() {
    return { logs, completions, clicks, nameValue: nameInput.value, ageValue: ageInput.value };
  },
  restore() {
    Date.now = realDateNow;
  },
};
`)();

  let result;
  try {
    result = await api.run();
  } finally {
    api.restore();
  }
  const snapshot = api.snapshot();

  assert.deepStrictEqual(result, {
    profileSubmitted: true,
    postSubmitChecked: true,
    ageMode: true,
    outcome: 'logged_in_home',
    url: 'https://chatgpt.com/',
  });
  assert.equal(snapshot.nameValue, 'Mia Harris');
  assert.equal(snapshot.ageValue, '19');
  assert.equal(snapshot.clicks.filter((text) => text === '完成帐户创建').length, 3);
  assert.equal(snapshot.logs.some(({ message }) => /仍停留在资料页，正在重新点击/.test(message)), true);
});

test('step 5 recovers auth retry page after profile submit', async () => {
  const api = new Function(`
let retryVisible = true;
let recoverCalls = 0;
const location = { href: 'https://auth.openai.com/create-account/profile' };
const document = {
  querySelector() { return null; },
  querySelectorAll() { return []; },
};

function throwIfStopped() {}
function log() {}
async function sleep() {}
async function humanPause() {}
function simulateClick() {}
function isVisibleElement() { return true; }
function isActionEnabled() { return true; }
function getActionText(el) { return el?.textContent || ''; }
function getSignupAuthRetryPathPatterns() { return []; }
function getAuthTimeoutErrorPageState() {
  if (!retryVisible) return null;
  return {
    retryEnabled: true,
    userAlreadyExistsBlocked: false,
    maxCheckAttemptsBlocked: false,
  };
}
async function recoverCurrentAuthRetryPage() {
  recoverCalls += 1;
  retryVisible = false;
  location.href = 'https://chatgpt.com/';
}
function createSignupUserAlreadyExistsError() { return new Error('user already exists'); }
function createAuthMaxCheckAttemptsError() { return new Error('max_check_attempts'); }
function getStep5ErrorText() { return ''; }
function isStep5Ready() { return /^https:\\/\\/auth\\.openai\\.com\\//.test(location.href); }
function isLikelyLoggedInChatgptHomeUrl() { return /^https:\\/\\/chatgpt\\.com\\//.test(location.href); }
function isOAuthConsentPage() { return false; }
function isAddPhonePageReady() { return false; }

${extractFunction('isSignupProfilePageUrl')}
${getStep5OutcomeBundle()}

return {
  run() {
    return waitForStep5SubmitOutcome({ timeoutMs: 1000 });
  },
  snapshot() {
    return { recoverCalls };
  },
};
`)();

  const result = await api.run();

  assert.deepStrictEqual(result, {
    state: 'logged_in_home',
    url: 'https://chatgpt.com/',
  });
  assert.equal(api.snapshot().recoverCalls, 1);
});
