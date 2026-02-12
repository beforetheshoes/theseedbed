describe('home page', () => {
  it('redirects / to login when signed out', () => {
    cy.visit('/');
    cy.get('html', { timeout: 15000 }).should('have.attr', 'data-app-ready', 'true');
    cy.location('pathname').should('eq', '/login');
    cy.get('[data-test="login-card"]').should('contain', 'Welcome back');
  });

  it('renders search and library pages', () => {
    cy.visit('/books/search');
    cy.get('html', { timeout: 15000 }).should('have.attr', 'data-app-ready', 'true');
    cy.get('[data-test="login-card"]', { timeout: 15000 }).should('contain', 'Welcome back');

    cy.visit('/library');
    cy.get('html', { timeout: 15000 }).should('have.attr', 'data-app-ready', 'true');
    cy.get('[data-test="login-card"]', { timeout: 15000 }).should('contain', 'Welcome back');
  });
});
