import { Address, Contract, rpc, scValToNative } from '@stellar/stellar-sdk';

function requirePublicEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set; refusing to use an unsafe vault contract default`);
  }
  return value;
}

const RPC_URL = requirePublicEnv('NEXT_PUBLIC_SOROBAN_RPC_URL');
const NETWORK_PASSPHRASE = requirePublicEnv('NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE');
const VAULT_CONTRACT_ID = requirePublicEnv('NEXT_PUBLIC_VAULT_CONTRACT_ID');

export const server = new rpc.Server(RPC_URL);
export const networkPassphrase = NETWORK_PASSPHRASE;

export interface VaultState {
  balance: number;
  strategy: 'Conservative' | 'Balanced' | 'Growth';
  exchangeRate: number;
  apy: number;
}

const STRATEGY_MAP: Record<string, VaultState['strategy']> = {
  conservative: 'Conservative',
  balanced: 'Balanced',
  growth: 'Growth',
};

export async function fetchVaultState(userAddress?: string): Promise<VaultState> {
  if (!userAddress) {
    return { balance: 0, strategy: 'Balanced', exchangeRate: 1.0, apy: 0 };
  }

  try {
    const contract = new Contract(VAULT_CONTRACT_ID);
    const address = new Address(userAddress);

    const [balanceRes, strategyRes, exchangeRateRes, totalAssetsRes, totalSharesRes] = await Promise.all([
      server.simulateContractInvocation({
        contractAddress: VAULT_CONTRACT_ID,
        method: 'get_balance',
        methodArgs: { user: address.toScVal() },
      }),
      server.simulateContractInvocation({
        contractAddress: VAULT_CONTRACT_ID,
        method: 'get_user_strategy',
        methodArgs: { user: address.toScVal() },
      }),
      server.simulateContractInvocation({
        contractAddress: VAULT_CONTRACT_ID,
        method: 'get_exchange_rate',
      }),
      server.simulateContractInvocation({
        contractAddress: VAULT_CONTRACT_ID,
        method: 'get_total_assets',
      }),
      server.simulateContractInvocation({
        contractAddress: VAULT_CONTRACT_ID,
        method: 'get_total_shares',
      }),
    ]);

    void contract;

    const balance = Number(scValToNative(balanceRes.result.retval)) / 1e7;
    const rawStrategy = String(scValToNative(strategyRes.result.retval));
    const strategy = STRATEGY_MAP[rawStrategy] || 'Balanced';
    const exchangeRateRaw = Number(scValToNative(exchangeRateRes.result.retval)) / 1e7;
    const totalAssets = Number(scValToNative(totalAssetsRes.result.retval)) / 1e7;
    const totalShares = Number(scValToNative(totalSharesRes.result.retval)) / 1e7;

    const exchangeRate = exchangeRateRaw || (totalShares > 0 ? totalAssets / totalShares : 1.0);
    const apy = totalAssets > 0 && totalShares > 0
      ? Number((((totalAssets / totalShares - 1) * 365 * 100).toFixed(2)))
      : 0;

    return { balance, strategy, exchangeRate, apy };
  } catch (err) {
    console.warn('Failed to fetch vault state from Soroban RPC:', err);
    return { balance: 0, strategy: 'Balanced', exchangeRate: 1.0, apy: 0 };
  }
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.substring(0, chars + 2)}...${address.substring(address.length - chars)}`;
}