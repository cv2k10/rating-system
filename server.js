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
        db.get('SELECT * FROM invoice_config WHERE id = 1', [], (err, config) => {
            if (err) return reject(err);
            if (!config || config.is_manual) return resolve(null);
            
            const formattedNumber = `${config.prefix}${String(config.current_number).padStart(6, '0')}`;
            resolve(formattedNumber);
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

// Routes
app.get('/', async (req, res) => {
    try {
        const customers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM customers ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const services = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM services ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const providers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM service_providers ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const invoiceConfig = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM invoice_config WHERE id = 1', [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        const nextInvoiceNumber = await getFormattedInvoiceNumber();
        
        res.render('admin', { 
            customers, 
            services, 
            providers, 
            invoiceConfig,
            nextInvoiceNumber
        });
    } catch (error) {
        res.status(500).render('error', { message: 'Database error' });
    }
});

app.get('/dashboard', (req, res) => {
    const { search, status, dateFrom, dateTo, serviceBy } = req.query;
    
    let sql = `SELECT *, 
               CASE 
                   WHEN is_submitted = 0 
                   THEN validation_token 
                   ELSE NULL 
               END as pending_token 
               FROM ratings`;
    let params = [];
    let conditions = [];
    
    if (search) {
        conditions.push(`(invoice_number LIKE ? OR customer_name LIKE ? OR service_name LIKE ? OR service_by LIKE ?)`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (status === 'pending') {
        conditions.push('is_submitted = 0');
    } else if (status === 'submitted') {
        conditions.push('is_submitted = 1');
    }

    if (serviceBy) {
        conditions.push('service_by = ?');
        params.push(serviceBy);
    }
    
    if (dateFrom) {
        conditions.push('date(created_at) >= date(?)');
        params.push(dateFrom);
    }
    
    if (dateTo) {
        conditions.push('date(created_at) <= date(?)');
        params.push(dateTo);
    }
    
    if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    sql += ` ORDER BY created_at DESC`;

    // Get statistics
    const statsQuery = `
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN is_submitted = 1 THEN 1 ELSE 0 END) as submitted,
            SUM(CASE WHEN is_submitted = 0 THEN 1 ELSE 0 END) as pending,
            ROUND(AVG(CASE WHEN rating IS NOT NULL THEN rating ELSE 0 END), 1) as avg_rating
        FROM ratings`;

    db.get(statsQuery, [], (err, stats) => {
        if (err) {
            return res.status(500).render('error', { message: 'Database error' });
        }
        
        db.all(sql, params, (err, ratings) => {
            if (err) {
                return res.status(500).render('error', { message: 'Database error' });
            }

            // Convert dates to local format
            ratings = ratings.map(rating => ({
                ...rating,
                invoice_date: rating.invoice_date ? new Date(rating.invoice_date).toLocaleDateString() : rating.invoice_date,
                created_at: rating.created_at,
                submitted_at: rating.submitted_at
            }));

            res.render('dashboard', { 
                ratings,
                stats,
                filters: { search, status, dateFrom, dateTo, serviceBy }
            });
        });
    });
});

app.get('/export-csv', (req, res) => {
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

app.post('/generate-link', async (req, res) => {
    const { invoice_number, invoice_date, customer_name, service_name, service_by } = req.body;
    
    // Check if invoice number already exists
    const checkSql = `SELECT COUNT(*) as count FROM ratings WHERE invoice_number = ?`;
    db.get(checkSql, [invoice_number], async (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (result.count > 0) {
            return res.status(400).json({ error: 'This invoice number already has a rating link generated' });
        }

        // If using auto-generated numbers, get and increment the next number
        if (!invoice_number) {
            const nextNumber = await getAndIncrementInvoiceNumber();
            if (!nextNumber) {
                return res.status(400).json({ error: 'Failed to generate invoice number' });
            }
            req.body.invoice_number = nextNumber;
        }

        const validation_token = generateToken(req.body.invoice_number);
        const formattedInvoiceDate = new Date(invoice_date).toISOString().split('T')[0];
        
        const sql = `INSERT INTO ratings (invoice_number, invoice_date, customer_name, service_name, service_by, validation_token) 
                     VALUES (?, ?, ?, ?, ?, ?)`;
        
        db.run(sql, [req.body.invoice_number, formattedInvoiceDate, customer_name, service_name, service_by, validation_token], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            const ratingUrl = `${req.protocol}://${req.get('host')}/rate?invoice=${req.body.invoice_number}&token=${validation_token}`;
            res.json({ url: ratingUrl });
        });
    });
});

app.get('/rate', (req, res) => {
    const { invoice, token } = req.query;
    
    const sql = `SELECT * FROM ratings WHERE invoice_number = ? AND validation_token = ? AND is_submitted = 0`;
    db.get(sql, [invoice, token], (err, row) => {
        if (err) {
            return res.status(500).render('error', { message: 'Database error' });
        }
        if (!row) {
            return res.status(404).render('error', { message: 'Invalid or expired rating link' });
        }
        res.render('rate', { rating: row });
    });
});

app.post('/submit-rating', (req, res) => {
    const { invoice_number, validation_token, rating, review_text } = req.body;
    
    const sql = `UPDATE ratings 
                 SET rating = ?, review_text = ?, is_submitted = 1, submitted_at = datetime('now', '+8 hours')
                 WHERE invoice_number = ? AND validation_token = ? AND is_submitted = 0`;
    
    db.run(sql, [rating, review_text, invoice_number, validation_token], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(400).json({ error: 'Invalid submission or rating already submitted' });
        }
        res.json({ success: true });
    });
});

// Configuration routes
app.get('/config', async (req, res) => {
    try {
        // Get all configuration data
        const customers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM customers ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const services = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM services ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const providers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM service_providers ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const invoiceConfig = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM invoice_config WHERE id = 1', [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        res.render('config', { customers, services, providers, invoiceConfig });
    } catch (error) {
        res.status(500).render('error', { message: 'Database error' });
    }
});

// API endpoints for configuration
app.post('/api/config/invoice', (req, res) => {
    const { is_manual, prefix, current_number } = req.body;
    const sql = `UPDATE invoice_config 
                 SET is_manual = ?, prefix = ?, current_number = ?, updated_at = datetime('now', '+8 hours')
                 WHERE id = 1`;
    
    // Convert is_manual to integer for SQLite
    const isManualInt = is_manual ? 1 : 0;
    
    db.run(sql, [isManualInt, prefix, current_number], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Generic CRUD operations for config items
function handleConfigItem(type, table) {
    // Create
    app.post(`/api/config/${type}`, (req, res) => {
        const { name } = req.body;
        const sql = `INSERT INTO ${table} (name) VALUES (?)`;
        
        db.run(sql, [name], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        });
    });

    // Update
    app.put(`/api/config/${type}/:id`, (req, res) => {
        const { name } = req.body;
        const sql = `UPDATE ${table} SET name = ? WHERE id = ?`;
        
        db.run(sql, [name, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    // Toggle status
    app.post(`/api/config/${type}/:id/toggle`, (req, res) => {
        const sql = `UPDATE ${table} SET is_active = NOT is_active WHERE id = ?`;
        
        db.run(sql, [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
}

// Set up CRUD routes for each config type
handleConfigItem('customer', 'customers');
handleConfigItem('service', 'services');
handleConfigItem('provider', 'service_providers');

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
