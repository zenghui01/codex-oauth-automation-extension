const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractVerificationCodeFromMessages,
  fetchMicrosoftMailboxMessages,
  fetchMicrosoftVerificationCode,
} = require('../microsoft-email.js');

test('extractVerificationCodeFromMessages 只命中过滤时间后的 OpenAI 微软邮件', () => {
  const result = extractVerificationCodeFromMessages([
    {
      From: { EmailAddress: { Address: 'noreply@openai.com' } },
      Subject: 'Your code is 112233',
      BodyPreview: '112233',
      ReceivedDateTime: '2026-04-14T09:00:00.000Z',
      Id: 'too-old',
    },
    {
      From: { EmailAddress: { Address: 'alerts@example.com' } },
      Subject: 'Your code is 223344',
      BodyPreview: '223344',
      ReceivedDateTime: '2026-04-14T10:00:00.000Z',
      Id: 'wrong-sender',
    },
    {
      From: { EmailAddress: { Address: 'account-security@openai.com' } },
      Subject: 'OpenAI verification',
      BodyPreview: 'Use 334455 to continue',
      ReceivedDateTime: '2026-04-14T10:05:00.000Z',
      Id: 'matched',
    },
  ], {
    filterAfterTimestamp: Date.UTC(2026, 3, 14, 9, 30, 0),
  });

  assert.deepEqual(result, {
    code: '334455',
    emailTimestamp: Date.UTC(2026, 3, 14, 10, 5, 0),
    messageId: 'matched',
    sender: 'account-security@openai.com',
    subject: 'OpenAI verification',
  });
});

test('fetchMicrosoftMailboxMessages 使用 refresh token 拉取微软邮箱列表并返回新 token', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).includes('/oauth2/v2.0/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-token-1',
          refresh_token: 'refresh-token-next',
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        value: [
          {
            From: { EmailAddress: { Address: 'noreply@openai.com' } },
            Subject: 'OpenAI verification',
            BodyPreview: 'Use 445566 to continue',
            ReceivedDateTime: '2026-04-14T10:06:00.000Z',
            Id: 'mail-1',
          },
        ],
      }),
    };
  };

  const result = await fetchMicrosoftMailboxMessages({
    clientId: 'client-1',
    refreshToken: 'refresh-token-1',
    top: 5,
    fetchImpl,
  });

  assert.equal(requests.length, 2);
  assert.equal(result.nextRefreshToken, 'refresh-token-next');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, 'mail-1');
});

test('fetchMicrosoftVerificationCode 会重试直到命中最新验证码', async () => {
  let messageRequestCount = 0;
  const logs = [];
  const fetchImpl = async (url) => {
    if (String(url).includes('/oauth2/v2.0/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-token-2',
          refresh_token: 'refresh-token-next-2',
        }),
      };
    }

    messageRequestCount += 1;
    if (messageRequestCount === 1) {
      return {
        ok: true,
        json: async () => ({
          value: [{
            From: { EmailAddress: { Address: 'alerts@example.com' } },
            Subject: 'Nothing useful',
            BodyPreview: 'No code',
            ReceivedDateTime: '2026-04-14T10:00:00.000Z',
            Id: 'mail-ignore',
          }],
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        value: [{
          From: { EmailAddress: { Address: 'noreply@openai.com' } },
          Subject: 'Your verification code',
          BodyPreview: '667788',
          ReceivedDateTime: '2026-04-14T10:10:00.000Z',
          Id: 'mail-hit',
        }],
      }),
    };
  };

  const result = await fetchMicrosoftVerificationCode({
    token: 'refresh-token-2',
    clientId: 'client-2',
    maxRetries: 2,
    retryDelayMs: 0,
    fetchImpl,
    log: (message) => logs.push(message),
    filterAfterTimestamp: Date.UTC(2026, 3, 14, 9, 0, 0),
  });

  assert.equal(result.code, '667788');
  assert.equal(result.messageId, 'mail-hit');
  assert.equal(result.nextRefreshToken, 'refresh-token-next-2');
  assert.equal(logs.some((message) => /retrying/i.test(message)), true);
});
