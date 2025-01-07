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
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const expressLayouts = require('express-ejs-layouts');

// Set up EJS
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/admin'); // Set default layout
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
console.log('Admin path:', ADMIN_PATH);

// Admin middleware to expose admin path to all admin templates
const adminMiddleware = (req, res, next) => {
    res.locals.ADMIN_PATH = ADMIN_PATH;
    next();
};

// Debug middleware
app.use((req, res, next) => {
    console.log('Request URL:', req.url);
    console.log('Request method:', req.method);
    console.log('Request path:', req.path);
    next();
});

// Apply admin middleware to all admin routes
const adminRouter = express.Router();
app.use(`/${ADMIN_PATH}`, adminMiddleware, adminRouter);

// Routes
app.get('/', (req, res) => {
    res.render('index', {layout: false});
});

// Generate Rating Link route
adminRouter.get('/', async (req, res) => {
    try {
        // Convert db.all to promises
        const getCustomers = () => {
            return new Promise((resolve, reject) => {
                db.all(
                    'SELECT id, name, customer_id, is_active FROM customers WHERE is_active = 1',
                    [],
                    (err, results) => err ? reject(err) : resolve(results)
                );
            });
        };

        const getServices = () => {
            return new Promise((resolve, reject) => {
                db.all(
                    'SELECT id, name, is_active FROM services WHERE is_active = 1',
                    [],
                    (err, results) => err ? reject(err) : resolve(results)
                );
            });
        };

        const getProviders = () => {
            return new Promise((resolve, reject) => {
                db.all(
                    'SELECT id, name, is_active FROM service_providers WHERE is_active = 1',
                    [],
                    (err, results) => err ? reject(err) : resolve(results)
                );
            });
        };

        const getInvoiceConfig = () => {
            return new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM invoice_config WHERE id = 1',
                    [],
                    (err, results) => err ? reject(err) : resolve(results)
                );
            });
        };

        // Execute all queries in parallel since they don't depend on each other
        const [customers, services, providers, invoiceConfig, nextInvoiceNumber] =
            await Promise.all([
                getCustomers(),
                getServices(),
                getProviders(),
                getInvoiceConfig(),
                getFormattedInvoiceNumber()
            ]);

        res.render('admin', {
            customers,
            services,
            providers,
            invoiceConfig,
            nextInvoiceNumber,
            adminPath: ADMIN_PATH
        });

    } catch (error) {
        console.error('Error loading admin page:', error);
        res.status(500).send('Error loading page');
    }
});

adminRouter.get('/config', async (req, res) => {
    try {
        // Initialize data object
        const data = {
            adminPath: ADMIN_PATH,
            questions: [],
            services: [],
            providers: [],
            customers: []
        };

        // Convert db.all to promises
        const getRatingQuestions = () => {
            return new Promise((resolve, reject) => {
                db.all(
                    'SELECT * FROM rating_questions WHERE is_active = 1 ORDER BY sort_order',
                    [],
                    (err, results) => err ? reject(err) : resolve(results)
                );
            });
        };

        const getServices = () => {
            return new Promise((resolve, reject) => {
                db.all(
                    'SELECT * FROM services WHERE is_active = 1 ORDER BY name',
                    [],
                    (err, results) => err ? reject(err) : resolve(results)
                );
            });
        };

        const getProviders = () => {
            return new Promise((resolve, reject) => {
                db.all(
                    'SELECT * FROM service_providers WHERE is_active = 1 ORDER BY name',
                    [],
                    (err, results) => err ? reject(err) : resolve(results)
                );
            });
        };

        const getCustomers = () => {
            return new Promise((resolve, reject) => {
                db.all(
                    'SELECT * FROM customers WHERE is_active = 1 ORDER BY name',
                    [],
                    (err, results) => err ? reject(err) : resolve(results)
                );
            });
        };

        // Execute all queries in parallel
        const [questions, services, providers, customers] = await Promise.all([
            getRatingQuestions(),
            getServices(),
            getProviders(),
            getCustomers()
        ]);

        // Update data object with results
        Object.assign(data, { questions, services, providers, customers });

        // Render the config page
        res.render('admin/config', data);

    } catch (error) {
        console.error('Error retrieving configuration:', error);
        res.status(500).send('Error retrieving configuration');
    }
});

