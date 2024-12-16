const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Ensure db directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir);
}

// Database setup
const dbPath = path.join(__dirname, 'db', 'ratings.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the ratings database.');
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Initialize database tables
const initDb = () => {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    const statements = schema.split(';').filter(stmt => stmt.trim());
    
    db.serialize(() => {
        statements.forEach(statement => {
            if (statement.trim()) {
                db.run(statement, err => {
                    if (err) {
                        console.error('Error executing schema:', err);
                    }
                });
            }
        });
    });
};

// Initialize database
initDb();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Helper function to generate token
function generateToken(invoiceNumber) {
    const secret = process.env.SECRET_KEY || 'your-secret-key';
    return crypto.createHmac('sha256', secret)
                 .update(invoiceNumber)
                 .digest('hex');
}

// Function to get next invoice number without incrementing
async function getFormattedInvoiceNumber() {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM invoice_config WHERE id = 1', [], (err, row) => {
            if (err) reject(err);
            else resolve('');  // Always return empty string since we're using manual input
        });
    });
}

// Function to get and increment invoice number
async function getAndIncrementInvoiceNumber() {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM invoice_config WHERE id = 1', [], (err, config) => {
            if (err) return reject(err);
            if (!config || config.is_manual) return resolve(null);
            
            const currentNumber = config.current_number;
            const formattedNumber = `${config.prefix}${String(currentNumber).padStart(6, '0')}`;
            
            db.run('UPDATE invoice_config SET current_number = ? WHERE id = 1', 
                [currentNumber + 1], 
                (err) => {
                    if (err) return reject(err);
                    resolve(formattedNumber);
                }
            );
        });
    });
}

// Generate a random admin path if not set in .env
const ADMIN_PATH = process.env.ADMIN_PATH || crypto.randomBytes(16).toString('hex');
console.log('Admin path:', ADMIN_PATH); // Log this only during development

// Debug middleware
app.use((req, res, next) => {
    console.log('Request URL:', req.url);
    next();
});

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get(`/${ADMIN_PATH}`, (req, res) => {
    // Get customers
    db.all('SELECT id, name, customer_id, is_active FROM customers WHERE is_active = 1', [], (err, customers) => {
        if (err) {
            console.error('Error fetching customers:', err);
            return res.status(500).send('Error loading page');
        }

        // Get services
        db.all('SELECT id, name, is_active FROM services WHERE is_active = 1', [], (err, services) => {
            if (err) {
                console.error('Error fetching services:', err);
                return res.status(500).send('Error loading page');
            }

            // Get service providers
            db.all('SELECT id, name, is_active FROM service_providers WHERE is_active = 1', [], (err, providers) => {
                if (err) {
                    console.error('Error fetching providers:', err);
                    return res.status(500).send('Error loading page');
                }

                // Get invoice config
                db.get('SELECT * FROM invoice_config WHERE id = 1', [], (err, invoiceConfig) => {
                    if (err) {
                        console.error('Error fetching invoice config:', err);
                        return res.status(500).send('Error loading page');
                    }

                    // Get formatted invoice number
                    getFormattedInvoiceNumber().then(nextInvoiceNumber => {
                        res.render('admin', {
                            customers,
                            services,
                            providers,
                            invoiceConfig,
                            nextInvoiceNumber,
                            adminPath: ADMIN_PATH
                        });
                    }).catch(err => {
                        console.error('Error getting invoice number:', err);
                        res.status(500).send('Error loading page');
                    });
                });
            });
        });
    });
});

app.get(`/${ADMIN_PATH}/config`, (req, res) => {
    // Get customers
    db.all('SELECT * FROM customers ORDER BY name', [], (err, customers) => {
        if (err) {
            console.error('Error fetching customers:', err);
            return res.status(500).send('Error loading page');
        }

        // Get services
        db.all('SELECT * FROM services ORDER BY name', [], (err, services) => {
            if (err) {
                console.error('Error fetching services:', err);
                return res.status(500).send('Error loading page');
            }

            // Get service providers
            db.all('SELECT * FROM service_providers ORDER BY name', [], (err, providers) => {
                if (err) {
                    console.error('Error fetching providers:', err);
                    return res.status(500).send('Error loading page');
                }

                res.render('config', {
                    customers,
                    services,
                    providers,
                    adminPath: ADMIN_PATH
                });
            });
        });
    });
});

