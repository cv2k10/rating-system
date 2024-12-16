const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Database setup
const db = new sqlite3.Database('./db/ratings.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the ratings database.');
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize database table
const initDb = () => {
    const sql = `CREATE TABLE IF NOT EXISTS ratings (
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
    )`;
    
    db.run(sql, (err) => {
        if (err) {
            console.error('Error creating table:', err);
        } else {
            console.log('Ratings table initialized');
        }
    });
};

initDb();

// Generate secure token
function generateToken(invoiceNumber) {
    const secret = process.env.SECRET_KEY || 'your-secret-key';
    return crypto.createHmac('sha256', secret)
                 .update(invoiceNumber)
                 .digest('hex');
}

// Routes
app.get('/', (req, res) => {
    res.render('admin');
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

app.post('/generate-link', (req, res) => {
    const { invoice_number, invoice_date, customer_name, service_name, service_by } = req.body;
    
    // Check if invoice number already exists
    const checkSql = `SELECT COUNT(*) as count FROM ratings WHERE invoice_number = ?`;
    db.get(checkSql, [invoice_number], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (result.count > 0) {
            return res.status(400).json({ error: 'This invoice number already has a rating link generated' });
        }

        const validation_token = generateToken(invoice_number);
        const formattedInvoiceDate = new Date(invoice_date).toISOString().split('T')[0];
        
        const sql = `INSERT INTO ratings (invoice_number, invoice_date, customer_name, service_name, service_by, validation_token) 
                     VALUES (?, ?, ?, ?, ?, ?)`;
        
        db.run(sql, [invoice_number, formattedInvoiceDate, customer_name, service_name, service_by, validation_token], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            const ratingUrl = `${req.protocol}://${req.get('host')}/rate?invoice=${invoice_number}&token=${validation_token}`;
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

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
