const express = require('express');
const serverless = require('serverless-http');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views'));

// Database setup - for development only
// In production, you should use a proper database service
let db;
if (process.env.NODE_ENV === 'development') {
    const dbPath = path.join(__dirname, '../../db/ratings.db');
    db = new sqlite3.Database(dbPath);
    db.run('PRAGMA foreign_keys = ON');
} else {
    // TODO: Replace with proper database connection
    console.log('Production environment - database connection needed');
}

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

// Export the serverless app
exports.handler = serverless(app);