app.get(`/${ADMIN_PATH}/dashboard`, (req, res) => {
    const { search, status, dateFrom, dateTo, serviceBy } = req.query;
    
    // Get service providers for filter
    db.all('SELECT * FROM service_providers WHERE is_active = 1 ORDER BY name', [], (err, providers) => {
        if (err) {
            console.error('Error fetching providers:', err);
            return res.status(500).send('Error loading page');
        }

        let baseQuery = `
            FROM ratings r
            LEFT JOIN customers c ON r.customer_id = c.id
            LEFT JOIN services s ON r.service_id = s.id
            LEFT JOIN service_providers sp ON r.service_provider_id = sp.id
            WHERE 1=1
        `;
        
        const params = [];

        if (search) {
            baseQuery += ` AND (c.name LIKE ? OR c.customer_id LIKE ? OR r.invoice_number LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (status) {
            baseQuery += ` AND r.is_submitted = ?`;
            params.push(status === 'submitted' ? 1 : 0);
        }

        if (dateFrom) {
            baseQuery += ` AND date(r.invoice_date) >= date(?)`;
            params.push(dateFrom);
        }

        if (dateTo) {
            baseQuery += ` AND date(r.invoice_date) <= date(?)`;
            params.push(dateTo);
        }

        if (serviceBy) {
            baseQuery += ` AND sp.name = ?`;
            params.push(serviceBy);
        }

        // Get statistics based on filtered results
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_submitted = 1 THEN 1 ELSE 0 END) as submitted,
                SUM(CASE WHEN is_submitted = 0 THEN 1 ELSE 0 END) as pending,
                ROUND(AVG(CASE WHEN rating IS NOT NULL THEN rating ELSE 0 END), 1) as avg_rating
            ${baseQuery}
        `;

        // Get ratings with the same filter
        const ratingsQuery = `
            SELECT r.*, c.name as customer_name, c.customer_id as customer_id, 
                   s.name as service_name, sp.name as provider_name,
                   r.validation_token
            ${baseQuery}
            ORDER BY r.created_at DESC
        `;

        // Execute both queries
        db.get(statsQuery, params, (err, rawStats) => {
            if (err) {
                console.error('Error fetching stats:', err);
                return res.status(500).send('Error loading page');
            }

            // Ensure stats have default values
            const stats = {
                total: rawStats.total || 0,
                submitted: rawStats.submitted || 0,
                pending: rawStats.pending || 0,
                avg_rating: rawStats.avg_rating || 0
            };

            // Get ratings
            db.all(ratingsQuery, params, (err, ratings) => {
                if (err) {
                    console.error('Error fetching ratings:', err);
                    return res.status(500).send('Error loading page');
                }

                res.render('dashboard', { 
                    ratings,
                    providers,
                    stats,
                    filters: {
                        search: search || '',
                        status: status || '',
                        dateFrom: dateFrom || '',
                        dateTo: dateTo || '',
                        serviceBy: serviceBy || ''
                    },
                    adminPath: ADMIN_PATH,
                    formatDate: (date) => {
                        return new Date(date.replace(' ', 'T') + '+08:00').toLocaleString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Singapore'
                        });
                    }
                });
            });
        });
    });
});

app.get(`/${ADMIN_PATH}/export-csv`, (req, res) => {
    const sql = `SELECT 
        invoice_number,
        invoice_date,
        customer_name,
        service_name,
        service_by,
        rating,
        review_text,
        CASE WHEN is_submitted = 1 THEN 'Submitted' ELSE 'Pending' END as status,
        created_at,
        submitted_at
        FROM ratings 
        ORDER BY created_at DESC`;

    db.all(sql, [], (err, ratings) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const csvHeader = 'Invoice Number,Date,Customer,Service,Service By,Rating,Review,Status,Created,Submitted\n';
        const csvRows = ratings.map(r => {
            return [
                r.invoice_number,
                r.invoice_date,
                r.customer_name,
                r.service_name,
                r.service_by,
                r.rating || '',
                r.review_text ? `"${r.review_text.replace(/"/g, '""')}"` : '',
                r.status,
                new Date(r.created_at.replace(' ', 'T') + '+08:00').toLocaleString('en-US', { 
                    dateStyle: 'medium', 
                    timeStyle: 'medium',
                    timeZone: 'Asia/Singapore'
                }),
                r.submitted_at ? new Date(r.submitted_at.replace(' ', 'T') + '+08:00').toLocaleString('en-US', { 
                    dateStyle: 'medium', 
                    timeStyle: 'medium',
                    timeZone: 'Asia/Singapore'
                }) : ''
            ].join(',');
        }).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=ratings.csv');
        res.send(csvHeader + csvRows);
    });
});

