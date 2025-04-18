CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL,
    invoice_date TEXT NOT NULL,
    customer_id INTEGER,
    service_id INTEGER,
    service_provider_id INTEGER,
    validation_token TEXT NOT NULL,
    rating INTEGER,
    review_text TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    submitted_at DATETIME,
    is_submitted BOOLEAN DEFAULT 0,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (service_id) REFERENCES services(id),
    FOREIGN KEY (service_provider_id) REFERENCES service_providers(id)
);

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours')),
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

-- Rating Questions table
CREATE TABLE IF NOT EXISTS rating_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    question TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours'))
);

-- Rating Responses table
CREATE TABLE IF NOT EXISTS rating_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rating_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (rating_id) REFERENCES ratings(id),
    FOREIGN KEY (question_id) REFERENCES rating_questions(id)
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
