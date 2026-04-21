const express = require('express');
const { pool } = require('../db');
const { mapOfferRow } = require('../utils/offers-query');

const router = express.Router();

/**
 * PATCH /api/v1/admin/offers/:uniqueId
 * Requires ADMIN_API_KEY (Bearer or X-Admin-Api-Key).
 */
router.patch('/:uniqueId', async (req, res) => {
  const { uniqueId } = req.params;
  const updates = req.body;

  const shadowFields = [
    'title', 'merchant_name', 'category', 'card_type',
    'discount_percentage', 'discount_description',
    'valid_from', 'valid_to', 'booking_required',
  ];

  const setClauses = [];
  const queryParams = [];

  shadowFields.forEach((field) => {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = $${queryParams.push(updates[field])}`);
    }
  });

  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No valid fields for update' });
  }

  setClauses.push(`updated_at = NOW()`);
  setClauses.push(`edited_at = NOW()`);

  const idIdx = queryParams.push(uniqueId);
  const sql = `
    UPDATE offers
    SET ${setClauses.join(', ')}
    WHERE unique_id = $${idIdx}
    RETURNING *
  `;

  try {
    const result = await pool.query(sql, queryParams);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    return res.json(mapOfferRow(result.rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update offer', message: error.message });
  }
});

/**
 * POST /api/v1/admin/offers/:uniqueId/publish
 */
router.post('/:uniqueId/publish', async (req, res) => {
  const { uniqueId } = req.params;

  try {
    const sql = `
      UPDATE offers
      SET
        review_status = 'approved',
        is_in_production = true,
        pushed_to_db_at = NOW(),
        updated_at = NOW()
      WHERE unique_id = $1
      RETURNING *
    `;

    const result = await pool.query(sql, [uniqueId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    return res.json({ message: 'Offer published successfully', offer: mapOfferRow(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to publish offer', message: error.message });
  }
});

/**
 * POST /api/v1/admin/offers/:uniqueId/reject
 */
router.post('/:uniqueId/reject', async (req, res) => {
  const { uniqueId } = req.params;

  try {
    const sql = `
      UPDATE offers
      SET
        review_status = 'rejected',
        is_in_production = false,
        updated_at = NOW()
      WHERE unique_id = $1
      RETURNING *
    `;

    const result = await pool.query(sql, [uniqueId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    return res.json({ message: 'Offer rejected', offer: mapOfferRow(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reject offer', message: error.message });
  }
});

module.exports = router;
