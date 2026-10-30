import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  WalletConnectProvider,
  useAccount,
  useConnectors,
  useWalletConnect,
  ChainTypeEnum,
  type Chain,
  type WalletConnectKitConfig,
} from '@dogeos/dogeos-sdk';
import '@dogeos/dogeos-sdk/style.css';

type Eip1193Provider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type DogeOsRuntime = {
  clientId: string;
  chainId: string;
  chain: {
    name: string;
    rpcUrl: string;
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  metadata: WalletConnectKitConfig['metadata'];
};

declare global {
  interface Window {
    IMF_DOGEOS_CONFIG?: DogeOsRuntime;
    IMF_DOGEOS_WALLET?: { mount: () => void };
    IMF_WALLET?: {
      registerProvider: (provider: Eip1193Provider | null, label?: string) => unknown;
      connect: () => Promise<unknown>;
      forget: () => unknown;
    };
  }
}

function WalletBridge() {
  const { openModal, isConnected, error } = useWalletConnect();
  const { address, chainId } = useAccount();
  const { connectors } = useConnectors();
  const opened = useRef(false);
  const wasConnected = useRef(false);
  const provider = (connectors?.evm as { provider?: Eip1193Provider } | undefined)?.provider ?? null;

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openModal();
  }, [openModal]);

  useEffect(() => {
    window.IMF_WALLET?.registerProvider(provider, 'DogeOS');
    if (provider && isConnected) window.IMF_WALLET.connect().catch(() => {});
    if (!isConnected && wasConnected.current) {
      window.IMF_WALLET?.registerProvider(null, 'DogeOS');
      window.IMF_WALLET?.forget();
    }
    wasConnected.current = isConnected;
  }, [provider, isConnected, address, chainId]);

  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>('#wallet-dogeos');
    if (!button) return;
    button.textContent = isConnected ? 'DogeOS wallet connected' : 'Connect wallet';
    button.dataset.connected = String(isConnected);
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }, [isConnected, error]);

  useEffect(() => {
    if (!error) return;
    const button = document.querySelector<HTMLButtonElement>('#wallet-dogeos');
    if (button) button.disabled = false;
    const status = document.querySelector<HTMLElement>('#feedback');
    if (status) {
      status.textContent = `DogeOS wallet connection: ${error}`;
      status.hidden = false;
    }
  }, [error]);

  return null;
}

function mount() {
  const runtime = window.IMF_DOGEOS_CONFIG;
  const target = document.querySelector('#dogeos-wallet-root');
  if (!runtime?.clientId || !target) throw new Error('DogeOS wallet configuration is unavailable.');
  const chain: Chain = {
    id: Number(runtime.chainId),
    name: runtime.chain.name,
    nativeCurrency: { ...runtime.chain.nativeCurrency },
    rpcUrls: { default: { http: [runtime.chain.rpcUrl] } },
    blockExplorers: { default: { name: 'DogeOS Blockscout', url: runtime.chain.explorerUrl } },
    testnet: true,
  };
  const config: WalletConnectKitConfig = {
    clientId: runtime.clientId,
    chains: { evm: [chain] },
    defaultConnectChain: ChainTypeEnum.EVM,
    metadata: runtime.metadata,
    login: { basicLogins: ['externalWallets'], socialLogins: [] },
    theme: {
      defaultTheme: 'light',
      themes: {
        light: {
          colors: {
            background: '#FFF8EE',
            foreground: '#2B2118',
            content1: '#FFFDF9',
            primary: { DEFAULT: '#F7B500', foreground: '#2B2118' },
          },
        },
      },
    },
  };
  createRoot(target).render(
    <WalletConnectProvider config={config}>
      <WalletBridge />
    </WalletConnectProvider>,
  );
}

window.IMF_DOGEOS_WALLET = Object.freeze({ mount });
