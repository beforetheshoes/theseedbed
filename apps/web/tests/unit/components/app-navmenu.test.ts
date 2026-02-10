import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

type NavItem = { label: string; to: string; icon: string; visibility: 'all' };

const MenuStub = defineComponent({
  name: 'Menu',
  props: ['model'],
  setup: (props) => {
    return () =>
      h(
        'div',
        (props.model || []).map((item: any) =>
          h(
            'button',
            {
              type: 'button',
              onClick: () => item.command?.(),
            },
            item.label,
          ),
        ),
      );
  },
});

const mountWithNavItems = async (items: NavItem[], { onNavigate }: { onNavigate?: () => void }) => {
  vi.resetModules();
  vi.doMock('~/utils/navigation', () => ({ appNavItems: items }));
  const { default: AppNavMenu } = await import('../../../app/components/shell/AppNavMenu.vue');

  const wrapper = mount(AppNavMenu, {
    props: { onNavigate },
    global: {
      stubs: {
        Menu: MenuStub,
      },
    },
  });

  return { wrapper };
};

describe('AppNavMenu', () => {
  it('renders the nav items and invokes onNavigate via MenuItem.command', async () => {
    const onNavigate = vi.fn();

    const { wrapper } = await mountWithNavItems(
      [
        { label: 'Library', to: '/library', icon: 'pi pi-book', visibility: 'all' },
        { label: 'Add books', to: '/books/search', icon: 'pi pi-search', visibility: 'all' },
      ],
      { onNavigate },
    );

    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].text()).toBe('Library');
    expect(buttons[1].text()).toBe('Add books');

    await buttons[0].trigger('click');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onNavigate is not provided', async () => {
    const { wrapper } = await mountWithNavItems(
      [{ label: 'Library', to: '/library', icon: 'pi pi-book', visibility: 'all' }],
      {},
    );

    await wrapper.find('button').trigger('click');
  });
});
