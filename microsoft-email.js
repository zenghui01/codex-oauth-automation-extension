(function attachMicrosoftEmailHelpers(globalScope) {
  const OPENAI_SENDER_PATTERNS = [
    /openai\.com/i,
    /auth0\.openai\.com/i,
  ];
  const CODE_PATTERN = /\b(\d{6})\b/;
  const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
  const OUTLOOK_API_BASE = 'https://outlook.office.com/api/v2.0/me/messages';

  async function exchangeRefreshToken(clientId, refreshToken, options = {}) {
    const fetchImpl = options.fetchImpl || globalScope.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('Microsoft 邮箱 helper 缺少 fetch 实现。');
    }

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const errorInfo = (() => {
        try {
          return JSON.parse(text);
        } catch {
          return {};
        }
      })();
      throw new Error(
        errorInfo.error_description
          || `Token exchange failed (${response.status}): ${text.slice(0, 200)}`
      );
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('Token exchange response missing access_token.');
    }
    return data;
  }

  async function fetchOutlookMessages(accessToken, options = {}) {
    const { top = 5, signal } = options;
    const fetchImpl = options.fetchImpl || globalScope.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('Microsoft 邮箱 helper 缺少 fetch 实现。');
    }

    const response = await fetchImpl(
      `${OUTLOOK_API_BASE}?$top=${encodeURIComponent(top)}&$orderby=ReceivedDateTime desc&$select=From,Subject,ReceivedDateTime,BodyPreview,Body`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      }
    );

    if (response.status === 401 || response.status === 403) {
      throw new Error('Microsoft Graph token invalid or expired.');
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Outlook API request failed (${response.status}): ${body || response.statusText}`);
    }

    const payload = await response.json();
    return Array.isArray(payload?.value) ? payload.value : [];
  }

  function normalizeMessage(message) {
    return {
      from: {
        emailAddress: {
          address: message?.From?.EmailAddress?.Address
            || message?.from?.emailAddress?.address
            || '',
        },
      },
      subject: message?.Subject || message?.subject || '',
      receivedDateTime: message?.ReceivedDateTime || message?.receivedDateTime || '',
      bodyPreview: message?.BodyPreview || message?.bodyPreview || '',
      body: {
        content: message?.Body?.Content || message?.body?.content || '',
      },
      id: message?.Id || message?.id || '',
    };
  }

  function getMessageSender(message) {
    return String(
      message?.from?.emailAddress?.address
      || message?.sender?.emailAddress?.address
      || ''
    ).trim();
  }

  function getMessageTimestamp(message) {
    const value = Date.parse(message?.receivedDateTime || message?.createdDateTime || '');
    return Number.isFinite(value) ? value : 0;
  }

  function getMessageSearchText(message) {
    return [
      message?.subject,
      message?.bodyPreview,
      message?.body?.content,
      getMessageSender(message),
    ]
      .map((value) => String(value || ''))
      .join('\n');
  }

  function isOpenAiMessage(message) {
    const sender = getMessageSender(message);
    if (OPENAI_SENDER_PATTERNS.some((pattern) => pattern.test(sender))) {
      return true;
    }

    const searchText = getMessageSearchText(message);
    return OPENAI_SENDER_PATTERNS.some((pattern) => pattern.test(searchText));
  }

  function extractVerificationCodeFromMessages(messages, options = {}) {
    const { filterAfterTimestamp = 0 } = options;

    for (const raw of messages) {
      const message = normalizeMessage(raw);
      const receivedAt = getMessageTimestamp(message);
      if (receivedAt && receivedAt < Number(filterAfterTimestamp || 0)) {
        continue;
      }
      if (!isOpenAiMessage(message)) {
        continue;
      }

      const match = getMessageSearchText(message).match(CODE_PATTERN);
      if (!match) {
        continue;
      }

      return {
        code: match[1],
        emailTimestamp: receivedAt || Date.now(),
        messageId: message?.id || null,
        sender: getMessageSender(message),
        subject: String(message?.subject || ''),
      };
    }

    return null;
  }

  async function fetchMicrosoftMailboxMessages(options = {}) {
    const {
      clientId,
      refreshToken,
      top = 5,
      fetchImpl,
      signal,
    } = options;

    if (!refreshToken) {
      throw new Error('Microsoft refresh token is empty.');
    }
    if (!clientId) {
      throw new Error('Microsoft client_id is empty.');
    }

    const tokenData = await exchangeRefreshToken(clientId, refreshToken, { fetchImpl, signal });
    const rawMessages = await fetchOutlookMessages(tokenData.access_token, { top, signal, fetchImpl });

    return {
      tokenData,
      nextRefreshToken: String(tokenData?.refresh_token || '').trim(),
      messages: rawMessages.map((message) => normalizeMessage(message)),
    };
  }

  async function fetchMicrosoftVerificationCode(options = {}) {
    const {
      token,
      clientId,
      maxRetries = 3,
      retryDelayMs = 10000,
      log = null,
      filterAfterTimestamp = 0,
      fetchImpl,
      signal,
    } = options;

    if (!token) {
      throw new Error('Microsoft refresh token is empty.');
    }
    if (!clientId) {
      throw new Error('Microsoft client_id is empty.');
    }

    const tokenData = await exchangeRefreshToken(clientId, token, { fetchImpl, signal });
    const accessToken = tokenData.access_token;
    const nextRefreshToken = String(tokenData?.refresh_token || '').trim();

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const messages = await fetchOutlookMessages(accessToken, { top: 5, signal, fetchImpl });
      const result = extractVerificationCodeFromMessages(messages, { filterAfterTimestamp });
      if (result) {
        return {
          ...result,
          nextRefreshToken,
          messages: messages.map((message) => normalizeMessage(message)),
        };
      }

      if (attempt < maxRetries) {
        if (typeof log === 'function') {
          log(`Outlook API: attempt ${attempt}/${maxRetries} found no OpenAI verification mail, retrying...`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error('No matching OpenAI verification email found.');
  }

  const api = {
    CODE_PATTERN,
    exchangeRefreshToken,
    extractVerificationCodeFromMessages,
    fetchMicrosoftMailboxMessages,
    fetchMicrosoftVerificationCode,
    fetchOutlookMessages,
    getMessageSender,
    getMessageTimestamp,
    isOpenAiMessage,
    normalizeMessage,
  };

  globalScope.MultiPageMicrosoftEmail = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