adminRouter.get('/dashboard', async (req, res) => {
    console.log('Loading dashboard...');
    
    const filters = {
        search: req.query.search || '',
        status: req.query.status || '',
        dateFrom: req.query.dateFrom || '',
        dateTo: req.query.dateTo || '',
        serviceBy: req.query.serviceBy || ''
    };

    try {
        // Get rating statistics
        const query1 = `
            WITH RatingAverages AS (
                SELECT r.id, AVG(CAST(rr.rating AS FLOAT)) as avg_rating
                FROM ratings r
                JOIN rating_responses rr ON r.id = rr.rating_id
                WHERE r.is_submitted = 1
                GROUP BY r.id
            )
            SELECT 
                COUNT(*) as total,
                ROUND(AVG(avg_rating), 1) as avg_rating
            FROM RatingAverages;
        `;

        // Get per-question statistics
        const query2 = `
            WITH RatingCounts AS (
                SELECT 
                    rq.id as question_id,
                    rq.title,
                    rq.question,
                    rr.rating,
                    COUNT(rr.rating) as rating_count,
                    COUNT(DISTINCT r.id) as total_responses,
                    ROUND(AVG(CAST(rr.rating AS FLOAT)), 1) as avg_rating
                FROM rating_questions rq
                LEFT JOIN rating_responses rr ON rq.id = rr.question_id
                LEFT JOIN ratings r ON rr.rating_id = r.id
                WHERE r.is_submitted = 1
                GROUP BY rq.id, rq.title, rq.question, rr.rating
            )
            SELECT 
                question_id,
                title,
                question,
                MAX(total_responses) as total_responses,
                MAX(avg_rating) as avg_rating,
                json_group_object(
                    rating,
                    rating_count
                ) as distribution
            FROM RatingCounts
            GROUP BY question_id, title, question
            ORDER BY question_id;
        `;

        // Get rating distribution
        const query3 = `
            SELECT 
                rr.rating,
                COUNT(*) as count
            FROM rating_responses rr
            JOIN ratings r ON rr.rating_id = r.id
            WHERE r.is_submitted = 1
            GROUP BY rr.rating
            ORDER BY rr.rating DESC;
        `;

        // Get service providers
        const query4 = `
            SELECT DISTINCT name 
            FROM service_providers 
            WHERE is_active = 1
            ORDER BY name;
        `;

        // Execute all queries
        const [stats, questionStats, breakdown, providers] = await Promise.all([
            new Promise((resolve, reject) => {
                db.get(query1, [], (err, row) => {
                    if (err) reject(err);
                    resolve(row || { total: 0, avg_rating: 0 });
                });
            }),
            new Promise((resolve, reject) => {
                db.all(query2, [], (err, rows) => {
                    if (err) reject(err);
                    // Ensure rows is an array before mapping
                    const safeRows = rows || [];
                    // Parse the JSON distribution string for each question
                    const processedRows = safeRows.map(row => ({
                        ...row,
                        distribution: JSON.parse(row.distribution || '{}')
                    }));
                    resolve(processedRows);
                });
            }),
            new Promise((resolve, reject) => {
                db.all(query3, [], (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                });
            }),
            new Promise((resolve, reject) => {
                db.all(query4, [], (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                });
            })
        ]);

        // Initialize rating stats object
        const ratingStatsObj = {
            total: stats.total || 0,
            avg_rating: parseFloat(stats.avg_rating || 0).toFixed(1),
            five_star: 0,
            four_star: 0,
            three_star: 0,
            two_star: 0,
            one_star: 0
        };

        // Fill in the breakdown counts from the actual data
        (breakdown || []).forEach(row => {
            if (row && typeof row.rating === 'number') {
                switch(row.rating) {
                    case 5: ratingStatsObj.five_star = row.count || 0; break;
                    case 4: ratingStatsObj.four_star = row.count || 0; break;
                    case 3: ratingStatsObj.three_star = row.count || 0; break;
                    case 2: ratingStatsObj.two_star = row.count || 0; break;
                    case 1: ratingStatsObj.one_star = row.count || 0; break;
                }
            }
        });

        // Get ratings
        let ratingQuery = `
            SELECT 
                r.id,
                r.invoice_number,
                r.invoice_date,
                r.created_at,
                r.submitted_at,
                r.is_submitted,
                r.review_text,
                c.name as customer_name,
                c.id as customer_id,
                s.name as service_name,
                sp.name as provider_name,
                COALESCE(
                    (SELECT ROUND(AVG(CAST(rating AS FLOAT)), 1) 
                     FROM rating_responses 
                     WHERE rating_id = r.id
                     GROUP BY rating_id
                    ), 
                    0
                ) as rating
            FROM ratings r
            LEFT JOIN customers c ON r.customer_id = c.id
            LEFT JOIN services s ON r.service_id = s.id
            LEFT JOIN service_providers sp ON r.service_provider_id = sp.id
            WHERE 1=1
        `;
        const queryParams = [];

        if (filters.search) {
            ratingQuery += ` AND (
                c.name LIKE ? OR 
                c.id LIKE ? OR 
                r.invoice_number LIKE ?
            )`;
            const searchTerm = `%${filters.search}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm);
        }

        if (filters.status === 'submitted') {
            ratingQuery += ` AND r.is_submitted = 1`;
        } else if (filters.status === 'pending') {
            ratingQuery += ` AND r.is_submitted = 0`;
        }

        if (filters.dateFrom) {
            ratingQuery += ` AND DATE(r.created_at) >= DATE(?)`;
            queryParams.push(filters.dateFrom);
        }

        if (filters.dateTo) {
            ratingQuery += ` AND DATE(r.created_at) <= DATE(?)`;
            queryParams.push(filters.dateTo);
        }

        if (filters.serviceBy) {
            ratingQuery += ` AND sp.name = ?`;
            queryParams.push(filters.serviceBy);
        }

        ratingQuery += ` GROUP BY r.id ORDER BY r.created_at DESC`;

        const ratings = await new Promise((resolve, reject) => {
            db.all(ratingQuery, queryParams, (err, rows) => {
                if (err) {
                    console.error('Error in ratings query:', err);
                    reject(err);
                }
                console.log('Ratings query result:', rows);
                resolve(rows || []);
            });
        });

        // Helper function to format dates
        function formatDate(dateStr) {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        }

        res.render('admin/dashboard', {
            stats: ratingStatsObj,
            questionStats,
            ratings,
            filters,
            providers,
            formatDate: formatDate,
            ADMIN_PATH: ADMIN_PATH
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Error loading dashboard');
    }
});

adminRouter.get('/export-csv', (req, res) => {
    const sql = `
        SELECT 
            r.invoice_number,
            r.invoice_date,
            c.name as customer_name,
            s.name as service_name,
            sp.name as service_by,
            r.rating,
            r.review_text,
            CASE WHEN r.is_submitted = 1 THEN 'Submitted' ELSE 'Pending' END as status,
            r.created_at,
            r.submitted_at
        FROM ratings r
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN services s ON r.service_id = s.id
        LEFT JOIN service_providers sp ON r.service_provider_id = sp.id
        ORDER BY r.created_at DESC`;

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
adminRouter.post('/api/generate', async (req, res) => {
    const { invoice_number, invoice_date, customer_id, service_id, service_provider_id } = req.body;
    
    // Validate required fields
    if (!invoice_number || !invoice_date || !customer_id || !service_id || !service_provider_id) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    // Check for duplicate invoice number
    const checkSql = `SELECT COUNT(*) as count FROM ratings WHERE invoice_number = ?`;
    
    db.get(checkSql, [invoice_number], (err, row) => {
        if (err) {
            console.error('Error checking invoice number:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (row.count > 0) {
            return res.status(400).json({ error: 'Invoice number already exists' });
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

        db.run(sql, params, function(err) {
            if (err) {
                console.error('Error generating rating:', err);
                return res.status(500).json({ error: 'Error generating rating' });
            }
            
            const ratingUrl = `${req.protocol}://${req.get('host')}/rate/${validation_token}`;
            res.json({ url: ratingUrl });
        });
    });
});

