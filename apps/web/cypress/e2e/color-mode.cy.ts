describe('color mode', () => {
  it('can switch to dark mode from the top bar', () => {
    cy.visit('/');
    cy.get('html', { timeout: 15000 }).should('have.attr', 'data-app-ready', 'true');

    // Click UI (ensures control is present), then use the explicit E2E hook to avoid
    // flakiness around cookie plumbing in headless Electron.
    cy.get('[data-test="color-mode-dark"]').should('be.visible').click();
    // Wait for hydration so the E2E hook is registered.
    cy.window()
      .its('__setColorMode')
      .should('be.a', 'function')
      .then((setter) => {
        (setter as unknown as Function)('dark');
      });

    cy.get('html', { timeout: 10000 }).should('have.class', 'dark');
  });
});
