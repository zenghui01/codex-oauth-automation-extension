(function attachBackgroundPrefetchAddPhoneNumber(root, factory) {
  root.MultiPageBackgroundPrefetchAddPhoneNumber = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPrefetchAddPhoneNumberModule() {
  const STEP0_RETRY_DELAY_MS = 30000;
  const STEP0_PREFETCH_RETRY_STATE_KEY = 'step0PrefetchRetry';

  function createPrefetchAddPhoneNumberExecutor(deps = {}) {
    const {
      addLog,
      clearStep0PrefetchRetryState,
      completeStepFromBackground,
      ensureStep0PrefetchRetryAlarm,
      getState,
      phoneVerificationHelpers,
      setStepStatus,
      setState,
      throwIfStopped,
    } = deps;

    function isLongWaitActiveFor(waitUntil) {
      return Number.isFinite(waitUntil) && waitUntil > Date.now();
    }

    function normalizeStep0PrefetchRetryState(record) {
      if (!record || typeof record !== 'object') {
        return null;
      }
      const retryAt = Number(record.retryAt || 0);
      const attempt = Math.max(1, Math.floor(Number(record.attempt) || 1));
      if (!Number.isFinite(retryAt) || retryAt <= 0) {
        return null;
      }
      return {
        retryAt,
        attempt,
      };
    }

    function isExistingActivationStillPrefetchOnly(state = {}, activation = null) {
      if (!activation) {
        return false;
      }
      const expiresAt = Number(activation.expiresAt || 0);
      if (expiresAt > 0 && expiresAt <= Date.now()) {
        return false;
      }
      if (activation.phoneCodeReceived) {
        return false;
      }
      if (String(state?.currentPhoneVerificationCode || '').trim()) {
        return false;
      }
      if (Number(state?.currentPhoneVerificationCountdownEndsAt || 0) > 0) {
        return false;
      }
      return true;
    }

    async function clearRetryState(reason = '') {
      if (typeof clearStep0PrefetchRetryState === 'function') {
        await clearStep0PrefetchRetryState(reason);
        return;
      }
      await setState({
        [STEP0_PREFETCH_RETRY_STATE_KEY]: null,
      });
    }

    async function executeStep0(state = {}) {
      const latestState = state || await getState();
      if (!latestState?.phoneVerificationEnabled) {
        await clearRetryState('步骤 0：已关闭补手机接码能力，清理预取重试计划。');
        await addLog('步骤 0：未开启补手机接码能力，跳过当前预取步骤。', 'info', {
          step: 0,
          stepKey: 'prefetch-add-phone-number',
        });
        await setStepStatus(0, 'skipped');
        return;
      }

      throwIfStopped();
      const currentState = await getState();
      const retryState = normalizeStep0PrefetchRetryState(currentState[STEP0_PREFETCH_RETRY_STATE_KEY]);
      const cycle = retryState?.attempt || 1;
      const existingActivation = phoneVerificationHelpers.normalizeActivation?.(currentState?.currentPhoneActivation);
      if (existingActivation) {
        if (!isExistingActivationStillPrefetchOnly(currentState, existingActivation)) {
          await addLog(`步骤 0：检测到现有接码号码 ${existingActivation.phoneNumber} 带有验证码/倒计时或已过期，已丢弃并重新预取。`, 'warn', {
            step: 0,
            stepKey: 'prefetch-add-phone-number',
          });
          await setState({
            currentPhoneActivation: null,
            currentPhoneVerificationCode: '',
            currentPhoneVerificationCountdownEndsAt: 0,
            currentPhoneVerificationCountdownWindowIndex: 0,
            currentPhoneVerificationCountdownWindowTotal: 0,
          });
          return executeStep0({
            ...currentState,
            currentPhoneActivation: null,
            currentPhoneVerificationCode: '',
            currentPhoneVerificationCountdownEndsAt: 0,
            currentPhoneVerificationCountdownWindowIndex: 0,
            currentPhoneVerificationCountdownWindowTotal: 0,
          });
        }
        await clearRetryState('步骤 0：已找到可用的预取号码，清理待重试计划。');
        await addLog(`步骤 0：当前已存在接码号码 ${existingActivation.phoneNumber}，无需重新预取。`, 'info', {
          step: 0,
          stepKey: 'prefetch-add-phone-number',
        });
        await completeStepFromBackground(0, {});
        return existingActivation;
      }

      try {
        const blockedCountryIds = Array.isArray(currentState.step0PhoneBlockedCountryIds)
          ? currentState.step0PhoneBlockedCountryIds
          : [];
        const countryPriceFloorByCountryId = (
          currentState.step0PhoneCountryPriceFloorByCountryId
          && typeof currentState.step0PhoneCountryPriceFloorByCountryId === 'object'
          && !Array.isArray(currentState.step0PhoneCountryPriceFloorByCountryId)
        )
          ? currentState.step0PhoneCountryPriceFloorByCountryId
          : {};
        if (blockedCountryIds.length || Object.keys(countryPriceFloorByCountryId).length) {
          await addLog(
            `步骤 0：已带入上次步骤 9 的收码失败学习结果（跳过国家 ${blockedCountryIds.length} 个，提价国家 ${Object.keys(countryPriceFloorByCountryId).length} 个）。`,
            'info',
            {
              step: 0,
              stepKey: 'prefetch-add-phone-number',
            }
          );
        }
        await addLog(`步骤 0：正在预取接码号码（第 ${cycle} 轮，HeroSMS 无号时每 30 秒通过 chrome.alarms 持续重试）...`, 'info', {
          step: 0,
          stepKey: 'prefetch-add-phone-number',
        });
        const activation = await phoneVerificationHelpers.prepareAddPhoneActivation(currentState, {
          blockedCountryIds,
          countryPriceFloorByCountryId,
        });
        if (blockedCountryIds.length || Object.keys(countryPriceFloorByCountryId).length) {
          await setState({
            step0PhoneBlockedCountryIds: [],
            step0PhoneCountryPriceFloorByCountryId: {},
          });
        }
        await clearRetryState('步骤 0：预取接码号码成功，清理待重试计划。');
        await completeStepFromBackground(0, {});
        return activation;
      } catch (error) {
        const message = String(error?.message || error || '');
        const nextAttempt = cycle + 1;
        const retryAt = Date.now() + STEP0_RETRY_DELAY_MS;
        await addLog(`步骤 0：预取接码号码失败（第 ${cycle} 轮）。${message}`, 'warn', {
          step: 0,
          stepKey: 'prefetch-add-phone-number',
        });
        await setState({
          [STEP0_PREFETCH_RETRY_STATE_KEY]: {
            attempt: nextAttempt,
            retryAt,
            lastError: message,
          },
        });
        if (typeof ensureStep0PrefetchRetryAlarm === 'function') {
          await ensureStep0PrefetchRetryAlarm(retryAt);
        }
        await addLog(`步骤 0：${Math.ceil(STEP0_RETRY_DELAY_MS / 1000)} 秒后通过 chrome.alarms 继续预取（第 ${nextAttempt} 轮）。`, 'warn', {
          step: 0,
          stepKey: 'prefetch-add-phone-number',
        });
        return null;
      }
    }

    return { executeStep0, isLongWaitActiveFor };
  }

  return { createPrefetchAddPhoneNumberExecutor };
});
