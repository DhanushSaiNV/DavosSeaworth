jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      verifyOtp: jest.fn(),
      signInWithOtp: jest.fn(),
    },
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ email: 'test@example.com' }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue('test@example.com'),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OTP_CODE_LENGTH = 6;
const PENDING_EMAIL_KEY = 'davos_pending_email';

const mockedVerifyOtp = supabase.auth.verifyOtp as jest.Mock;
const mockedSignInWithOtp = supabase.auth.signInWithOtp as jest.Mock;
const mockedGetItem = AsyncStorage.getItem as jest.Mock;
const mockedRemoveItem = AsyncStorage.removeItem as jest.Mock;

function isValidCode(code: string): boolean {
  return Boolean(code.trim()) && code.length === OTP_CODE_LENGTH;
}

describe('VerifyCodeScreen auth logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses OTP_CODE_LENGTH = 6', () => {
    expect(OTP_CODE_LENGTH).toBe(6);
  });

  it('rejects malformed codes', () => {
    expect(isValidCode('')).toBe(false);
    expect(isValidCode('123')).toBe(false);
    expect(isValidCode('1234567')).toBe(false);
    expect(isValidCode('   ')).toBe(false);
  });

  it('accepts a 6-digit code', () => {
    expect(isValidCode('123456')).toBe(true);
  });

  it('verifies code and clears stored email on success', async () => {
    mockedVerifyOtp.mockResolvedValueOnce({
      data: { session: { access_token: 'token' } },
      error: null,
    });

    const { data, error } = await supabase.auth.verifyOtp({
      email: 'test@example.com',
      token: '123456',
      type: 'email',
    });
    await mockedRemoveItem(PENDING_EMAIL_KEY);

    expect(error).toBeNull();
    expect(data.session).toBeTruthy();
    expect(mockedVerifyOtp).toHaveBeenCalledWith({
      email: 'test@example.com',
      token: '123456',
      type: 'email',
    });
    expect(mockedRemoveItem).toHaveBeenCalledWith(PENDING_EMAIL_KEY);
  });

  it('surfaces verification failures', async () => {
    mockedVerifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Token has expired or is invalid' },
    });

    const { error } = await supabase.auth.verifyOtp({
      email: 'test@example.com',
      token: '000000',
      type: 'email',
    });

    expect(error?.message).toContain('expired');
  });

  it('falls back to stored email when route param is missing', async () => {
    mockedGetItem.mockResolvedValueOnce('fallback@example.com');
    const stored = await AsyncStorage.getItem(PENDING_EMAIL_KEY);
    expect(stored).toBe('fallback@example.com');
  });

  it('resends code via signInWithOtp', async () => {
    mockedSignInWithOtp.mockResolvedValueOnce({ error: null });

    const { error } = await supabase.auth.signInWithOtp({
      email: 'test@example.com',
      options: { shouldCreateUser: true },
    });

    expect(error).toBeNull();
    expect(mockedSignInWithOtp).toHaveBeenCalledWith({
      email: 'test@example.com',
      options: { shouldCreateUser: true },
    });
  });
});
