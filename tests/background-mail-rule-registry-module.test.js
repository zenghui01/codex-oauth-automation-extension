const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports mail rule registry and OpenAI mail rules modules', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/mail-rule-registry\.js/);
  assert.match(source, /flows\/openai\/mail-rules\.js/);
});

test('mail rule registry exposes canonical OpenAI verification poll payloads', () => {
  const registrySource = fs.readFileSync('background/mail-rule-registry.js', 'utf8');
  const openAiSource = fs.readFileSync('flows/openai/mail-rules.js', 'utf8');
  const registryApi = new Function('self', `${registrySource}; return self.MultiPageBackgroundMailRuleRegistry;`)({});
  const openAiApi = new Function('self', `${openAiSource}; return self.MultiPageOpenAiMailRules;`)({});

  const openAiMailRules = openAiApi.createOpenAiMailRules({
    getHotmailVerificationRequestTimestamp: (step) => (step === 4 ? 123 : 456),
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
  });
  const registry = registryApi.createMailRuleRegistry({
    defaultFlowId: 'openai',
    flowBuilders: {
      openai: openAiMailRules,
    },
  });

  assert.deepEqual(
    registry.buildVerificationPollPayload(
      4,
      {
        activeFlowId: 'openai',
        email: 'user@example.com',
        mailProvider: '2925',
        mail2925Mode: 'receive',
      },
      { excludeCodes: ['111111'] }
    ),
    {
      flowId: 'openai',
      ruleId: 'openai-signup-code',
      step: 4,
      artifactType: 'code',
      filterAfterTimestamp: 0,
      senderFilters: ['openai', 'noreply', 'verify', 'auth', 'duckduckgo', 'forward'],
      subjectFilters: ['verify', 'verification', 'code', '验证码', 'confirm'],
      targetEmail: 'user@example.com',
      mail2925MatchTargetEmail: true,
      maxAttempts: 15,
      intervalMs: 15000,
      excludeCodes: ['111111'],
    }
  );

  assert.deepEqual(
    registry.buildVerificationPollPayload(8, {
      activeFlowId: 'openai',
      email: 'user@example.com',
      step8VerificationTargetEmail: 'login@example.com',
    }),
    {
      flowId: 'openai',
      ruleId: 'openai-login-code',
      step: 8,
      artifactType: 'code',
      filterAfterTimestamp: 456,
      senderFilters: ['openai', 'noreply', 'verify', 'auth', 'chatgpt', 'duckduckgo', 'forward'],
      subjectFilters: ['verify', 'verification', 'code', '验证码', 'confirm', 'login'],
      targetEmail: 'login@example.com',
      mail2925MatchTargetEmail: false,
      maxAttempts: 5,
      intervalMs: 3000,
    }
  );
});

test('mail rule registry rejects unknown active flow ids instead of silently using OpenAI rules', () => {
  const registrySource = fs.readFileSync('background/mail-rule-registry.js', 'utf8');
  const registryApi = new Function('self', `${registrySource}; return self.MultiPageBackgroundMailRuleRegistry;`)({});
  const registry = registryApi.createMailRuleRegistry({
    defaultFlowId: 'openai',
    flowBuilders: {},
  });

  assert.throws(
    () => registry.buildVerificationPollPayload(4, {
      activeFlowId: 'site-a',
      email: 'user@example.com',
    }),
    /未找到 flow=site-a 的邮件轮询规则构造器/
  );
});
