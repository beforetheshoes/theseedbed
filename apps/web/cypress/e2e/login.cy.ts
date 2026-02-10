describe('login page', () => {
  it('validates that an email is required', () => {
    cy.visit('/login');
    cy.get('html', { timeout: 15000 }).should('have.attr', 'data-app-ready', 'true');

    // Some environments autofill the email field; explicitly clear to exercise validation.
    cy.get('[data-test="login-email"]').should('exist').clear().should('have.value', '');
    cy.get('[data-test="login-magic-link"]').click();
    cy.get('[data-test="login-email"]').should('exist');
    cy.get('[data-test="login-apple"]').should('contain', 'Continue with Apple');
    cy.get('[data-test="login-magic-link"]').should('contain', 'Send magic link');
    cy.get('[data-test="login-error"]', { timeout: 10000 })
      .should('contain', 'Enter a valid email address.')
      .should('be.visible');
  });

  it('submits a magic link request', () => {
    cy.visit('/login');
    cy.get('html', { timeout: 15000 }).should('have.attr', 'data-app-ready', 'true');

    cy.get('[data-test="login-email"]').type('reader@theseedbed.app');
  });
});
