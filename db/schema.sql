CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL,
    invoice_date TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    service_name TEXT NOT NULL,
    validation_token TEXT NOT NULL,
    rating INTEGER,
    review_text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME,
    is_submitted BOOLEAN DEFAULT 0
);
