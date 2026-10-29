(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  let v2;
  let hooks;
  let wallet;
  let prepared = null;
  let discovery = null;
  let discoveryBusy = false;

  const text = (selector, value) => { $(selector).textContent = value; };
  const money = (value, decimals = 18) => window.IMF_V2.formatDecimal(BigInt(value), decimals);
  const field = (form, name) => {
    const input = form.elements.namedItem(name);
    if (!input) throw new Error(`Missing ${name} input`);
    return input;
  };
  const value = (form, name) => field(form, name).value.trim();
  const checked = (form, name) => field(form, name).checked;
  const address = (input, label) => {
    try { return window.IMF_V2.getAddress(input); } catch { throw new Error(`${label} must be a valid address`); }
  };
  const optionalAddress = (input, fallback, label) => input ? address(input, label) : fallback;
  const amount = (input, decimals, label) => {
    try { return window.IMF_V2.parseDecimal(input, decimals); } catch { throw new Error(`${label} must be a nonnegative decimal with at most ${decimals} fractional digits`); }
  };
  const integer = (input, label) => amount(input, 0, label);
  const account = () => {
    const current = wallet.getState().account;
    if (!current) throw new Error('Connect MetaMask before preparing a transaction');
    return current;
  };
  const addresses = (input, label) => input.split(/[\s,]+/).filter(Boolean).map((entry) => address(entry, label));
  const sameAddress = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
  const helperAddresses = (input) => {
    const result = addresses(input, 'Helper');
    for (let index = 0; index < result.length; index += 1) {
      if (sameAddress(result[index], account())) throw new Error('Helpers must not include the connected caller');
      if (index > 0 && BigInt(result[index - 1]) >= BigInt(result[index])) throw new Error('Helpers must be strictly address-sorted and unique');
    }
    return result;
  };
  const expiration = (input) => {
    const milliseconds = new Date(input).getTime();
    if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) throw new Error('Expiration must be a valid whole-second date');
    return BigInt(milliseconds / 1000);
  };

  async function contextKey(operation, descriptor) {
    const serialized = JSON.stringify({ operation, descriptor }, (_, entry) => typeof entry === 'bigint' ? entry.toString() : entry);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function descriptor(operation, target, args, review, approval = null) {
    return { operation, target, args, review, approval };
  }

  async function clientFor(form) {
    const code = form.dataset.currency === 'ecosystem' ? $('#ecosystem-currency').value : $('#v2-currency').value;
    const client = await v2.clientFor(code, { fresh: true });
    return { client, code, symbol: client.instance.symbol };
  }

  async function position(client, input) {
    const candidate = input || $('#manage-load-form').elements.namedItem('managePosition').value.trim();
    const snapshot = await client.positionState(address(candidate, 'Position'));
    if (!snapshot.hubMatchesRegistry || !snapshot.tokenMatchesRegistry) throw new Error('Position does not belong to the selected verified currency system');
    return snapshot;
  }

  async function localAllowance(client, caller, spender, needed, review) {
    if (needed <= 0n) return null;
    const allowance = await client.token.allowance(caller, spender);
    if (allowance === 0n || allowance >= needed) return null;
    return { token: client.instance.token, spender, amount: needed, symbol: client.instance.symbol, decimals: 18, reason: 'A small positive local-token allowance overrides the protocol allowance shortcut. Replace it with the exact required amount.' };
  }

  async function createPosition(form) {
    const snapshot = await v2.readAction();
    if (!snapshot) throw new Error('Review the current position terms and resolve any errors first');
    const kind = form.elements.namedItem('action').value;
    const { client } = await clientFor(form);
    const caller = account();
    if (kind === 'new') {
      if (!sameAddress(snapshot.caller, caller)) throw new Error('The read account must match the connected wallet');
      const terms = snapshot.terms;
      return descriptor('hub.openPosition', client.instance.mintingHub, {
        collateral: snapshot.collateral, minCollateral: terms.minCollateral, initialCollateral: terms.initialCollateral,
        mintingMaximum: terms.mintingMaximum, initPeriodSeconds: terms.initPeriodSeconds, expirationSeconds: terms.durationSeconds,
        challengeSeconds: terms.challengePeriodSeconds, riskPremiumPPM: terms.riskPremiumPPM, liquidationPrice: terms.liquidationPrice, reservePPM: terms.reserveContributionPPM,
      }, [
        ['Initial collateral', `${money(terms.initialCollateral, terms.collateralDecimals)} ${snapshot.collateralSymbol}`],
        ['Irrevocable opening fee', `${money(snapshot.funding.openingFee)} ${client.instance.symbol}`],
        ['Minting', 'None in this transaction. A separate mint is possible after initialization and the veto window.'],
        ['Assumed start / expiration', `${terms.initPeriodSeconds} seconds initialization; ${terms.durationSeconds} seconds duration`],
      ], { token: snapshot.collateral, spender: client.instance.mintingHub, amount: terms.initialCollateral, symbol: snapshot.collateralSymbol, decimals: terms.collateralDecimals });
    }
    if (kind === 'clone') {
      const params = snapshot;
      if (!sameAddress(params.collateralFunder, caller)) throw new Error('The collateral funder must match the connected wallet');
      return descriptor('hub.clone', client.instance.mintingHub, {
        owner: params.childOwner, parent: params.parent.address, initialCollateral: params.initialCollateral,
        initialMint: params.initialMint, expiration: params.expiration,
      }, [
        ['Parent', params.parent.address], ['Child owner', params.childOwner],
        ['Initial collateral', `${money(params.initialCollateral, params.parent.collateral.decimals)} ${params.parent.collateral.symbol}`],
        ['Initial gross mint', `${money(params.initialMint)} ${client.instance.symbol}`],
        ['Absolute expiration', new Date(Number(params.expiration) * 1000).toISOString()],
      ], { token: params.parent.collateral.address, spender: client.instance.mintingHub, amount: params.initialCollateral, symbol: params.parent.collateral.symbol, decimals: params.parent.collateral.decimals });
    }
    if (!sameAddress(snapshot.caller, caller)) throw new Error('The position caller must match the connected wallet');
    return descriptor('position.mint', snapshot.address, {
      target: snapshot.recipient, amount: snapshot.quote.grossAmount,
    }, [
      ['Position', snapshot.address], ['Recipient', snapshot.recipient],
      ['Gross debt', `${money(snapshot.quote.grossAmount)} ${client.instance.symbol}`],
      ['Estimated usable proceeds', `${money(snapshot.quote.usableAmount)} ${client.instance.symbol}`],
      ['Reserve / fee', `${window.IMF_V2.formatPPM(snapshot.quote.reservePPM)}% / ${window.IMF_V2.formatPPM(snapshot.quote.feePPM)}%`],
    ]);
  }

  async function repay(form, close = false) {
    const { client } = await clientFor(form);
    const caller = account();
    const current = await position(client, value(form, 'position'));
    const full = close || checked(form, 'full');
    const requested = full ? undefined : amount(value(form, 'amount'), 18, 'Repayment');
    const snapshot = await client.repaymentSnapshot(current.address, { caller, ...(requested === undefined ? {} : { amount: requested }) });
    const walletAmount = full ? snapshot.fullCandidate.walletAmount : snapshot.quote.walletAmount;
    if (walletAmount <= 0n) throw new Error('There is no debt to repay');
    const review = [
      ['Position', current.address], ['Wallet currency paid', `${money(walletAmount)} ${client.instance.symbol}`],
      ['Expected gross debt reduction', `${money(full ? snapshot.fullCandidate.grossDebtReduction : snapshot.quote.grossDebtReduction)} ${client.instance.symbol}`],
      ['Current gross debt', `${money(current.minted)} ${client.instance.symbol}`],
      ['Next step', close ? 'After confirmation, use Withdraw all collateral to close. Nothing is sent automatically.' : 'Repayment does not itself withdraw collateral or close the position.'],
    ];
    return descriptor('position.repay', current.address, { amount: walletAmount }, review,
      await localAllowance(client, caller, current.address, walletAmount, review));
  }

  async function withdrawAll(form) {
    const { client } = await clientFor(form);
    const current = await position(client, value(form, 'position'));
    if (current.minted > 0n) return repay(form, true);
    return descriptor('position.withdrawCollateral', current.address, { target: account(), amount: current.collateral.balance }, [
      ['Position', current.address], ['Recipient', account()],
      ['Withdraw all collateral', `${money(current.collateral.balance, current.collateral.decimals)} ${current.collateral.symbol}`],
      ['Closure', 'Withdrawing below the minimum normally closes the position. This cannot be undone.'],
    ]);
  }

  async function operation(form) {
    const name = form.id === 'v2-position-form' ? 'position.create' : form.dataset.operation;
    if (name === 'position.create') return createPosition(form);
    if (name === 'position.repay') return repay(form);
    if (name === 'position.close') return withdrawAll(form);
    const { client, symbol } = await clientFor(form);
    const caller = account();
    if (name.startsWith('position.') || name.startsWith('roller.') || name === 'hub.challenge' || name === 'hub.buyExpiredCollateral') {
      const current = await position(client, value(form, 'position'));
      if (name === 'position.mint') {
        const grossAmount = amount(value(form, 'amount'), 18, 'Gross mint');
        const recipient = optionalAddress(value(form, 'recipient'), caller, 'Recipient');
        const quote = await client.positionSnapshot(current.address, { caller, recipient, quote: { grossAmount } });
        return descriptor(name, current.address, { target: recipient, amount: grossAmount }, [['Recipient', recipient], ['Gross debt', `${money(grossAmount)} ${symbol}`], ['Estimated usable proceeds', `${money(quote.quote.usableAmount)} ${symbol}`]]);
      }
      if (name === 'position.withdrawCollateral') {
        const collateralAmount = amount(value(form, 'amount'), current.collateral.decimals, 'Collateral');
        const recipient = optionalAddress(value(form, 'recipient'), caller, 'Recipient');
        const quote = await client.withdrawalSnapshot(current.address, { caller, amount: collateralAmount });
        return descriptor(name, current.address, { target: recipient, amount: collateralAmount }, [['Recipient', recipient], ['Collateral', `${money(collateralAmount, current.collateral.decimals)} ${current.collateral.symbol}`], ['Would close', String(quote.wouldClose)], ['Read eligibility', String(quote.eligible)]]);
      }
      if (name === 'position.adjustPrice') {
        const newPrice = window.IMF_V2.parseLiquidationPrice(value(form, 'price'), current.collateral.decimals);
        return descriptor(name, current.address, { newPrice }, [['Current price', money(current.price, current.priceDecimals)], ['New price', money(newPrice, current.priceDecimals)], ['Cooldown', 'Raising the price starts a three-day mint/withdrawal cooldown.']]);
      }
      if (name === 'position.adjust') {
        const newMinted = amount(value(form, 'newMinted'), 18, 'New gross debt');
        const newCollateral = amount(value(form, 'newCollateral'), current.collateral.decimals, 'New collateral');
        const newPrice = window.IMF_V2.parseLiquidationPrice(value(form, 'newPrice'), current.collateral.decimals);
        return descriptor(name, current.address, { newMinted, newCollateral, newPrice }, [['Absolute new debt', `${money(newMinted)} ${symbol}`], ['Absolute new collateral', `${money(newCollateral, current.collateral.decimals)} ${current.collateral.symbol}`], ['Absolute new price', money(newPrice, current.priceDecimals)], ['Effect', 'Combined deposit, repayment, withdrawal, mint and price change. Simulation is required.']], newCollateral > current.collateral.balance ? { token: current.collateral.address, spender: current.address, amount: newCollateral - current.collateral.balance, symbol: current.collateral.symbol, decimals: current.collateral.decimals } : null);
      }
      if (name === 'position.transferOwnership') {
        const newOwner = address(value(form, 'newOwner'), 'New owner');
        return descriptor(name, current.address, { newOwner }, [['Current owner', current.owner], ['New owner', newOwner], ['Irreversible without new owner', 'The connected wallet will lose owner permissions.']]);
      }
      if (name === 'position.withdraw') {
        const token = address(value(form, 'token'), 'Token');
        if (token === current.collateral.address) throw new Error('Use the collateral withdrawal journey for collateral');
        const decimals = Number(await window.IMF_V2.attachV2ERC20(token, client.provider).decimals());
        const tokenAmount = amount(value(form, 'amount'), decimals, 'Token amount');
        const recipient = optionalAddress(value(form, 'recipient'), caller, 'Recipient');
        return descriptor(name, current.address, { token, target: recipient, amount: tokenAmount }, [['Token', token], ['Recipient', recipient], ['Amount', money(tokenAmount, decimals)]]);
      }
      if (name === 'position.deny') {
        const helpers = helperAddresses(value(form, 'helpers'));
        const message = value(form, 'message');
        return descriptor(name, current.address, { helpers, message }, [['Position', current.address], ['Veto deadline', new Date(Number(current.start) * 1000).toISOString()], ['Helpers', helpers.join(', ') || 'None'], ['Message', message], ['Irreversible', 'Qualified governance denial closes the proposed position.']]);
      }
      if (name === 'roller.roll') {
        const target = await position(client, value(form, 'target'));
        if (target.collateral.address !== current.collateral.address) throw new Error('Rolled positions must use the same collateral');
        const repayAmount = amount(value(form, 'repay'), 18, 'Wallet repayment excluding reserve');
        const collateralWithdraw = amount(value(form, 'collateralWithdraw'), current.collateral.decimals, 'Collateral withdrawal');
        const mintAmount = amount(value(form, 'mint'), 18, 'Gross mint');
        const collateralDeposit = amount(value(form, 'collateralDeposit'), current.collateral.decimals, 'Collateral deposit');
        const rollExpiration = expiration(value(form, 'expiration'));
        return descriptor(name, client.instance.positionRoller, { source: current.address, repay: repayAmount, collateralWithdraw, targetPosition: target.address, mint: mintAmount, collateralDeposit, expiration: rollExpiration }, [['Source', current.address], ['Target / clone parent', target.address], ['Wallet repayment excluding reserve', `${money(repayAmount)} ${symbol}`], ['Collateral withdrawal', `${money(collateralWithdraw, current.collateral.decimals)} ${current.collateral.symbol}`], ['Gross target mint', `${money(mintAmount)} ${symbol}`], ['Collateral deposit', `${money(collateralDeposit, current.collateral.decimals)} ${current.collateral.symbol}`], ['Absolute expiration', new Date(Number(rollExpiration) * 1000).toISOString()], ['Expert operation', 'Manual parameters are not independent quotes; the entire roll must pass exact simulation.']], { token: current.collateral.address, spender: client.instance.positionRoller, amount: collateralDeposit, symbol: current.collateral.symbol, decimals: current.collateral.decimals });
      }
      if (name === 'roller.rollFully' || name === 'roller.rollFullyWithExpiration') {
        const target = await position(client, value(form, 'target'));
        if (target.collateral.address !== current.collateral.address) throw new Error('Rolled positions must use the same collateral');
        const args = { source: current.address, targetPosition: target.address };
        const customExpiration = value(form, 'expiration');
        const operationName = customExpiration ? 'roller.rollFullyWithExpiration' : 'roller.rollFully';
        if (customExpiration) args.expiration = expiration(customExpiration);
        return descriptor(operationName, client.instance.positionRoller, args, [['Source', current.address], ['Target / clone parent', target.address], ['Collateral allowance', `${money(current.collateral.balance, current.collateral.decimals)} ${current.collateral.symbol} to the roller`], ['Shortfall', 'Wallet currency may cover repayment shortfalls and new fees. Simulation shows only the current state.']], { token: current.collateral.address, spender: client.instance.positionRoller, amount: current.collateral.balance, symbol: current.collateral.symbol, decimals: current.collateral.decimals });
      }
      if (name === 'hub.challenge') {
        const size = amount(value(form, 'amount'), current.collateral.decimals, 'Challenge size');
        const minimumPrice = value(form, 'minimumPrice') ? window.IMF_V2.parseLiquidationPrice(value(form, 'minimumPrice'), current.collateral.decimals) : current.price;
        return descriptor(name, client.instance.mintingHub, { position: current.address, collateralAmount: size, minimumPrice }, [['Position', current.address], ['Collateral challenged', `${money(size, current.collateral.decimals)} ${current.collateral.symbol}`], ['Minimum liquidation price', money(minimumPrice, current.priceDecimals)], ['Next step', 'The challenge index comes from the confirmed ChallengeStarted event.']], { token: current.collateral.address, spender: client.instance.mintingHub, amount: size, symbol: current.collateral.symbol, decimals: current.collateral.decimals });
      }
      if (name === 'hub.buyExpiredCollateral') {
        const upToAmount = amount(value(form, 'amount'), current.collateral.decimals, 'Maximum collateral');
        const cost = current.expiredPurchasePrice * upToAmount / 10n ** 18n;
        return descriptor(name, client.instance.mintingHub, { position: current.address, upToAmount }, [['Position', current.address], ['Maximum collateral', `${money(upToAmount, current.collateral.decimals)} ${current.collateral.symbol}`], ['Current maximum cost', `${money(cost)} ${symbol}`], ['Separate mechanism', 'Expired purchase price is not the ordinary challenge auction price.']], await localAllowance(client, caller, client.instance.mintingHub, cost));
      }
    }
    if (name === 'hub.bid') {
      const index = integer(value(form, 'index'), 'Challenge index');
      const challenge = await client.challengeSnapshot(index);
      if (challenge.empty) throw new Error('This challenge has no remaining collateral');
      const current = await position(client, challenge.position);
      const requested = amount(value(form, 'amount'), current.collateral.decimals, 'Bid size');
      const size = requested < challenge.size ? requested : challenge.size;
      const cost = challenge.currentPrice * size / 10n ** 18n;
      const postpone = checked(form, 'postpone');
      return descriptor(name, client.instance.mintingHub, { challengeNumber: index, size, postponeCollateralReturn: postpone }, [['Challenge index', index.toString()], ['Position', current.address], ['Collateral acquired (up to)', `${money(size, current.collateral.decimals)} ${current.collateral.symbol}`], ['Current currency cost', `${money(cost)} ${symbol}`], ['Phase', challenge.active ? 'Aversion window' : 'Dutch auction / settlement'], ['Postpone challenger collateral return', String(postpone)]], await localAllowance(client, caller, client.instance.mintingHub, cost));
    }
    if (name === 'hub.returnPostponedCollateral') {
      const collateral = address(value(form, 'collateral'), 'Collateral');
      const recipient = optionalAddress(value(form, 'recipient'), caller, 'Recipient');
      const pending = await client.mintingHub.pendingReturns(collateral, caller);
      return descriptor(name, client.instance.mintingHub, { collateral, target: recipient }, [['Pending collateral', money(pending, Number(await window.IMF_V2.attachV2ERC20(collateral, client.provider).decimals()))], ['Recipient', recipient]]);
    }
    return ecosystemOperation(form, name, client, caller);
  }

  async function ecosystemOperation(form, name, client, caller) {
    if (name.startsWith('bridge.')) {
      const sourceDecimals = client.instance.sourceDecimals;
      if (name === 'bridge.mintTo') {
        const sourceAmount = amount(value(form, 'amount'), sourceDecimals, 'Source amount');
        const recipient = optionalAddress(value(form, 'recipient'), caller, 'Recipient');
        const snapshot = await client.bridgeSnapshot({ account: caller, mintSourceAmount: sourceAmount });
        return descriptor(name, client.instance.bridge, { target: recipient, amount: sourceAmount }, [['Source deposit', `${money(sourceAmount, sourceDecimals)} ${snapshot.sourceSymbol}`], ['Nominal local output', `${money(snapshot.mintPlan.localAmount)} ${client.instance.symbol}`], ['Recipient', recipient], ['Test asset', 'tUSDC is not production USDC or reserve backing.']], { token: client.instance.source, spender: client.instance.bridge, amount: sourceAmount, symbol: snapshot.sourceSymbol, decimals: sourceDecimals });
      }
      if (name === 'bridge.payoutCredit') {
        const recipient = optionalAddress(value(form, 'recipient'), caller, 'Credit recipient');
        return descriptor(name, client.instance.bridge, { target: recipient }, [['Credit recipient', recipient], ['Permissionless payout', 'The caller triggers payout; source tokens go to the recipient.']]);
      }
      const requested = amount(value(form, 'amount'), 18, 'Local burn');
      const credit = name === 'bridge.burnAndCredit';
      const recipient = optionalAddress(value(form, 'recipient'), caller, credit ? 'Credit recipient' : 'Recipient');
      const snapshot = await client.bridgeSnapshot({ account: caller, burnLocalAmount: requested, credit });
      const aligned = snapshot.burnPlan.alignedLocalAmount;
      if (aligned === 0n) throw new Error('Amount rounds to zero source units; increase the local amount');
      return descriptor(name, client.instance.bridge, { target: recipient, amount: aligned }, [['Actual local burn', `${money(aligned)} ${client.instance.symbol}`], ['Unburned remainder', `${money(snapshot.burnPlan.remainderLocalAmount)} ${client.instance.symbol}`], [credit ? 'Credit recorded' : 'Source sent', `${money(snapshot.burnPlan.sourceAmount, sourceDecimals)} ${snapshot.sourceSymbol}`], ['Recipient', recipient]], await localAllowance(client, caller, client.instance.bridge, aligned));
    }
    if (name.startsWith('savings.')) {
      if (name === 'savings.refreshMyBalance') return descriptor(name, client.instance.savings, {}, [['Account', caller], ['Effect', 'Refresh and compound currently accrued interest, subject to available system equity.']]);
      if (name === 'savings.refreshBalance') {
        const owner = address(value(form, 'owner'), 'Savings account');
        return descriptor(name, client.instance.savings, { owner }, [['Account refreshed', owner], ['Permissionless refresh', 'The caller pays the transaction fee; interest is credited to the selected account.']]);
      }
      if (name === 'savings.applyChange') return descriptor(name, client.instance.savings, {}, [['Effect', 'Apply a pending savings rate whose application time has arrived.']]);
      if (name === 'savings.proposeChange') {
        const newRatePPM = integer(value(form, 'ratePPM'), 'Rate PPM');
        const helpers = helperAddresses(value(form, 'helpers'));
        return descriptor(name, client.instance.savings, { newRatePPM, helpers }, [['Proposed annual rate', `${window.IMF_V2.formatPPM(newRatePPM)}%`], ['Helpers', helpers.join(', ') || 'None'], ['Application delay', 'Qualified proposal starts the on-chain rate-change window.']]);
      }
      if (name === 'savings.withdraw') {
        const savedAmount = amount(value(form, 'amount'), 18, 'Savings withdrawal');
        const recipient = optionalAddress(value(form, 'recipient'), caller, 'Recipient');
        return descriptor(name, client.instance.savings, { target: recipient, amount: savedAmount }, [['Withdraw from caller', caller], ['Recipient', recipient], ['Maximum amount', `${money(savedAmount)} ${client.instance.symbol}`], ['Lock', 'Withdrawal reverts while the account remains locked.']]);
      }
      const savedAmount = amount(value(form, 'amount'), 18, name === 'savings.adjust' ? 'Target savings' : 'Savings deposit');
      if (name === 'savings.adjust') {
        const snapshot = await client.savingsSnapshot({ account: caller });
        const additional = savedAmount > (snapshot.account?.saved ?? 0n) ? savedAmount - (snapshot.account?.saved ?? 0n) : 0n;
        return descriptor(name, client.instance.savings, { targetAmount: savedAmount }, [['Absolute target savings', `${money(savedAmount)} ${client.instance.symbol}`], ['Effect', 'This can deposit or withdraw after refreshing interest; lock rules still apply.']], await localAllowance(client, caller, client.instance.savings, additional));
      }
      const owner = optionalAddress(value(form, 'owner'), caller, 'Savings owner');
      return descriptor('savings.saveFor', client.instance.savings, { owner, amount: savedAmount }, [['Deposit from', caller], ['Savings owner', owner], ['Amount', `${money(savedAmount)} ${client.instance.symbol}`], ['Lock', 'New deposits receive a weighted lock of up to three days; adding funds can extend the average lock.']], await localAllowance(client, caller, client.instance.savings, savedAmount));
    }
    if (name === 'equity.invest' || name === 'equity.redeemExpected') {
      const investment = name === 'equity.invest' ? amount(value(form, 'amount'), 18, 'Investment') : 0n;
      const shares = name === 'equity.redeemExpected' ? amount(value(form, 'shares'), 18, 'Shares') : 0n;
      const snapshot = await client.equitySnapshot({ account: caller, investment, redemptionShares: shares });
      if (name === 'equity.invest') {
        const minimumShares = amount(value(form, 'minimum'), 18, 'Minimum shares');
        if (minimumShares <= 0n) throw new Error('Set a positive minimum share output');
        return descriptor(name, client.instance.equity, { amount: investment, expectedShares: minimumShares }, [['Investment', `${money(investment)} ${client.instance.symbol}`], ['Current quoted shares', `${money(snapshot.quotedShares)} ${client.instance.symbol}`], ['Minimum accepted shares', `${money(minimumShares)} ${client.instance.symbol}`], ['Native mechanism', 'Investment mints pool shares; it is not a DEX order.']], await localAllowance(client, caller, client.instance.equity, investment));
      }
      const minimumProceeds = amount(value(form, 'minimum'), 18, 'Minimum proceeds');
      const recipient = optionalAddress(value(form, 'recipient'), caller, 'Recipient');
      if (minimumProceeds <= 0n) throw new Error('Set a positive minimum currency output');
      return descriptor(name, client.instance.equity, { target: recipient, shares, expectedProceeds: minimumProceeds }, [['Shares redeemed', `${money(shares)} ${client.instance.symbol}`], ['Current quoted proceeds', `${money(snapshot.quotedProceeds)} ${client.instance.symbol}`], ['Minimum accepted proceeds', `${money(minimumProceeds)} ${client.instance.symbol}`], ['Recipient', recipient], ['Reserve redemption', 'Holding rules apply and more than one share must remain outstanding.']]);
    }
    if (name === 'equity.delegateVoteTo') {
      const delegate = value(form, 'delegate') ? address(value(form, 'delegate'), 'Delegate') : window.IMF_V2.ZeroAddress;
      return descriptor(name, client.instance.equity, { delegate }, [['Delegate', delegate], ['Effect', delegate === window.IMF_V2.ZeroAddress ? 'Clear delegation.' : 'Add your time-weighted votes to the delegate without removing your own votes.']]);
    }
    if (name === 'equity.kamikaze') {
      const targets = addresses(value(form, 'targets'), 'Target');
      const votesToDestroy = integer(value(form, 'votes'), 'Votes to destroy');
      return descriptor(name, client.instance.equity, { targets, votesToDestroy }, [['Targets', targets.join(', ')], ['Maximum caller votes sacrificed', votesToDestroy.toString()], ['Irreversible', 'This aggressively destroys both caller and target voting power.']]);
    }
    if (name === 'equity.restructureCapTable') {
      const helpers = helperAddresses(value(form, 'helpers'));
      const targets = addresses(value(form, 'targets'), 'Address to wipe');
      return descriptor(name, client.instance.equity, { helpers, addressesToWipe: targets }, [['Helpers', helpers.join(', ') || 'None'], ['All shares burned for', targets.join(', ')], ['Irreversible', 'Qualified restructuring wipes all shares of every listed address.']]);
    }
    if (name === 'token.suggestMinter') {
      const minter = address(value(form, 'minter'), 'Minter');
      const applicationPeriod = integer(value(form, 'applicationPeriod'), 'Application period');
      const applicationFee = amount(value(form, 'applicationFee'), 18, 'Application fee');
      const message = value(form, 'message');
      return descriptor(name, client.instance.token, { minter, applicationPeriod, applicationFee, message }, [['Proposed minter', minter], ['Application period', `${applicationPeriod} seconds`], ['Application fee', `${money(applicationFee)} ${client.instance.symbol}`], ['Message', message]]);
    }
    if (name === 'token.denyMinter') {
      const minter = address(value(form, 'minter'), 'Minter');
      const helpers = helperAddresses(value(form, 'helpers'));
      const message = value(form, 'message');
      return descriptor(name, client.instance.token, { minter, helpers, message }, [['Pending minter', minter], ['Helpers', helpers.join(', ') || 'None'], ['Message', message], ['Effect', 'Qualified denial rejects the pending minter application.']]);
    }
    throw new Error(`Unsupported operation ${name}`);
  }

  function renderRows(target, rows) {
    const container = typeof target === 'string' ? $(target) : target;
    container.replaceChildren();
    for (const [label, content] of rows) {
      const row = document.createElement('div');
      row.className = 'metric';
      const name = document.createElement('span');
      const result = document.createElement('strong');
      name.textContent = label;
      result.textContent = String(content);
      row.append(name, result);
      container.append(row);
    }
  }

  function renderPrepared(next) {
    prepared = next;
    $('#transaction-panel').hidden = !next;
    if (!next) return;
    text('#transaction-title', next.label);
    text('#transaction-status', 'Simulation passed. Review the exact transaction before opening MetaMask.');
    renderRows('#transaction-review', [
      ['Operation', next.operation], ['From', next.from], ['Contract', next.to], ['Chain ID', next.chainId],
      ...(next.review || []), ['Estimated gas', `${next.estimatedGas} (not a total L1 + L2 fee quote)`], ['Native value', '0'],
    ]);
    text('#transaction-calldata', next.data);
    const button = $('#transaction-send');
    button.disabled = false;
    button.textContent = 'Confirm in MetaMask';
    button.dataset.prepared = next.id;
  }

  function renderReceipt(entry, receipt) {
    $('#transaction-panel').hidden = false;
    text('#transaction-title', entry.label || entry.operation);
    const confirmed = receipt.status === 1;
    text('#transaction-status', confirmed ? 'Confirmed on DogeOS. Reads are being refreshed; review before taking another step.' : 'The transaction reverted on chain. No automatic retry was made.');
    renderRows('#transaction-review', [['Operation', entry.operation], ['Transaction hash', entry.hash], ['Status', confirmed ? 'Confirmed' : 'Reverted'], ['Block', receipt.blockNumber]]);
    text('#transaction-calldata', entry.data || '');
    $('#transaction-send').disabled = true;
  }

  function renderPending() {
    if (!wallet) return;
    const entries = wallet.getJournal().filter((entry) => ['pending', 'unknown'].includes(entry.status));
    $('#pending-transactions').hidden = entries.length === 0;
    const list = $('#pending-list');
    list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'pending-row';
      const label = document.createElement('strong');
      label.textContent = `${entry.label || entry.operation} · ${entry.status}`;
      row.append(label);
      if (entry.hash) {
        const link = document.createElement('a');
        link.href = `${v2.state.runtime?.chain?.explorerUrl || 'https://blockscout.testnet.dogeos.com'}/tx/${entry.hash}`;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = entry.hash;
        row.append(link);
      } else {
        const form = document.createElement('form');
        form.className = 'inline-form';
        const label = document.createElement('label');
        label.className = 'field';
        label.textContent = 'Externally verified transaction hash';
        const input = document.createElement('input');
        input.required = true;
        input.pattern = '0x[a-fA-F0-9]{64}';
        input.spellcheck = false;
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'btn light';
        submit.textContent = 'Reconcile this hash';
        label.append(input);
        form.append(label, submit);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          submit.disabled = true;
          try { await wallet.reconcile(entry.id, input.value.trim()); }
          catch (error) { hooks.notify(error.message, true); }
          finally { submit.disabled = false; renderPending(); }
        });
        row.append(form);
      }
      list.append(row);
    }
  }

  async function reconcileReceipt(entry, receipt) {
    if (receipt.status !== 1) return;
    if (!['hub.openPosition', 'hub.clone', 'hub.challenge'].includes(entry.operation)) return;
    const { client } = await clientFor($('#v2-position-form'));
    try {
      if (entry.operation === 'hub.challenge') {
        const event = window.IMF_V2.decodeChallengeStarted(receipt, client.instance.mintingHub);
        field($('[data-operation="hub.bid"]'), 'index').value = event.index.toString();
        hooks.notify(`Challenge ${event.index} confirmed. Its current record is available in Challenges & auctions; no bid was sent.`);
      } else {
        const event = window.IMF_V2.decodePositionOpened(receipt, client.instance.mintingHub);
        const created = event.args.position;
        $('#manage-load-form').elements.namedItem('managePosition').value = created;
        field($('#v2-position-form'), 'position').value = created;
        hooks.notify(`Position ${created} confirmed from the hub event. Review its current state before the next action.`);
      }
    } catch (error) {
      hooks.notify(`Transaction confirmed, but its event could not be reconciled: ${error.message}. Use discovery rather than guessing an address or index.`, true);
    }
  }

  function policy() {
    const state = v2.state;
    const runtime = state.runtime;
    if (!runtime || !state.provider || !state.registry || !['runtime-config', 'fixture'].includes(state.source)) return null;
    const writeMode = state.fixture ? 'mock-only' : runtime.mode === 'testnet-metamask' ? 'testnet-metamask' : null;
    if (!writeMode) return null;
    const code = state.registry.codes.find((entry) => state.verified.get(entry));
    if (!code) return null;
    const instance = state.registry.instances[code];
    return {
      writeMode,
      readAllowed: true,
      chainId: String(state.registry.chainId),
      registryKey: `${state.registry.network}:${state.registry.chainId}:${instance.token}:${instance.mintingHub}:${state.source}`,
      chain: runtime.chain,
    };
  }

  async function prepareDescriptor(action) {
    const caller = account();
    const currentPolicy = policy();
    if (!currentPolicy) throw new Error('Writes require the verified public testnet runtime; imported registries and custom RPC connections remain read-only');
    const review = [...action.review, ...(action.approval ? [['Approval before action', `Exact ${money(action.approval.amount, action.approval.decimals)} ${action.approval.symbol} allowance to ${action.approval.spender}`]] : [])];
    let selected = { ...action, review };
    if (action.approval) {
      const token = window.IMF_V2.attachV2ERC20(action.approval.token, v2.state.provider);
      const allowance = await token.allowance(caller, action.approval.spender);
      if (allowance < action.approval.amount) {
        selected = {
          operation: 'erc20.approve', target: action.approval.token,
          args: { spender: action.approval.spender, amount: action.approval.amount },
          review: [['Token', action.approval.token], ['Spender', action.approval.spender], ['Exact allowance', `${money(action.approval.amount, action.approval.decimals)} ${action.approval.symbol}`], ['Separate step', action.approval.reason || 'After this approval confirms, prepare the protocol action again. Nothing else is sent automatically.']],
        };
      }
    }
    const tx = window.IMF_V2.encodeV2Action({ operation: selected.operation, target: selected.target, args: selected.args });
    $('#transaction-send').disabled = true;
    const next = await wallet.prepare({
      operation: selected.operation, label: selected.operation === 'erc20.approve' ? `Approve exact ${selected.args && action.approval?.symbol ? action.approval.symbol : 'token'} amount` : selected.operation,
      to: tx.to, data: tx.data, account: caller, chainId: currentPolicy.chainId,
      registryKey: currentPolicy.registryKey, contextKey: await contextKey(selected.operation, selected), review: selected.review,
    });
    renderPrepared(next);
    $('#transaction-panel').scrollIntoView({ behavior: 'auto', block: 'nearest' });
    $('#transaction-panel').setAttribute('tabindex', '-1');
    $('#transaction-panel').focus();
  }

  async function submit(form) {
    if (!form.reportValidity()) return;
    form.setAttribute('aria-busy', 'true');
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      const action = await operation(form);
      await prepareDescriptor(action);
    } catch (error) {
      hooks.notify(error.message, true);
    } finally {
      form.removeAttribute('aria-busy');
      if (button) button.disabled = false;
    }
  }

  function renderDiscovery() {
    const target = $('#position-discovery');
    target.replaceChildren();
    if (!discovery) return;
    const caller = wallet.getState().account;
    const relevant = discovery.positions.filter((current) => sameAddress(current.owner, caller) || sameAddress(current.createdBy, caller));
    const summary = document.createElement('p');
    summary.className = 'smalltext';
    summary.textContent = discovery.synthetic ? 'Synthetic fixture: no event history.' : `Scanned blocks ${discovery.fromBlock}–${discovery.toBlock}. ${relevant.length} wallet positions and ${discovery.challenges.length} challenge records read.`;
    target.append(summary);
    for (const warning of discovery.warnings) {
      const note = document.createElement('p');
      note.className = 'error';
      note.textContent = warning;
      target.append(note);
    }
    if (!relevant.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No positions created or currently owned by this wallet were found in the scanned history. You can still enter an address directly.';
      target.append(empty);
    }
    for (const current of relevant) {
      const card = document.createElement('article');
      card.className = 'discovery-row';
      const title = document.createElement('strong');
      title.textContent = `${current.collateral.symbol} · ${money(current.minted)} debt`;
      const details = document.createElement('code');
      details.textContent = current.address;
      const state = document.createElement('small');
      state.textContent = `${sameAddress(current.owner, caller) ? 'Owned now' : `Created by wallet; current owner ${current.owner}`} · ${current.closed ? 'Closed' : current.expired ? 'Expired' : 'Open'} · ${money(current.collateral.balance, current.collateral.decimals)} collateral`;
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn light small';
      use.textContent = 'Manage position';
      use.addEventListener('click', () => {
        $('#manage-load-form').elements.namedItem('managePosition').value = current.address;
        for (const form of document.querySelectorAll('[data-position-input]')) {
          const input = form.elements.namedItem('position');
          if (input && !input.value) input.value = current.address;
        }
        hooks.onView('manage');
        $('#manage-load-form').requestSubmit();
      });
      card.append(title, details, state, use);
      target.append(card);
    }
    const arena = $('#challenge-discovery');
    arena.replaceChildren();
    for (const challenge of discovery.challenges) {
      const card = document.createElement('article');
      card.className = 'discovery-row';
      const title = document.createElement('strong');
      title.textContent = `Challenge ${challenge.index} · ${challenge.settled ? 'Settled' : challenge.active ? 'Aversion window' : 'Auction / settlement'}`;
      const details = document.createElement('small');
      details.textContent = `${challenge.position} · ${money(challenge.size, challenge.positionState.collateral.decimals)} ${challenge.positionState.collateral.symbol} remaining`;
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn light small';
      use.textContent = challenge.settled ? 'View record' : 'Prepare a bid';
      use.addEventListener('click', () => {
        field($('[data-operation="hub.bid"]'), 'index').value = challenge.index.toString();
        field($('[data-operation="hub.bid"]'), 'amount').value = window.IMF_V2.formatDecimal(challenge.size, challenge.positionState.collateral.decimals);
        if (!challenge.settled) field($('[data-operation="hub.bid"]'), 'amount').focus();
      });
      card.append(title, details, use);
      arena.append(card);
    }
  }

  async function discoverPositions() {
    if (discoveryBusy) return;
    discoveryBusy = true;
    text('#discovery-status', 'Reading event logs and current contract state…');
    try {
      const { client } = await clientFor($('#manage-load-form'));
      discovery = await window.IMF_DISCOVERY.discover(v2.state, client, account());
      renderDiscovery();
      text('#discovery-status', 'Discovery complete. Contract state was reread; historical events alone are not treated as current state.');
    } catch (error) {
      text('#discovery-status', error.message);
    } finally {
      discoveryBusy = false;
    }
  }

  async function restoreSession() {
    if (!wallet) return null;
    try { return await wallet.restore(); }
    catch (error) {
      if (error.code !== 'POLICY_REQUIRED') hooks.notify(error.message, true);
      return null;
    }
  }

  function init(read, options) {
    v2 = read;
    hooks = options;
    wallet = window.IMF_WALLET.init({
      getPolicy: policy,
      getReadProvider: () => {
        const provider = v2.state.provider;
        return v2.state.fixture && window.__IMF_TEST_DECORATE_PROVIDER__ ? window.__IMF_TEST_DECORATE_PROVIDER__(provider) : provider;
      },
      onSession: () => {
        const state = wallet.getState();
        text('#wallet-account', state.account || 'No wallet account connected');
        text('#wallet-chain', state.chainId ? `Wallet chain ${BigInt(state.chainId)}` : 'Wallet chain unknown');
        if (state.account) {
          for (const selector of ['#v2-position-form [name=account]', '#manage-load-form [name=manageAccount]', '#ecosystem-load-form [name=ecosystemAccount]']) {
            const input = $(selector);
            if (!input.value.trim()) input.value = state.account;
          }
        }
        renderPending();
      },
      onPrepared: (next) => { if (!next) { prepared = null; $('#transaction-panel').hidden = true; } },
      onReceipt: async (entry, receipt) => {
        renderReceipt(entry, receipt);
        renderPending();
        if (receipt.status === 1) {
          try {
            window.IMF_V2_APP.onReadReceipt?.(receipt);
            await window.IMF_DASHBOARD.invalidate?.();
            await reconcileReceipt(entry, receipt);
            await v2.refresh?.();
            if (discovery) await discoverPositions();
          } catch (error) {
            hooks.notify(`Transaction confirmed, but follow-up reads failed: ${error.message}. Retry the reads manually; do not resubmit the transaction.`, true);
          }
        }
      },
      onStatus: (message, isError) => { hooks.notify(message, isError); renderPending(); },
    });
    renderPending();
    $('#wallet-reconcile').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try { await wallet.reconcile(); }
      catch (error) { hooks.notify(error.message, true); }
      finally { event.currentTarget.disabled = false; renderPending(); }
    });
    $('#prepare-position').addEventListener('click', () => submit($('#v2-position-form')));
    document.querySelectorAll('form[data-operation]').forEach((form) => form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit(form);
    }));
    document.querySelectorAll('[data-operation] input, [data-operation] select, [data-operation] textarea, #v2-position-form input, #v2-position-form select, #manage-load-form input').forEach((input) => {
      input.addEventListener('input', () => wallet.invalidate('Inputs changed; review and simulate again'));
      input.addEventListener('change', () => wallet.invalidate('Inputs changed; review and simulate again'));
    });
    $('#transaction-send').addEventListener('click', async () => {
      const id = $('#transaction-send').dataset.prepared;
      if (!id) return;
      $('#transaction-send').disabled = true;
      text('#transaction-status', 'Open MetaMask to review and confirm. No further transaction will be sent automatically.');
      try { await wallet.sendPrepared(id); } catch (error) { hooks.notify(error.message, true); }
    });
    for (const selector of ['#discover-positions', '#discover-challenges']) $(selector).addEventListener('click', discoverPositions);
    document.querySelectorAll('[data-wallet-target]').forEach((button) => button.addEventListener('click', () => {
      const input = $(button.dataset.walletTarget);
      input.value = account();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    restoreSession();
  }

  window.IMF_ACTIONS = {
    init,
    refreshPolicy() {
      wallet?.invalidate('Registry or runtime changed; prepare the action again');
      return restoreSession();
    },
    get state() { return { prepared, discovery }; },
  };
})();
