type LibraryItem = {
  id: string;
  work_id: string;
  work_title: string;
  author_names: string[];
  cover_url: string | null;
  status: 'to_read' | 'reading' | 'completed' | 'abandoned';
  visibility: 'private' | 'public';
  tags: string[];
  created_at: string;
};

const fakeJwt = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJleHAiOjQxMDI0NDQ4MDAsInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYXVkIjoiYXV0aGVudGljYXRlZCJ9',
  'test-signature',
].join('.');

const seedSession = (win: Window) => {
  win.localStorage.setItem(
    'sb-localhost-auth-token',
    JSON.stringify({
      access_token: fakeJwt,
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      expires_in: 60 * 60,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'reader@theseedbed.app',
      },
    }),
  );
};

const baseItems = (): LibraryItem[] => [
  {
    id: 'item-1',
    work_id: 'work-1',
    work_title: 'Book A',
    author_names: ['Author A'],
    cover_url: null,
    status: 'to_read',
    visibility: 'private',
    tags: ['Favorites'],
    created_at: '2026-02-08T00:00:00Z',
  },
  {
    id: 'item-2',
    work_id: 'work-2',
    work_title: 'Book B',
    author_names: ['Author B'],
    cover_url: null,
    status: 'reading',
    visibility: 'public',
    tags: ['History'],
    created_at: '2026-02-09T00:00:00Z',
  },
];

describe('library page (mocked api)', () => {
  let items: LibraryItem[];

  beforeEach(() => {
    items = baseItems();

    cy.intercept('GET', 'http://localhost:54321/auth/v1/user*', {
      statusCode: 200,
      body: {
        id: '00000000-0000-4000-8000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'reader@theseedbed.app',
      },
    });

    cy.intercept('GET', 'http://localhost:8000/api/v1/library/items*', (req) => {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const visibility =
        typeof req.query.visibility === 'string' ? req.query.visibility : undefined;
      const filtered = items.filter(
        (item) =>
          (status ? item.status === status : true) &&
          (visibility ? item.visibility === visibility : true),
      );
      req.reply({ statusCode: 200, body: { data: { items: filtered, next_cursor: null } } });
    }).as('listItems');

    cy.intercept('PATCH', 'http://localhost:8000/api/v1/library/items/*', (req) => {
      const id = req.url.split('/').pop();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) {
        req.reply({
          statusCode: 404,
          body: { data: null, error: { code: 'not_found', message: 'Not found' } },
        });
        return;
      }

      if (typeof req.body?.status === 'string') {
        items[index] = { ...items[index], status: req.body.status };
      }
      if (typeof req.body?.visibility === 'string') {
        items[index] = { ...items[index], visibility: req.body.visibility };
      }
      req.reply({ statusCode: 200, body: { data: items[index], error: null } });
    }).as('patchItem');

    cy.intercept('DELETE', 'http://localhost:8000/api/v1/library/items/*', (req) => {
      const id = req.url.split('/').pop();
      items = items.filter((item) => item.id !== id);
      req.reply({ statusCode: 200, body: { data: { deleted: true }, error: null } });
    }).as('deleteItem');
  });

  it('filters by visibility', () => {
    cy.visit('/library', { onBeforeLoad: seedSession });
    cy.wait('@listItems');
    cy.contains('Book A').should('be.visible');
    cy.contains('Book B').should('be.visible');

    cy.get('[data-test="library-visibility-filter"]').click();
    cy.contains('.p-select-option', 'Public').click();
    cy.wait('@listItems').its('request.url').should('include', 'visibility=public');

    cy.contains('Book B').should('be.visible');
    cy.contains('Book A').should('not.exist');
  });

  it('updates status and visibility inline', () => {
    cy.visit('/library', { onBeforeLoad: seedSession });
    cy.wait('@listItems');

    cy.get('[data-test="library-item-status-edit"]').first().click();
    cy.contains('.p-select-option', 'Completed').click();
    cy.wait('@patchItem').its('request.body').should('deep.equal', { status: 'completed' });

    cy.get('[data-test="library-item-visibility-edit"]').last().click();
    cy.contains('.p-select-option', 'Public').click();
    cy.wait('@patchItem').its('request.body').should('deep.equal', { visibility: 'public' });

    cy.contains('[data-test="library-item-status-chip"]', 'Completed').should('be.visible');
    cy.contains('[data-test="library-item-visibility-chip"]', 'Public').should('be.visible');
  });

  it('deletes an item and shows update error feedback', () => {
    cy.intercept('PATCH', 'http://localhost:8000/api/v1/library/items/*', {
      statusCode: 500,
      body: { data: null, error: { code: 'server_error', message: 'boom' } },
    }).as('patchItemError');

    cy.visit('/library', { onBeforeLoad: seedSession });
    cy.wait('@listItems');

    cy.get('[data-test="library-item-status-edit"]').last().click();
    cy.contains('.p-select-option', 'Completed').click();
    cy.wait('@patchItemError');
    cy.contains('boom').should('be.visible');

    cy.get('[data-test="library-item-remove"]').first().click();
    cy.get('[data-test="library-remove-confirm"]').click();
    cy.wait('@deleteItem');
    cy.contains('Removed from your library.').should('be.visible');
  });
});
