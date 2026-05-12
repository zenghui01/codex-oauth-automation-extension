(function attachMultiPageFlowCapabilities(root, factory) {
  root.MultiPageFlowCapabilities = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createFlowCapabilitiesModule() {
  const DEFAULT_FLOW_ID = 'openai';
  const DEFAULT_PANEL_MODE = 'cpa';
  const SIGNUP_METHOD_EMAIL = 'email';
  const SIGNUP_METHOD_PHONE = 'phone';
  const VALID_PANEL_MODES = Object.freeze(['cpa', 'sub2api', 'codex2api']);

  const DEFAULT_FLOW_CAPABILITIES = Object.freeze({
    supportsEmailSignup: true,
    supportsPhoneSignup: false,
    supportsPhoneVerificationSettings: false,
    supportsPlusMode: false,
    supportsContributionMode: false,
    supportsPlatformBinding: [],
    supportsLuckmail: false,
    supportsOauthTimeoutBudget: false,
    canSwitchFlow: false,
    stepDefinitionMode: 'default',
  });

  const FLOW_CAPABILITIES = Object.freeze({
    openai: Object.freeze({
      ...DEFAULT_FLOW_CAPABILITIES,
      supportsPhoneSignup: true,
      supportsPhoneVerificationSettings: true,
      supportsPlusMode: true,
      supportsContributionMode: true,
      supportsPlatformBinding: ['cpa', 'sub2api', 'codex2api'],
      supportsLuckmail: true,
      supportsOauthTimeoutBudget: true,
      stepDefinitionMode: 'openai-dynamic',
    }),
  });

  const DEFAULT_PANEL_CAPABILITIES = Object.freeze({
    supportsPhoneSignup: true,
    requiresPhoneSignupWarning: false,
  });

  const PANEL_CAPABILITIES = Object.freeze({
    cpa: Object.freeze({
      supportsPhoneSignup: true,
      requiresPhoneSignupWarning: true,
    }),
    sub2api: Object.freeze({
      supportsPhoneSignup: true,
      requiresPhoneSignupWarning: false,
    }),
    codex2api: Object.freeze({
      supportsPhoneSignup: true,
      requiresPhoneSignupWarning: false,
    }),
  });

  function normalizeFlowId(value = '', fallback = DEFAULT_FLOW_ID) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
    const fallbackValue = String(fallback || '').trim().toLowerCase();
    return fallbackValue || DEFAULT_FLOW_ID;
  }

  function normalizePanelMode(value = '', fallback = DEFAULT_PANEL_MODE) {
    const normalized = String(value || '').trim().toLowerCase();
    if (VALID_PANEL_MODES.includes(normalized)) {
      return normalized;
    }
    const fallbackValue = String(fallback || '').trim().toLowerCase();
    return VALID_PANEL_MODES.includes(fallbackValue) ? fallbackValue : DEFAULT_PANEL_MODE;
  }

  function normalizeSignupMethod(value = '') {
    return String(value || '').trim().toLowerCase() === SIGNUP_METHOD_PHONE
      ? SIGNUP_METHOD_PHONE
      : SIGNUP_METHOD_EMAIL;
  }

  function normalizePanelModeList(values = []) {
    if (!Array.isArray(values)) {
      return [];
    }
    const seen = new Set();
    const normalized = [];
    values.forEach((value) => {
      const mode = normalizePanelMode(value, '');
      if (!mode || seen.has(mode)) {
        return;
      }
      seen.add(mode);
      normalized.push(mode);
    });
    return normalized;
  }

  function createFlowCapabilityRegistry(deps = {}) {
    const {
      defaultFlowCapabilities = DEFAULT_FLOW_CAPABILITIES,
      defaultFlowId = DEFAULT_FLOW_ID,
      defaultPanelCapabilities = DEFAULT_PANEL_CAPABILITIES,
      flowCapabilities = FLOW_CAPABILITIES,
      panelCapabilities = PANEL_CAPABILITIES,
    } = deps;

    function getFlowCapabilities(flowId) {
      const normalizedFlowId = normalizeFlowId(flowId, defaultFlowId);
      const entry = flowCapabilities[normalizedFlowId] || null;
      return {
        ...defaultFlowCapabilities,
        ...(entry || {}),
        supportsPlatformBinding: normalizePanelModeList(entry?.supportsPlatformBinding || defaultFlowCapabilities.supportsPlatformBinding),
      };
    }

    function getPanelCapabilities(panelMode) {
      const normalizedPanelMode = normalizePanelMode(panelMode);
      return {
        ...defaultPanelCapabilities,
        ...(panelCapabilities[normalizedPanelMode] || {}),
      };
    }

    function resolveSidepanelCapabilities(options = {}) {
      const state = options?.state || {};
      const activeFlowId = normalizeFlowId(
        options?.activeFlowId ?? state?.activeFlowId,
        defaultFlowId
      );
      const flowState = getFlowCapabilities(activeFlowId);
      const requestedPanelMode = normalizePanelMode(
        options?.panelMode ?? state?.panelMode,
        DEFAULT_PANEL_MODE
      );
      const supportedPanelModes = normalizePanelModeList(flowState.supportsPlatformBinding);
      const panelModeSupported = supportedPanelModes.length === 0
        ? true
        : supportedPanelModes.includes(requestedPanelMode);
      const effectivePanelMode = panelModeSupported
        ? requestedPanelMode
        : supportedPanelModes[0];
      const panelState = getPanelCapabilities(effectivePanelMode);
      const runtimeLocks = {
        autoRunLocked: Boolean(options?.autoRunLocked ?? state?.autoRunLocked),
        contributionMode: flowState.supportsContributionMode && Boolean(state?.contributionMode),
        phoneVerificationEnabled: flowState.supportsPhoneVerificationSettings && Boolean(state?.phoneVerificationEnabled),
        plusModeEnabled: flowState.supportsPlusMode && Boolean(state?.plusModeEnabled),
        settingsMenuLocked: Boolean(options?.settingsMenuLocked ?? state?.settingsMenuLocked),
      };
      const effectiveSignupMethods = [];
      if (flowState.supportsEmailSignup !== false) {
        effectiveSignupMethods.push(SIGNUP_METHOD_EMAIL);
      }
      const canSelectPhoneSignup = Boolean(flowState.supportsPhoneSignup)
        && Boolean(panelState.supportsPhoneSignup)
        && runtimeLocks.phoneVerificationEnabled
        && !runtimeLocks.plusModeEnabled
        && !runtimeLocks.contributionMode;
      if (canSelectPhoneSignup) {
        effectiveSignupMethods.push(SIGNUP_METHOD_PHONE);
      }
      if (!effectiveSignupMethods.length) {
        effectiveSignupMethods.push(SIGNUP_METHOD_EMAIL);
      }
      const requestedSignupMethod = normalizeSignupMethod(
        options?.signupMethod ?? state?.signupMethod
      );
      const effectiveSignupMethod = requestedSignupMethod === SIGNUP_METHOD_PHONE && canSelectPhoneSignup
        ? SIGNUP_METHOD_PHONE
        : (effectiveSignupMethods.includes(SIGNUP_METHOD_EMAIL)
          ? SIGNUP_METHOD_EMAIL
          : effectiveSignupMethods[0]);

      return {
        activeFlowId,
        canShowContributionMode: Boolean(flowState.supportsContributionMode),
        canShowLuckmail: Boolean(flowState.supportsLuckmail),
        canShowPhoneSettings: Boolean(flowState.supportsPhoneVerificationSettings),
        canShowPlusSettings: Boolean(flowState.supportsPlusMode),
        canSwitchFlow: Boolean(flowState.canSwitchFlow),
        canUsePhoneSignup: canSelectPhoneSignup,
        canUseSelectedPanelMode: panelModeSupported,
        effectivePanelMode,
        effectiveSignupMethod,
        effectiveSignupMethods,
        flowCapabilities: flowState,
        panelCapabilities: panelState,
        panelMode: effectivePanelMode,
        requestedPanelMode,
        requestedSignupMethod,
        runtimeLocks,
        shouldWarnCpaPhoneSignup: effectiveSignupMethod === SIGNUP_METHOD_PHONE
          && Boolean(panelState.requiresPhoneSignupWarning),
        stepDefinitionOptions: {
          activeFlowId,
          panelMode: effectivePanelMode,
          plusModeEnabled: runtimeLocks.plusModeEnabled,
          signupMethod: effectiveSignupMethod,
        },
        supportedPanelModes,
      };
    }

    function canUsePhoneSignup(state = {}) {
      return resolveSidepanelCapabilities({ state }).canUsePhoneSignup;
    }

    function resolveSignupMethod(state = {}, signupMethod = undefined) {
      return resolveSidepanelCapabilities({
        signupMethod,
        state,
      }).effectiveSignupMethod;
    }

    return {
      canUsePhoneSignup,
      getFlowCapabilities,
      getPanelCapabilities,
      normalizeFlowId,
      normalizePanelMode,
      normalizeSignupMethod,
      resolveSidepanelCapabilities,
      resolveSignupMethod,
    };
  }

  return {
    createFlowCapabilityRegistry,
    DEFAULT_FLOW_CAPABILITIES,
    DEFAULT_FLOW_ID,
    DEFAULT_PANEL_CAPABILITIES,
    DEFAULT_PANEL_MODE,
    FLOW_CAPABILITIES,
    PANEL_CAPABILITIES,
    SIGNUP_METHOD_EMAIL,
    SIGNUP_METHOD_PHONE,
    normalizeFlowId,
    normalizePanelMode,
    normalizeSignupMethod,
  };
});
