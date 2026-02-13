import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';

const apiRequest = vi.hoisted(() => vi.fn());
const ApiClientErrorMock = vi.hoisted(
  () =>
    class ApiClientError extends Error {
      code: string;
      status?: number;

      constructor(message: string, code: string, status?: number) {
        super(message);
        this.code = code;
        this.status = status;
      }
    },
);

vi.mock('~/utils/api', () => ({
  apiRequest,
  ApiClientError: ApiClientErrorMock,
}));

import SettingsPage from '../../../app/pages/settings.vue';

const ButtonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  setup:
    (_props, { attrs, slots, emit }) =>
    () =>
      h(
        'button',
        { ...attrs, onClick: (e: unknown) => emit('click', e) },
        slots.default?.() ?? attrs['label'] ?? '',
      ),
});

const InputTextStub = defineComponent({
  name: 'InputText',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h('input', {
        ...attrs,
        value: props.modelValue ?? '',
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
      }),
});

const CardStub = defineComponent({
  name: 'Card',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('div', { ...attrs }, [slots.title?.(), slots.content?.(), slots.default?.()]),
});

const MessageStub = defineComponent({
  name: 'Message',
  setup:
    (_props, { slots, attrs }) =>
    () =>
      h('div', { ...attrs }, slots.default?.()),
});

describe('settings page', () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  const mountPage = () =>
    mount(SettingsPage, {
      global: {
        plugins: [[PrimeVue, { ripple: false }]],
        stubs: {
          Button: ButtonStub,
          InputText: InputTextStub,
          Card: CardStub,
          Message: MessageStub,
        },
      },
    });

  it('loads current profile and allows saving google books preference', async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/me') {
        return {
          handle: 'seed',
          display_name: 'Seed',
          avatar_url: null,
          enable_google_books: false,
        };
      }
      return {};
    });

    const wrapper = mountPage();
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-test="settings-handle"]').setValue('new-handle');
    await wrapper.get('[data-test="settings-display-name"]').setValue('New Name');
    await wrapper.get('[data-test="settings-avatar-url"]').setValue('https://example.com/new.png');
    const toggle = wrapper.get('[data-test="settings-enable-google-books"]');
    await toggle.setValue(true);
    await wrapper.get('[data-test="settings-save"]').trigger('click');

    const patchCall = apiRequest.mock.calls.find((call) => call[0] === '/api/v1/me' && call[1]);
    expect(patchCall).toBeTruthy();
    expect(patchCall?.[1]).toMatchObject({
      method: 'PATCH',
      body: expect.objectContaining({ enable_google_books: true }),
    });
    expect(wrapper.find('[data-test="settings-saved"]').exists()).toBe(true);
  });

  it('shows an error when profile load fails', async () => {
    apiRequest.mockRejectedValueOnce(new ApiClientErrorMock('No profile', 'bad_request', 400));

    const wrapper = mountPage();
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-test="settings-error"]').text()).toContain('No profile');
  });

  it('shows a generic error when profile load fails without API details', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-test="settings-error"]').text()).toContain(
      'Unable to load settings.',
    );
  });

  it('shows an error when save fails', async () => {
    apiRequest
      .mockResolvedValueOnce({
        handle: 'seed',
        display_name: 'Seed',
        avatar_url: null,
        enable_google_books: false,
      })
      .mockRejectedValueOnce(new Error('boom'));

    const wrapper = mountPage();
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-test="settings-save"]').trigger('click');
    expect(wrapper.get('[data-test="settings-error"]').text()).toContain(
      'Unable to save settings.',
    );
  });

  it('shows API error details when save fails with ApiClientError', async () => {
    apiRequest
      .mockResolvedValueOnce({
        handle: 'seed',
        display_name: 'Seed',
        avatar_url: null,
        enable_google_books: false,
      })
      .mockRejectedValueOnce(new ApiClientErrorMock('Denied', 'denied', 403));

    const wrapper = mountPage();
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-test="settings-save"]').trigger('click');
    expect(wrapper.get('[data-test="settings-error"]').text()).toContain('Denied');
  });
});
