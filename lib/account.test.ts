// lib/account.test.ts
// Decision 27 / TECH-SPEC §7.13 — the delete-account request contract and its copy contract.
// The impure half (`lib/account.ts`) is exercised by the live drill
// (`dev-smoke?action=account-drill` / `scripts/verify-account-lifecycle.py`), which is the
// only place a real JWT and a real delete can be tested.

import {
  confirmationWord,
  parseAccountBody,
} from '../supabase/functions/_shared/account/lifecycleContract';
import copy from '../content/ui-copy/account-settings.json';

describe('parseAccountBody', () => {
  it('accepts each mode with its exact word', () => {
    expect(parseAccountBody({ mode: 'reset', confirm: 'RESET' })).toEqual({
      ok: true,
      mode: 'reset',
    });
    expect(parseAccountBody({ mode: 'delete', confirm: 'DELETE' })).toEqual({
      ok: true,
      mode: 'delete',
    });
  });

  it('is case-sensitive: the whole point is that the user read the copy', () => {
    expect(parseAccountBody({ mode: 'reset', confirm: 'reset' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(parseAccountBody({ mode: 'delete', confirm: 'delete' })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('refuses the other mode’s word', () => {
    expect(parseAccountBody({ mode: 'reset', confirm: 'DELETE' })).toMatchObject({ ok: false });
    expect(parseAccountBody({ mode: 'delete', confirm: 'RESET' })).toMatchObject({ ok: false });
  });

  it('refuses unknown modes, a missing confirm, and non-object bodies', () => {
    expect(parseAccountBody({ mode: 'purge', confirm: 'PURGE' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(parseAccountBody({ mode: 'reset' })).toMatchObject({ ok: false, status: 400 });
    expect(parseAccountBody(null)).toMatchObject({ ok: false, status: 400 });
    expect(parseAccountBody('reset')).toMatchObject({ ok: false, status: 400 });
  });

  it('ignores extra fields (the body is not an authorisation surface)', () => {
    expect(
      parseAccountBody({
        mode: 'delete',
        confirm: 'DELETE',
        user_id: '11111111-1111-1111-1111-111111111111',
      }),
    ).toEqual({ ok: true, mode: 'delete' });
  });
});

describe('confirmationWord', () => {
  it('maps each mode to a distinct uppercase word', () => {
    expect(confirmationWord('reset')).toBe('RESET');
    expect(confirmationWord('delete')).toBe('DELETE');
    expect(confirmationWord('reset')).not.toBe(confirmationWord('delete'));
  });
});

describe('account copy contract', () => {
  it('keeps the confirmation placeholder the card substitutes', () => {
    expect(copy.strings.confirm_label).toContain('{word}');
    expect(copy.strings.confirm_placeholder).toContain('{word}');
  });

  it('ships with an explicit review status', () => {
    expect(['draft', 'approved']).toContain(copy.status);
  });
});
