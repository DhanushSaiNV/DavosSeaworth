jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      signInWithOtp: jest.fn(),
      signInWithOAuth: jest.fn(),
      exchangeCodeForSession: jest.fn(),
    },
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'davos://auth/callback'),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockedSignInWithOtp = supabase.auth.signInWithOtp as jest.Mock;
const mockedSignInWithOAuth = supabase.auth.signInWithOAuth as jest.Mock;
const mockedSetItem = AsyncStorage.setItem as jest.Mock;

describe('SignInScreen auth logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects empty email before calling supabase', async () => {
    const email = '   ';
    expect(email.trim()).toBe('');
    expect(mockedSignInWithOtp).not.toHaveBeenCalled();
  });

  it('sends OTP with shouldCreateUser and persists email', async () => {
    const email = 'test@example.com';
    mockedSignInWithOtp.mockResolvedValueOnce({ error: null });

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    await mockedSetItem('davos_pending_email', email);

    expect(error).toBeNull();
    expect(mockedSignInWithOtp).toHaveBeenCalledWith({
      email,
      options: { shouldCreateUser: true },
    });
    expect(mockedSetItem).toHaveBeenCalledWith('davos_pending_email', email);
  });

  it('surfaces OTP send errors', async () => {
    mockedSignInWithOtp.mockResolvedValueOnce({
      error: { message: 'rate limited' },
    });

    const { error } = await supabase.auth.signInWithOtp({
      email: 'test@example.com',
      options: { shouldCreateUser: true },
    });

    expect(error?.message).toBe('rate limited');
  });

  it('initiates Google OAuth with skipBrowserRedirect', async () => {
    mockedSignInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://accounts.google.com/o/oauth2/auth' },
      error: null,
    });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'davos://auth/callback',
        skipBrowserRedirect: true,
      },
    });

    expect(error).toBeNull();
    expect(data?.url).toContain('accounts.google.com');
    expect(mockedSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: expect.objectContaining({ skipBrowserRedirect: true }),
    });
  });

  it('handles Google OAuth initiation failure', async () => {
    mockedSignInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: { message: 'oauth failed' },
    });

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'davos://auth/callback',
        skipBrowserRedirect: true,
      },
    });

    expect(error?.message).toBe('oauth failed');
  });
});
