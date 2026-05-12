(function attachOpenAiMailRules(root, factory) {
  root.MultiPageOpenAiMailRules = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOpenAiMailRulesModule() {
  const SIGNUP_CODE_RULE_ID = 'openai-signup-code';
  const LOGIN_CODE_RULE_ID = 'openai-login-code';

  function createOpenAiMailRules(deps = {}) {
    const {
      getHotmailVerificationRequestTimestamp = () => 0,
      MAIL_2925_VERIFICATION_INTERVAL_MS = 15000,
      MAIL_2925_VERIFICATION_MAX_ATTEMPTS = 15,
    } = deps;

    function isMail2925Provider(state = {}) {
      return String(state?.mailProvider || '').trim().toLowerCase() === '2925';
    }

    function shouldMatchMail2925TargetEmail(state = {}) {
      return isMail2925Provider(state)
        && String(state?.mail2925Mode || '').trim().toLowerCase() === 'receive';
    }

    function getRuleDefinition(step, state = {}) {
      const normalizedStep = Number(step) === 4 ? 4 : 8;
      const mail2925Provider = isMail2925Provider(state);
      const signupStep = normalizedStep === 4;

      return {
        flowId: 'openai',
        ruleId: signupStep ? SIGNUP_CODE_RULE_ID : LOGIN_CODE_RULE_ID,
        step: normalizedStep,
        artifactType: 'code',
        filterAfterTimestamp: mail2925Provider
          ? 0
          : getHotmailVerificationRequestTimestamp(normalizedStep, state),
        senderFilters: signupStep
          ? ['openai', 'noreply', 'verify', 'auth', 'duckduckgo', 'forward']
          : ['openai', 'noreply', 'verify', 'auth', 'chatgpt', 'duckduckgo', 'forward'],
        subjectFilters: signupStep
          ? ['verify', 'verification', 'code', '验证码', 'confirm']
          : ['verify', 'verification', 'code', '验证码', 'confirm', 'login'],
        targetEmail: signupStep
          ? state?.email
          : (String(state?.step8VerificationTargetEmail || '').trim() || state?.email),
        mail2925MatchTargetEmail: shouldMatchMail2925TargetEmail(state),
        maxAttempts: mail2925Provider ? MAIL_2925_VERIFICATION_MAX_ATTEMPTS : 5,
        intervalMs: mail2925Provider ? MAIL_2925_VERIFICATION_INTERVAL_MS : 3000,
      };
    }

    function buildVerificationPollPayload(step, state = {}, overrides = {}) {
      return {
        ...getRuleDefinition(step, state),
        ...(overrides || {}),
      };
    }

    return {
      buildVerificationPollPayload,
      getRuleDefinition,
    };
  }

  return {
    LOGIN_CODE_RULE_ID,
    SIGNUP_CODE_RULE_ID,
    createOpenAiMailRules,
  };
});
