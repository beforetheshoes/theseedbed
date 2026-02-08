import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EmptyState from '../../../app/components/EmptyState.vue';
import InlineAlert from '../../../app/components/InlineAlert.vue';
import PageShell from '../../../app/components/PageShell.vue';
import SectionHeader from '../../../app/components/SectionHeader.vue';

describe('shared UI components', () => {
  it('InlineAlert renders nothing when empty, and renders message with tone classes', () => {
    const empty = mount(InlineAlert);
    expect(empty.text()).toBe('');
    expect(empty.find('div').exists()).toBe(false);

    const info = mount(InlineAlert, { props: { message: 'Hello', tone: 'info' } });
    expect(info.text()).toContain('Hello');
    expect(info.classes()).toContain('bg-slate-100');

    const error = mount(InlineAlert, { props: { message: 'Boom', tone: 'error' } });
    expect(error.text()).toContain('Boom');
    expect(error.classes()).toContain('bg-rose-50');
  });

  it('EmptyState supports icon/body and action slot', () => {
    const basic = mount(EmptyState, { props: { title: 'Empty' } });
    expect(basic.text()).toContain('Empty');
    expect(basic.find('i').exists()).toBe(false);

    const rich = mount(EmptyState, {
      props: { title: 'Empty', body: 'Nothing here', icon: 'pi pi-inbox' },
      slots: { action: '<button>Go</button>' },
    });
    expect(rich.text()).toContain('Nothing here');
    expect(rich.find('i').exists()).toBe(true);
    expect(rich.text()).toContain('Go');
  });

  it('SectionHeader supports optional subtitle/icon and actions slot', () => {
    const basic = mount(SectionHeader, { props: { title: 'Title' } });
    expect(basic.text()).toContain('Title');
    expect(basic.find('i').exists()).toBe(false);

    const rich = mount(SectionHeader, {
      props: { title: 'Title', subtitle: 'Sub', icon: 'pi pi-book' },
      slots: { actions: '<a>Action</a>' },
    });
    expect(rich.text()).toContain('Sub');
    expect(rich.find('i').exists()).toBe(true);
    expect(rich.text()).toContain('Action');
  });

  it('PageShell applies max width variants and renders slot content', () => {
    const lg = mount(PageShell, { slots: { default: '<div>Hi</div>' } });
    expect(lg.text()).toContain('Hi');
    expect(lg.find('main').classes().join(' ')).toContain('max-w-5xl');

    const md = mount(PageShell, { props: { maxWidth: 'md' }, slots: { default: '<div>Hi</div>' } });
    expect(md.find('main').classes().join(' ')).toContain('max-w-4xl');
  });
});
