import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
  signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
}));

const state = vi.hoisted(() => ({
  supabase: { auth: authMocks },
  config: {
    public: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    },
  },
  route: { query: {}, fullPath: '/login' },
}));

vi.mock('#imports', () => ({
  useSupabaseClient: () => state.supabase,
  useRuntimeConfig: () => state.config,
  useRoute: () => ({
    query: state.route.query,
    fullPath: state.route.fullPath,
  }),
}));

import LoginPage from '../../../app/pages/login.vue';

describe('login page', () => {
  beforeEach(() => {
    const storage: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = String(value);
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
        clear: () => {
          Object.keys(storage).forEach((key) => delete storage[key]);
        },
      },
      writable: true,
    });
    Object.defineProperty(globalThis, 'location', {
      value: { origin: 'https://staging.theseedbed.app' },
      writable: true,
    });
    state.supabase = { auth: authMocks };
    state.config = {
      public: {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-key',
      },
    };
    state.route = { query: {}, fullPath: '/login' };
    authMocks.signInWithOtp.mockClear();
    authMocks.signInWithOtp.mockResolvedValue({ error: null });
    authMocks.signInWithOAuth.mockClear();
    authMocks.signInWithOAuth.mockResolvedValue({ error: null });
  });

  it('submits a magic link request', async () => {
    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-email"]').setValue('reader@theseedbed.app');
    await wrapper.get('[data-test="login-magic-link"]').trigger('click');

    expect(authMocks.signInWithOtp).toHaveBeenCalledWith({
      email: 'reader@theseedbed.app',
      options: {
        emailRedirectTo: expect.any(String),
      },
    });
  });

  it('requires an email before sending a magic link', async () => {
    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-magic-link"]').trigger('click');

    expect(authMocks.signInWithOtp).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Enter a valid email address.');
  });

  it('shows an error when magic link request fails', async () => {
    authMocks.signInWithOtp.mockResolvedValueOnce({ error: { message: 'Nope' } });

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-email"]').setValue('reader@theseedbed.app');
    await wrapper.get('[data-test="login-magic-link"]').trigger('click');

    expect(wrapper.text()).toContain('Nope');
  });

  it('builds a redirect that preserves returnTo', async () => {
    state.route = {
      query: { returnTo: '/oauth/consent?authorization_id=auth-123' },
      fullPath: '/login?returnTo=/oauth/consent?authorization_id=auth-123',
    };

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-email"]').setValue('reader@theseedbed.app');
    await wrapper.get('[data-test="login-magic-link"]').trigger('click');

    const call = authMocks.signInWithOtp.mock.calls[0]?.[0];
    const redirectUrl = new globalThis.URL(call.options.emailRedirectTo);

    expect(redirectUrl.pathname).toBe('/auth/callback');
    expect(redirectUrl.searchParams.get('returnTo')).toBeNull();

    const stored = globalThis.localStorage?.getItem('seedbed.auth.returnTo');
    expect(stored).toBeTruthy();
    const parsed = stored ? JSON.parse(stored) : null;
    expect(parsed.path).toBe('/oauth/consent?authorization_id=auth-123');
  });

  it('starts Apple OAuth sign-in', async () => {
    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-apple"]').trigger('click');

    expect(authMocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: {
        redirectTo: expect.any(String),
      },
    });
  });

  it('starts Google OAuth sign-in', async () => {
    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-google"]').trigger('click');

    expect(authMocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: expect.any(String),
      },
    });
  });

  it('shows an error when Supabase is unavailable for magic links', async () => {
    state.supabase = null;

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-email"]').setValue('reader@theseedbed.app');
    await wrapper.get('[data-test="login-magic-link"]').trigger('click');

    expect(authMocks.signInWithOtp).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Supabase client is not available.');
  });

  it('shows an error when Apple OAuth fails', async () => {
    authMocks.signInWithOAuth.mockResolvedValueOnce({ error: { message: 'Apple down' } });

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-apple"]').trigger('click');

    expect(wrapper.text()).toContain('Apple down');
  });

  it('shows an error when Google OAuth fails', async () => {
    authMocks.signInWithOAuth.mockResolvedValueOnce({ error: { message: 'Google down' } });

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-google"]').trigger('click');

    expect(wrapper.text()).toContain('Google down');
  });

  it('falls back when Supabase client is missing', async () => {
    state.supabase = null;

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-apple"]').trigger('click');

    expect(wrapper.text()).toContain('Supabase client is not available.');
  });

  it('shows an error when Supabase is unavailable for Google OAuth', async () => {
    state.supabase = null;

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-google"]').trigger('click');

    expect(authMocks.signInWithOAuth).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Supabase client is not available.');
  });

  it('builds an empty redirect when origin is unavailable', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: undefined,
      writable: true,
    });

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-email"]').setValue('reader@theseedbed.app');
    await wrapper.get('[data-test="login-magic-link"]').trigger('click');

    expect(authMocks.signInWithOtp).toHaveBeenCalledWith({
      email: 'reader@theseedbed.app',
      options: {
        emailRedirectTo: '',
      },
    });
  });

  it('builds an empty redirect when origin is blank', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: '',
        hostname: 'preview.vercel.app',
      },
      writable: true,
    });

    const wrapper = mount(LoginPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
      },
    });

    await wrapper.get('[data-test="login-email"]').setValue('reader@theseedbed.app');
    await wrapper.get('[data-test="login-magic-link"]').trigger('click');

    expect(authMocks.signInWithOtp).toHaveBeenCalledWith({
      email: 'reader@theseedbed.app',
      options: {
        emailRedirectTo: '',
      },
    });
  });

  // Debug banners were intentionally removed; errors are surfaced via PrimeVue Message blocks.
});
