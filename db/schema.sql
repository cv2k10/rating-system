CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL,
    invoice_date TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    service_name TEXT NOT NULL,
    service_by TEXT NOT NULL,
    validation_token TEXT NOT NULL,
    rating INTEGER,
    review_text TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    submitted_at DATETIME,
    is_submitted BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS service_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    is_active BOOLEAN DEFAULT 1
);

-- Invoice configuration
CREATE TABLE IF NOT EXISTS invoice_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    is_manual INTEGER DEFAULT 1,
    prefix TEXT DEFAULT '',
    current_number INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours'))
);

-- Insert default invoice config if not exists
INSERT OR IGNORE INTO invoice_config (id, is_manual, prefix, current_number) 
VALUES (1, 1, '', 1);
