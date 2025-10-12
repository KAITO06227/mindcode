const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');

const router = express.Router();

router.get('/layout', verifyToken, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT layout FROM user_layouts WHERE user_id = ?', [req.user.id]);

    if (rows.length === 0) {
      return res.json({ layout: null });
    }

    let storedLayout = rows[0].layout;

    if (typeof storedLayout === 'string') {
      try {
        storedLayout = JSON.parse(storedLayout);
      } catch (parseError) {
        console.warn('Failed to parse stored layout JSON:', parseError.message);
      }
    }

    res.json({ layout: storedLayout });
  } catch (error) {
    console.error('Failed to fetch user layout:', error);
    res.status(500).json({ message: 'レイアウトの取得に失敗しました' });
  }
});

router.post('/layout', verifyToken, async (req, res) => {
  try {
    const { layout } = req.body;

    if (!layout) {
      return res.status(400).json({ message: '保存するレイアウトがありません' });
    }

    await db.execute(
      `INSERT INTO user_layouts (user_id, layout) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE layout = VALUES(layout)`,
      [req.user.id, JSON.stringify(layout)]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save user layout:', error);
    res.status(500).json({ message: 'レイアウトの保存に失敗しました' });
  }
});

module.exports = router;