// API endpoints for configuration
app.post(`/${ADMIN_PATH}/api/generate`, async (req, res) => {
    const { invoice_number, invoice_date, customer_id, service_id, service_provider_id } = req.body;
    
    // Validate required fields
    if (!invoice_number || !invoice_date || !customer_id || !service_id || !service_provider_id) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    // Generate validation token
    const validation_token = generateToken(invoice_number);

    // Insert into database
    const sql = `INSERT INTO ratings (
        invoice_number, 
        invoice_date, 
        customer_id, 
        service_id, 
        service_provider_id, 
        validation_token
    ) VALUES (?, ?, ?, ?, ?, ?)`;

    const params = [
        invoice_number,
        invoice_date,
        customer_id,
        service_id,
        service_provider_id,
        validation_token
    ];

    try {
        db.run(sql, params, function(err) {
            if (err) {
                console.error('Error generating rating:', err);
                return res.status(500).json({ error: 'Error generating rating' });
            }
            
            const ratingUrl = `${req.protocol}://${req.get('host')}/rate/${validation_token}`;
            res.json({ url: ratingUrl });
        });
    } catch (err) {
        console.error('Error generating rating:', err);
        res.status(500).json({ error: 'Error generating rating' });
    }
});

// Special handler for customers
app.post(`/${ADMIN_PATH}/api/config/customer`, (req, res) => {
    const { name, customer_id } = req.body;
    if (!name || !customer_id) {
        return res.status(400).json({ error: 'Name and Customer ID are required' });
    }

    db.run('INSERT INTO customers (name, customer_id) VALUES (?, ?)', [name, customer_id], function(err) {
        if (err) {
            console.error('Error creating customer:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ id: this.lastID, name, customer_id });
    });
});

// Update customer
app.put(`/${ADMIN_PATH}/api/config/customer/:id`, (req, res) => {
    const { id } = req.params;
    const { name, customer_id } = req.body;
    if (!name || !customer_id) {
        return res.status(400).json({ error: 'Name and Customer ID are required' });
    }

    db.run('UPDATE customers SET name = ?, customer_id = ? WHERE id = ?', [name, customer_id, id], (err) => {
        if (err) {
            console.error('Error updating customer:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Toggle customer active status
app.post(`/${ADMIN_PATH}/api/config/customer/:id/toggle`, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE customers SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?', [id], (err) => {
        if (err) {
            console.error('Error toggling customer:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Generic CRUD operations for other config items
const handleConfigItem = (type, table) => {
    // Create
    app.post(`/${ADMIN_PATH}/api/config/${type}`, (req, res) => {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        db.run(`INSERT INTO ${table} (name) VALUES (?)`, [name], function(err) {
            if (err) {
                console.error(`Error creating ${type}:`, err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ id: this.lastID, name });
        });
    });

    // Update
    app.put(`/${ADMIN_PATH}/api/config/${type}/:id`, (req, res) => {
        const { id } = req.params;
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        db.run(`UPDATE ${table} SET name = ? WHERE id = ?`, [name, id], (err) => {
            if (err) {
                console.error(`Error updating ${type}:`, err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true });
        });
    });

    // Toggle active status
    app.post(`/${ADMIN_PATH}/api/config/${type}/:id/toggle`, (req, res) => {
        const { id } = req.params;
        db.run(`UPDATE ${table} SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`, [id], (err) => {
            if (err) {
                console.error(`Error toggling ${type}:`, err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true });
        });
    });
};

// Set up CRUD routes for each config type
handleConfigItem('service', 'services');
handleConfigItem('provider', 'service_providers');

app.get('/rate/:token', (req, res) => {
    const { token } = req.params;
    
    const sql = `
        SELECT r.*, c.name as customer_name, s.name as service_name, sp.name as provider_name
        FROM ratings r
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN services s ON r.service_id = s.id
        LEFT JOIN service_providers sp ON r.service_provider_id = sp.id
        WHERE r.validation_token = ? AND r.is_submitted = 0
    `;
    
    db.get(sql, [token], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).render('error', { message: 'Database error' });
        }
        if (!row) {
            return res.status(404).render('error', { message: 'Invalid or expired rating link' });
        }
        res.render('rate', { rating: row });
    });
});

app.post('/submit-rating', (req, res) => {
    const { validation_token, rating, review_text } = req.body;
    
    const sql = `
        UPDATE ratings 
        SET rating = ?, 
            review_text = ?, 
            is_submitted = 1, 
            submitted_at = datetime('now', '+8 hours')
        WHERE validation_token = ? 
        AND is_submitted = 0
    `;
    
    db.run(sql, [rating, review_text, validation_token], function(err) {
        if (err) {
            console.error('Error submitting rating:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
            return res.status(400).json({ error: 'Invalid submission or rating already submitted' });
        }
        res.json({ success: true });
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
