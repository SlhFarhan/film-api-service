// Import library
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const cors = require('cors');
const path = require('path');

// Inisialisasi
const app = express();
const port = process.env.PORT || 3000;

// Konfigurasi Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Konfigurasi Database Pool (PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Konfigurasi Multer untuk upload file di memori
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(cors()); // Mengizinkan semua origin
app.use(express.json()); // Untuk parsing application/json

// Endpoint untuk GET semua film
app.get('/films', async (req, res) => {
    const userId = req.headers.authorization;
    if (!userId) {
        return res.status(401).json({ error: 'Authorization header is required.' });
    }

    try {
        const query = `
            SELECT 
                id, 
                name, 
                image_url AS "imageUrl", 
                (user_id = $1) AS mine 
            FROM films 
            ORDER BY created_at DESC
        `;
        const { rows } = await pool.query(query, [userId]);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching films:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Endpoint untuk POST film baru
app.post('/films', upload.single('image'), async (req, res) => {
    const userId = req.headers.authorization;
    const { name } = req.body;
    const file = req.file;

    if (!userId || !name || !file) {
        return res.status(400).json({ error: 'Missing required fields: authorization, name, or image.' });
    }

    try {
        // 1. Upload gambar ke Supabase Storage
        const fileName = `${Date.now()}-${file.originalname}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('film-images')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
            });

        if (uploadError) throw uploadError;

        // 2. Dapatkan URL publik dari gambar yang diupload
        const { data: publicUrlData } = supabase.storage
            .from('film-images')
            .getPublicUrl(fileName);
        
        const publicUrl = publicUrlData.publicUrl;

        // 3. Simpan data film ke database PostgreSQL
        const query = 'INSERT INTO films (name, image_url, user_id) VALUES ($1, $2, $3) RETURNING *';
        const { rows } = await pool.query(query, [name, publicUrl, userId]);

        res.status(201).json({ status: 'success', message: 'Film added successfully.', data: rows[0] });

    } catch (err) {
        console.error('Error creating film:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Endpoint untuk DELETE film
// Menggunakan path parameter :id, lebih standar untuk REST
app.delete('/films/:id', async (req, res) => {
    const userId = req.headers.authorization;
    const { id } = req.params;

    if (!userId) {
        return res.status(401).json({ error: 'Authorization header is required.' });
    }

    try {
        // 1. Ambil URL gambar sebelum dihapus dari DB untuk menghapusnya dari storage
        const selectQuery = 'SELECT image_url FROM films WHERE id = $1 AND user_id = $2';
        const { rows: filmRows } = await pool.query(selectQuery, [id, userId]);

        if (filmRows.length === 0) {
            return res.status(404).json({ error: 'Film not found or you do not have permission to delete it.' });
        }

        const imageUrl = filmRows[0].image_url;
        const fileName = path.basename(imageUrl); // Ekstrak nama file dari URL

        // 2. Hapus record dari database
        const deleteQuery = 'DELETE FROM films WHERE id = $1 AND user_id = $2';
        const result = await pool.query(deleteQuery, [id, userId]);

        if (result.rowCount === 0) {
             return res.status(404).json({ error: 'Film not found or you do not have permission to delete it.' });
        }

        // 3. Hapus file dari Supabase Storage
        await supabase.storage.from('film-images').remove([fileName]);

        res.status(200).json({ status: 'success', message: 'Film deleted successfully.' });

    } catch (err) {
        console.error('Error deleting film:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Jalankan server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});