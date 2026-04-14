const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Hotmail API对接界面文案应启用 remote 模式并隐藏禁用态', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(
    html,
    /data-hotmail-service-mode="remote"[^>]*>\s*API对接\s*<\/button>/,
    'remote 模式按钮应显示为 API对接'
  );
  assert.doesNotMatch(
    html,
    /data-hotmail-service-mode="remote"[^>]*\sdisabled(\s|>)/,
    'API对接按钮不应继续被禁用'
  );
  assert.match(
    html,
    /<span class="data-label">API对接<\/span>/,
    'Hotmail 配置行文案应改为 API对接'
  );
});

test('Hotmail API对接应接入微软邮箱 helper 而不是旧远程服务占位', () => {
  const background = fs.readFileSync('background.js', 'utf8');

  assert.match(background, /importScripts\([^)]*microsoft-email\.js[^)]*\)/, 'background 应加载微软邮箱 helper');
  assert.match(background, /fetchMicrosoftVerificationCode/, '步骤 4\/7 应接入微软验证码读取 helper');
  assert.match(background, /fetchMicrosoftMailboxMessages/, '账号校验和最新验证码应接入微软邮箱列表 helper');
});
