import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signWithFreighter } from './freighter';
import * as freighterApi from '@stellar/freighter-api';

vi.mock('@stellar/freighter-api', () => ({
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

describe('freighter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  describe('signWithFreighter', () => {
    it('throws if required passphrase is not provided in args or env', async () => {
      delete process.env.NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await signWithFreighter('xdr_string');
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'User rejected or failed transaction signing:',
        expect.any(Error)
      );
      expect(consoleErrorSpy.mock.calls[0][1].message).toBe('Network passphrase is not configured in the environment.');
      
      consoleErrorSpy.mockRestore();
    });

    it('throws if network details from freighter do not match required passphrase', async () => {
      process.env.NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE = 'Expected Network Passphrase';
      vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
        network: 'PUBLIC',
        networkUrl: 'https://horizon.stellar.org',
        networkPassphrase: 'Wrong Network Passphrase'
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await signWithFreighter('xdr_string');
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'User rejected or failed transaction signing:',
        expect.any(Error)
      );
      expect(consoleErrorSpy.mock.calls[0][1].message).toContain('Freighter is connected to the wrong network');

      consoleErrorSpy.mockRestore();
    });

    it('signs successfully when passphrase matches', async () => {
      const expectedPassphrase = 'Expected Network Passphrase';
      process.env.NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE = expectedPassphrase;
      vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
        network: 'TESTNET',
        networkUrl: 'https://horizon-testnet.stellar.org',
        networkPassphrase: expectedPassphrase
      });
      vi.mocked(freighterApi.signTransaction).mockResolvedValue('signed_xdr');

      const result = await signWithFreighter('xdr_string');
      expect(result).toBe('signed_xdr');
      expect(freighterApi.signTransaction).toHaveBeenCalledWith('xdr_string', {
        networkPassphrase: expectedPassphrase
      });
    });
  });
});
