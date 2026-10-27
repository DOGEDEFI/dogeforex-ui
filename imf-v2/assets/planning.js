(() => {
  'use strict';
  const codes = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CNY', 'BRL', 'PKR', 'BDT', 'INR', 'NGN'];
  const decimal = /^\d+(\.\d+)?$/;
  const address = /^0x[a-fA-F0-9]{40}$/;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function estimate(values) {
    const gross = Number(values.gross);
    const reserve = gross * Number(values.reserve) / 100;
    const fee = gross * Number(values.fee) / 100;
    return { gross, reserve, fee, net: gross - reserve - fee };
  }

  function checkAmount(value, maximum = 1e12, allowZero = false) {
    if (typeof value !== 'string' || !decimal.test(value)) throw new Error('Use ordinary decimal notation without exponents or signs');
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0) || amount > maximum) throw new Error(`Amount must be ${allowZero ? 'nonnegative' : 'greater than zero'} and at most ${maximum}`);
    return value;
  }

  function checkAddress(value, label = 'Address') {
    if (typeof value !== 'string' || !address.test(value)) throw new Error(`${label} must be a 20-byte 0x address`);
    return value;
  }

  function legacyPlan(values) {
    const project = typeof values.project === 'string' ? values.project.trim() : '';
    if (!project || project.length > 80) throw new Error('Enter a project name of at most 80 characters');
    checkAddress(values.token, 'Collateral token');
    if (!codes.includes(values.currency)) throw new Error('Unknown currency');
    checkAmount(values.collateral);
    checkAmount(values.gross);
    checkAmount(values.reserve, 99.999999, true);
    checkAmount(values.fee, 99.999999, true);
    if (Number(values.reserve) + Number(values.fee) >= 100) throw new Error('Teaching reserve and fee must total less than 100%');
    return {
      schema: 'imf.position-plan.v1',
      status: 'local-draft',
      executionEnabled: false,
      project,
      collateral: { tokenAddress: values.token, amount: values.collateral },
      currency: values.currency,
      assumptions: { grossMint: values.gross, reservePercent: values.reserve, upfrontFeePercent: values.fee },
      illustrativeResult: estimate(values),
      excludedCosts: ['opening fee', 'gas', 'DEX costs'],
      nextAction: 'Retrieve verified V2 terms and eligibility before preparing transactions',
    };
  }

  function validateLegacyPlan(plan) {
    if (!plan || plan.schema !== 'imf.position-plan.v1' || plan.status !== 'local-draft' || plan.executionEnabled !== false) throw new Error('Not a non-executable IMF legacy plan');
    const result = legacyPlan({
      project: plan.project,
      token: plan.collateral?.tokenAddress,
      collateral: plan.collateral?.amount,
      currency: plan.currency,
      gross: plan.assumptions?.grossMint,
      reserve: plan.assumptions?.reservePercent,
      fee: plan.assumptions?.upfrontFeePercent,
    });
    const actual = plan.illustrativeResult;
    for (const key of ['gross', 'reserve', 'fee', 'net']) {
      if (typeof actual?.[key] !== 'number' || !Number.isFinite(actual[key]) || Math.abs(actual[key] - result.illustrativeResult[key]) > 1e-7) throw new Error('Legacy plan arithmetic does not match its inputs');
    }
    return result;
  }

  function inspectJson(value, depth = 0) {
    if (depth > 16) throw new Error('JSON nesting is too deep');
    if (typeof value === 'string' && value.length > 100000) throw new Error('JSON string is too long');
    if (Array.isArray(value)) {
      if (value.length > 1000) throw new Error('JSON array is too large');
      value.forEach((entry) => inspectJson(entry, depth + 1));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        const normalized = key.toLowerCase().replace(/[-_]/g, '');
        if (['__proto__', 'constructor', 'prototype', 'privatekey', 'mnemonic', 'secret', 'password', 'seedphrase', 'apikey'].includes(normalized)) throw new Error('Unsupported JSON field');
        inspectJson(entry, depth + 1);
      }
    }
  }

  function keys(value, expected, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    const actual = Object.keys(value).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(`${label} has missing or unexpected fields`);
  }

  function integer(value, label, maximum = (1n << 256n) - 1n) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a canonical integer string`);
    const parsed = BigInt(value);
    if (parsed > maximum) throw new Error(`${label} exceeds its integer range`);
    return parsed;
  }

  function rawAmount(value, label) {
    keys(value, ['decimal', 'decimals', 'raw'], label);
    if (typeof value.decimal !== 'string' || !decimal.test(value.decimal)) throw new Error(`${label} must use plain decimal notation`);
    const decimals = Number(integer(value.decimals, `${label} decimals`, 255n));
    const fraction = value.decimal.split('.')[1] || '';
    if (fraction.length > decimals) throw new Error(`${label} exceeds its decimal precision`);
    const [whole] = value.decimal.split('.');
    const expected = BigInt(`${whole}${fraction}${'0'.repeat(decimals - fraction.length)}`);
    if (expected > (1n << 256n) - 1n) throw new Error(`${label} exceeds uint256`);
    if (integer(value.raw, `${label} raw`) !== expected) throw new Error(`${label} decimal and raw values disagree`);
    return expected;
  }

  function optionalAddress(value, label, required = false) {
    if (!required && value === '') return;
    checkAddress(value, label);
  }

  function validateActionInputs(action, inputs) {
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('V2 inputs must be an object');
    for (const required of ['project', 'currency', 'account']) {
      if (!own(inputs, required)) throw new Error(`V2 common inputs are missing ${required}`);
    }
    optionalAddress(inputs.account, 'Account');
    if (action === 'new') {
      keys(inputs, ['project', 'currency', 'account', 'token', 'minimumCollateral', 'initialCollateral', 'mintingMaximum', 'initPeriodSeconds', 'durationSeconds', 'challengePeriodSeconds', 'riskPremiumPPM', 'reserveContributionPPM', 'liquidationPrice', 'plannedGrossMint'], 'V2 new-position inputs');
      keys(inputs.token, ['address', 'decimals'], 'Collateral identity');
      checkAddress(inputs.token.address, 'Collateral token');
      const decimals = Number(integer(inputs.token.decimals, 'Collateral decimals', 24n));
      const minimum = rawAmount(inputs.minimumCollateral, 'Minimum collateral');
      const initial = rawAmount(inputs.initialCollateral, 'Initial collateral');
      const maximum = rawAmount(inputs.mintingMaximum, 'Minting maximum');
      const gross = rawAmount(inputs.plannedGrossMint, 'Planned gross mint');
      const price = rawAmount(inputs.liquidationPrice, 'Liquidation price');
      if (inputs.minimumCollateral.decimals !== inputs.token.decimals || inputs.initialCollateral.decimals !== inputs.token.decimals || inputs.mintingMaximum.decimals !== '18' || inputs.plannedGrossMint.decimals !== '18') throw new Error('Collateral/local decimal units disagree');
      if (inputs.liquidationPrice.decimals !== String(36 - decimals)) throw new Error('Liquidation price decimals must be 36 − collateral decimals');
      integer(inputs.initPeriodSeconds, 'Initialization', 1099511627775n);
      integer(inputs.durationSeconds, 'Duration', 1099511627775n);
      integer(inputs.challengePeriodSeconds, 'Challenge period', 1099511627775n);
      const risk = integer(inputs.riskPremiumPPM, 'Risk premium', 1000000n);
      const reserve = integer(inputs.reserveContributionPPM, 'Reserve contribution', 1000000n);
      if (BigInt(inputs.initPeriodSeconds) < 259200n) throw new Error('Initialization must be at least three days');
      if (reserve < 20000n) throw new Error('Reserve contribution must be at least 20000 PPM');
      if (initial < minimum) throw new Error('Initial collateral is below minimum collateral');
      if (gross <= 0n) throw new Error('Planned gross mint must be positive');
      if (gross > maximum) throw new Error('Planned gross mint exceeds minting maximum');
      const minimumValue = minimum * price;
      const initialValue = initial * price;
      if (minimumValue < 3500n * 10n ** 36n) throw new Error('Minimum collateral × price is below the 3500-unit floor');
      if (minimumValue > maximum * 10n ** 18n) throw new Error('Minimum collateral × price exceeds minting maximum');
      if (maximum * 10n ** 18n > (1n << 256n) - 1n || initialValue > (1n << 256n) - 1n || gross * 10n ** 18n > (1n << 256n) - 1n) throw new Error('Opening value exceeds uint256');
      if (initialValue < gross * 10n ** 18n) throw new Error('Initial collateral does not back the planned gross mint');
      if (risk > 1000000n) throw new Error('Risk premium exceeds 100%');
      return;
    }
    if (action === 'clone') {
      keys(inputs, ['project', 'currency', 'account', 'parent', 'initialCollateral', 'initialMint', 'expiration', 'childOwner'], 'V2 clone inputs');
      checkAddress(inputs.parent, 'Parent position');
      keys(inputs.initialCollateral, ['decimal', 'decimals', 'raw'], 'Clone collateral');
      if (inputs.initialCollateral.decimals === null || inputs.initialCollateral.raw === null) {
        if (inputs.initialCollateral.decimals !== null || inputs.initialCollateral.raw !== null || !decimal.test(inputs.initialCollateral.decimal)) throw new Error('Unscaled clone collateral is inconsistent');
      } else {
        rawAmount(inputs.initialCollateral, 'Clone collateral');
      }
      if (rawAmount(inputs.initialMint, 'Initial clone mint') <= 0n) throw new Error('Initial clone mint must be positive');
      keys(inputs.expiration, ['local', 'unix', 'browserTimeZone'], 'Clone expiration');
      integer(inputs.expiration.unix, 'Clone expiration', 1099511627775n);
      if (typeof inputs.expiration.local !== 'string' || typeof inputs.expiration.browserTimeZone !== 'string') throw new Error('Clone expiration needs its original local input and timezone');
      optionalAddress(inputs.childOwner, 'Child owner');
      return;
    }
    keys(inputs, ['project', 'currency', 'account', 'position', 'grossMint', 'recipient'], 'V2 existing-mint inputs');
    checkAddress(inputs.position, 'Position');
    if (rawAmount(inputs.grossMint, 'Existing-position gross mint') <= 0n) throw new Error('Gross mint must be positive');
    optionalAddress(inputs.recipient, 'Recipient');
  }

  function validateV2Plan(plan) {
    if (!plan || plan.schema !== 'imf.v2-read-plan.v1' || plan.executionEnabled !== false || plan.simulationStatus !== 'not-run' || plan.signatureStatus !== 'not-requested') throw new Error('Not a read-only IMF V2 plan');
    if (!['local-read-plan', 'read-backed-plan'].includes(plan.status)) throw new Error('Unknown V2 plan status');
    if (!['new', 'clone', 'mint'].includes(plan.action)) throw new Error('Unknown V2 action');
    if (typeof plan.project !== 'string' || !plan.project.trim() || plan.project.trim().length > 80) throw new Error('Invalid project name');
    if (!codes.includes(plan.currency)) throw new Error('Unknown currency');
    if (plan.chainId !== null && (typeof plan.chainId !== 'string' || !/^[1-9]\d*$/.test(plan.chainId))) throw new Error('Invalid or missing chain identity');
    if (!plan.evidence || typeof plan.evidence !== 'object') throw new Error('Missing evidence boundary');
    if (plan.status === 'read-backed-plan' && (plan.evidence.registry?.status !== 'verified-read' || !plan.evidence.state || !plan.evidence.quote)) throw new Error('Read-backed status requires verified registry, state and quote evidence');
    inspectJson(plan);
    validateActionInputs(plan.action, plan.inputs);
    if (plan.inputs.project !== plan.project || plan.inputs.currency !== plan.currency) throw new Error('Plan and input identity differ');
    const clean = { ...plan };
    delete clean.id;
    delete clean.savedAt;
    return JSON.parse(JSON.stringify(clean));
  }

  function validatePlan(plan) {
    if (plan?.schema === 'imf.position-plan.v1') return validateLegacyPlan(plan);
    if (plan?.schema === 'imf.v2-read-plan.v1') return validateV2Plan(plan);
    throw new Error('Unsupported planning schema');
  }

  class DraftStore {
    constructor(storage, key = 'imf-position-drafts-v2') {
      this.storage = storage;
      this.key = key;
    }

    list() {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return [];
      if (raw.length > 1000000) throw new Error('Draft storage exceeds the size limit');
      const plans = JSON.parse(raw);
      if (!Array.isArray(plans) || plans.length > 50) throw new Error('Invalid draft collection');
      return plans.map((plan) => {
        if (typeof plan.id !== 'string' || plan.id.length > 100 || typeof plan.savedAt !== 'string') throw new Error('Invalid draft identity');
        return { ...validatePlan(plan), id: plan.id, savedAt: plan.savedAt };
      });
    }

    save(plan) {
      const drafts = this.list();
      if (drafts.length >= 50) throw new Error('Draft limit reached; export or delete a draft first');
      const entry = { ...validatePlan(plan), id: crypto.randomUUID(), savedAt: new Date().toISOString() };
      drafts.push(entry);
      this.storage.setItem(this.key, JSON.stringify(drafts));
      return entry;
    }

    remove(id) {
      const drafts = this.list();
      const remaining = drafts.filter((plan) => plan.id !== id);
      if (remaining.length === drafts.length) throw new Error('Draft not found');
      this.storage.setItem(this.key, JSON.stringify(remaining));
    }

    backup() {
      return { schema: 'imf.draft-backup.v1', plans: this.list() };
    }

    restore(raw) {
      inspectJson(raw);
      if (!raw || raw.schema !== 'imf.draft-backup.v1' || !Array.isArray(raw.plans) || raw.plans.length > 50) throw new Error('Invalid draft backup');
      const existing = this.list();
      const merged = [...existing];
      for (const entry of raw.plans) {
        const clean = validatePlan(entry);
        if (merged.some((plan) => JSON.stringify(validatePlan(plan)) === JSON.stringify(clean))) continue;
        if (merged.length >= 50) throw new Error('Draft limit reached');
        merged.push({ ...clean, id: crypto.randomUUID(), savedAt: new Date().toISOString() });
      }
      this.storage.setItem(this.key, JSON.stringify(merged));
      return merged.length - existing.length;
    }
  }

  function download(plan, filename) {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.IMF_PLANNING = { codes, decimal, address, own, estimate, legacyPlan, validateLegacyPlan, validateV2Plan, validatePlan, inspectJson, DraftStore, download };
})();