// Special handler for customers
adminRouter.get('/api/config/customers', (req, res) => {
    db.all('SELECT * FROM customers WHERE is_active = 1 ORDER BY name', [], (err, customers) => {
        if (err) {
            console.error('Error getting customers:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(customers);
    });
});

adminRouter.post('/api/config/customer', (req, res) => {
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

adminRouter.put('/api/config/customer/:id', (req, res) => {
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

adminRouter.post('/api/config/customer/:id/toggle', (req, res) => {
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
    // Get all
    adminRouter.get(`/api/config/${type}s`, (req, res) => {
        console.log(`Getting all ${type}s from ${table}`);
        db.all(`SELECT * FROM ${table} WHERE is_active = 1 ORDER BY name`, [], (err, items) => {
            if (err) {
                console.error(`Error getting ${type}s:`, err);
                return res.status(500).json({ error: 'Database error' });
            }
            console.log(`Found ${items.length} ${type}s`);
            res.json(items);
        });
    });

    // Create
    adminRouter.post(`/api/config/${type}`, (req, res) => {
        console.log(`Creating new ${type}:`, req.body);
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        db.run(`INSERT INTO ${table} (name) VALUES (?)`, [name], function(err) {
            if (err) {
                console.error(`Error creating ${type}:`, err);
                return res.status(500).json({ error: 'Database error' });
            }
            console.log(`Created ${type} with id ${this.lastID}`);
            res.json({ id: this.lastID, name });
        });
    });

    // Update
    adminRouter.put(`/api/config/${type}/:id`, (req, res) => {
        console.log(`Updating ${type} ${req.params.id}:`, req.body);
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
            console.log(`Updated ${type} ${id}`);
            res.json({ success: true });
        });
    });

    // Delete
    adminRouter.delete(`/api/config/${type}/:id`, (req, res) => {
        console.log(`Deleting ${type} ${req.params.id}`);
        const { id } = req.params;
        db.run(`UPDATE ${table} SET is_active = 0 WHERE id = ?`, [id], (err) => {
            if (err) {
                console.error(`Error deleting ${type}:`, err);
                return res.status(500).json({ error: 'Database error' });
            }
            console.log(`Deleted ${type} ${id}`);
            res.json({ success: true });
        });
    });
};

// Set up CRUD routes for each config type
handleConfigItem('service', 'services');
handleConfigItem('provider', 'service_providers');

// Handle rating questions
adminRouter.get('/api/config/questions', (req, res) => {
    console.log('Getting all questions');
    db.all(`SELECT * FROM rating_questions WHERE is_active = 1 ORDER BY sort_order, id`, [], (err, items) => {
        if (err) {
            console.error('Error getting questions:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        console.log(`Found ${items.length} questions`);
        res.json(items);
    });
});

adminRouter.get('/api/config/question/:id', (req, res) => {
    console.log(`Getting question ${req.params.id}`);
    const { id } = req.params;
    db.get('SELECT * FROM rating_questions WHERE id = ? AND is_active = 1', [id], (err, item) => {
        if (err) {
            console.error('Error getting question:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!item) {
            return res.status(404).json({ error: 'Question not found' });
        }
        res.json(item);
    });
});

adminRouter.post('/api/config/question', (req, res) => {
    console.log('Creating new question:', req.body);
    const { title, question } = req.body;
    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    // Get the maximum sort_order
    db.get('SELECT MAX(sort_order) as maxOrder FROM rating_questions WHERE is_active = 1', [], (err, row) => {
        if (err) {
            console.error('Error getting max sort order:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        const nextOrder = (row.maxOrder || 0) + 1;
        db.run(
            'INSERT INTO rating_questions (title, question, sort_order) VALUES (?, ?, ?)',
            [title || '', question, nextOrder],
            function(err) {
                if (err) {
                    console.error('Error creating question:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                console.log(`Created question with id ${this.lastID}`);
                res.json({ id: this.lastID, title, question, sort_order: nextOrder });
            }
        );
    });
});

adminRouter.put('/api/config/question/:id', (req, res) => {
    console.log(`Updating question ${req.params.id}:`, req.body);
    const { id } = req.params;
    const { title, question } = req.body;
    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    db.run(
        'UPDATE rating_questions SET title = ?, question = ? WHERE id = ?',
        [title || '', question, id],
        (err) => {
            if (err) {
                console.error('Error updating question:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            console.log(`Updated question ${id}`);
            res.json({ success: true });
        }
    );
});

adminRouter.delete('/api/config/question/:id', (req, res) => {
    console.log(`Deleting question ${req.params.id}`);
    const { id } = req.params;
    db.run('UPDATE rating_questions SET is_active = 0 WHERE id = ?', [id], (err) => {
        if (err) {
            console.error('Error deleting question:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        console.log(`Deleted question ${id}`);
        res.json({ success: true });
    });
});

app.get('/rate/:token', (req, res) => {
    const token = req.params.token;
    
    db.get('SELECT r.*, c.name as customer_name, s.name as service_name, sp.name as provider_name FROM ratings r LEFT JOIN customers c ON r.customer_id = c.id LEFT JOIN services s ON r.service_id = s.id LEFT JOIN service_providers sp ON r.service_provider_id = sp.id WHERE r.validation_token = ? AND r.is_submitted = 0', [token], (err, rating) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error retrieving rating');
        }
        if (!rating) {
            return res.status(404).send('Rating not found or already submitted');
        }

        // Get active rating questions
        db.all('SELECT * FROM rating_questions WHERE is_active = 1 ORDER BY sort_order', [], (err, questions) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error retrieving questions');
            }

            res.render('rate', { layout: false, rating, questions });
        });
    });
});

app.post('/submit-rating', (req, res) => {
    const { validation_token, ratings, review_text } = req.body;

    if (!validation_token || !ratings || Object.keys(ratings).length === 0) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    db.serialize(() => {
        db.get('SELECT id FROM ratings WHERE validation_token = ? AND is_submitted = 0', [validation_token], (err, rating) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ success: false, error: 'Database error' });
            }
            if (!rating) {
                return res.status(404).json({ success: false, error: 'Rating not found or already submitted' });
            }

            const ratingId = rating.id;
            
            // Calculate average rating
            const averageRating = Math.round(
                Object.values(ratings).reduce((sum, r) => sum + parseInt(r), 0) / Object.keys(ratings).length
            );

            db.run('BEGIN TRANSACTION');

            // Update main rating
            db.run(
                'UPDATE ratings SET rating = ?, review_text = ?, is_submitted = 1, submitted_at = datetime("now", "+8 hours") WHERE id = ?',
                [averageRating, review_text, ratingId],
                (err) => {
                    if (err) {
                        console.error(err);
                        db.run('ROLLBACK');
                        return res.status(500).json({ success: false, error: 'Database error' });
                    }

                    // Insert individual question ratings
                    const stmt = db.prepare('INSERT INTO rating_responses (rating_id, question_id, rating) VALUES (?, ?, ?)');
                    
                    try {
                        for (const [questionId, rating] of Object.entries(ratings)) {
                            stmt.run(ratingId, questionId, rating);
                        }
                        stmt.finalize();
                        
                        db.run('COMMIT');
                        res.json({ success: true });
                    } catch (err) {
                        console.error(err);
                        db.run('ROLLBACK');
                        res.status(500).json({ success: false, error: 'Database error' });
                    }
                }
            );
        });
    });
});

adminRouter.post('/api/rating-questions', (req, res) => {
    const { title, question } = req.body;
    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    db.run(
        'INSERT INTO rating_questions (title, question, is_active) VALUES (?, ?, 1)',
        [title || null, question],
        function(err) {
            if (err) {
                console.error('Error creating question:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ id: this.lastID });
        }
    );
});

adminRouter.put('/api/rating-questions/:id', (req, res) => {
    const { title, question } = req.body;
    const { id } = req.params;

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    db.run(
        'UPDATE rating_questions SET title = ?, question = ?, updated_at = datetime("now", "+8 hours") WHERE id = ?',
        [title || null, question, id],
        function(err) {
            if (err) {
                console.error('Error updating question:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Question not found' });
            }
            res.json({ success: true });
        }
    );
});

adminRouter.delete('/api/rating-questions/:id', (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM rating_questions WHERE id = ?', [id], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

adminRouter.post('/api/rating-questions/reorder', (req, res) => {
    const { order } = req.body;

    if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'Invalid order data' });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const stmt = db.prepare('UPDATE rating_questions SET sort_order = ? WHERE id = ?');
        
        try {
            order.forEach(item => {
                stmt.run(item.sort_order, item.id);
            });
            stmt.finalize();
            
            db.run('COMMIT');
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            db.run('ROLLBACK');
            res.status(500).json({ error: 'Database error' });
        }
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
