# Customer Rating System

## Project Overview
Develop a two-page web application for a customer rating system with secure, invoice-based rating generation and submission.

## System Components
### 1. Admin Page
- Purpose: Generate unique, secure rating links for customers
- Features:
  - Input field for invoice number
  - Input field for invoice date
  - Input field for customer name
  - Input field for service name
  - Generate rating link
  - Generate secure rating URL with two key parameters:
    a) Invoice Number
    b) Validation Token
  - Token generation must be cryptographically secure
  - Prevent URL manipulation or guessing

### 2. Rating Page
- Purpose: Allow customers to submit service ratings
- Features:
  - Validate incoming URL parameters:
    - Verify invoice number
    - Validate token authenticity
    - Prevent access with invalid/expired links
  - Display information:
    - Invoice number
    - Invoice date
    - Customer name
    - Service name
  - Rating Submission Form:
    - Interactive star rating (1-5 stars)
      - Visual representation of stars
      - Hover and click interactions
      - Immediate visual feedback
    - Review text area
      - Optional text input
      - Character limit recommendation (e.g., 500 chars)
  - Form submission validation
  - Confirmation/thank you page after submission

## Technical Requirements
- Backend: Secure token generation and validation
- Frontend: Responsive design
- Database: SQLite for secure storage

## Suggested Tech Stack
- Backend: Node.js (Express)
- Frontend: React
- Database: SQLite