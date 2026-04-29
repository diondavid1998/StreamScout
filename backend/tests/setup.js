'use strict';

// Set required environment variables before any module is loaded by tests.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-prod';
