// lib/urgeService.test.ts
// Unit tests for urgeService (AsyncStorage persistence and resolution).

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('./impulse', () => ({
  logImpulse: jest.fn().mockResolvedValue({ ok: true }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logImpulse } from './impulse';
import {
  getUrgeStorageKey,
  loadActiveUrge,
  saveActiveUrge,
  resolveActiveUrge,
} from './urgeService';
import type { UrgeState } from '../domain/daySnapshot';

describe('urgeService unit tests', () => {
  const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
  const mockLogImpulse = logImpulse as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUrgeStorageKey', () => {
    it('returns user-prefixed storage key', () => {
      expect(getUrgeStorageKey('u_abc')).toBe('davos.active_urge.u_abc');
    });
  });

  describe('loadActiveUrge', () => {
    it('returns null if no urge in storage', async () => {
      mockStorage.getItem.mockResolvedValueOnce(null);
      const res = await loadActiveUrge('u_abc');
      expect(res).toBeNull();
    });

    it('returns parsed active urge when hold is running', async () => {
      const futureEndsAt = Date.now() + 300000;
      const stored: UrgeState = {
        trigger: 'Snacking',
        intensity: 7,
        startedAt: Date.now() - 300000,
        endsAt: futureEndsAt,
        stage: 'hold',
      };
      mockStorage.getItem.mockResolvedValueOnce(JSON.stringify(stored));

      const res = await loadActiveUrge('u_abc');
      expect(res).toEqual(stored);
      expect(res?.stage).toBe('hold');
    });

    it('transitions stage to resolve if endsAt has passed', async () => {
      const pastEndsAt = Date.now() - 1000;
      const stored: UrgeState = {
        trigger: 'Social media',
        intensity: 5,
        startedAt: Date.now() - 601000,
        endsAt: pastEndsAt,
        stage: 'hold',
      };
      mockStorage.getItem.mockResolvedValueOnce(JSON.stringify(stored));

      const res = await loadActiveUrge('u_abc');
      expect(res?.stage).toBe('resolve');
    });
  });

  describe('saveActiveUrge', () => {
    it('saves serialized urge to storage', async () => {
      const urge: UrgeState = {
        trigger: 'Procrastinating',
        intensity: 8,
        startedAt: Date.now(),
        endsAt: Date.now() + 600000,
        stage: 'hold',
      };
      await saveActiveUrge('u_abc', urge);
      expect(mockStorage.setItem).toHaveBeenCalledWith(
        'davos.active_urge.u_abc',
        JSON.stringify(urge)
      );
    });

    it('removes storage key when urge is null', async () => {
      await saveActiveUrge('u_abc', null);
      expect(mockStorage.removeItem).toHaveBeenCalledWith('davos.active_urge.u_abc');
    });
  });

  describe('resolveActiveUrge', () => {
    it('clears storage and does not call logImpulse when held', async () => {
      const res = await resolveActiveUrge('u_abc', 'held', 'Smoking');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('davos.active_urge.u_abc');
      expect(mockLogImpulse).not.toHaveBeenCalled();
      expect(res.ok).toBe(true);
    });

    it('clears storage and calls logImpulse when yielded', async () => {
      const res = await resolveActiveUrge('u_abc', 'yielded', 'Smoking');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('davos.active_urge.u_abc');
      expect(mockLogImpulse).toHaveBeenCalledWith('app', 'Smoking');
      expect(res.ok).toBe(true);
    });
  });
});
