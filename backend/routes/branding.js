const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../firebase-admin');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/branding');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${req.body.ownerId}-${req.body.hotspotId}-${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Check file type
    const allowedTypes = {
      'logo': ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'],
      'favicon': ['image/png']
    };
    
    const fileType = req.body.type;
    if (allowedTypes[fileType] && allowedTypes[fileType].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type for ${fileType}. Allowed types: ${allowedTypes[fileType].join(', ')}`));
    }
  }
});

// Upload branding files
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { ownerId, hotspotId, type } = req.body;
    
    if (!ownerId || !hotspotId || !type) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Create file URL (in production, this would be a CDN URL)
    const fileUrl = `/uploads/branding/${req.file.filename}`;
    
    // Save file info to Firestore
    const brandingRef = db.collection('branding').doc(`${ownerId}_${hotspotId}`);
    await brandingRef.set({
      ownerId,
      hotspotId,
      [type]: fileUrl,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    res.json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      size: req.file.size
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// Save branding data (draft)
router.post('/save', async (req, res) => {
  try {
    const { ownerId, hotspotId, ...brandingData } = req.body;
    
    if (!ownerId || !hotspotId) {
      return res.status(400).json({ success: false, error: 'Missing ownerId or hotspotId' });
    }

    const brandingRef = db.collection('branding').doc(`${ownerId}_${hotspotId}`);
    await brandingRef.set({
      ownerId,
      hotspotId,
      ...brandingData,
      published: false,
      savedAt: new Date().toISOString()
    }, { merge: true });

    res.json({ success: true, message: 'Branding saved as draft' });

  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ success: false, error: 'Save failed' });
  }
});

// Publish branding data
router.post('/publish', async (req, res) => {
  try {
    const { ownerId, hotspotId, ...brandingData } = req.body;
    
    if (!ownerId || !hotspotId) {
      return res.status(400).json({ success: false, error: 'Missing ownerId or hotspotId' });
    }

    const brandingRef = db.collection('branding').doc(`${ownerId}_${hotspotId}`);
    await brandingRef.set({
      ownerId,
      hotspotId,
      ...brandingData,
      published: true,
      publishedAt: new Date().toISOString()
    }, { merge: true });

    // Also update the live branding collection for real-time access
    const liveBrandingRef = db.collection('live_branding').doc(`${ownerId}_${hotspotId}`);
    await liveBrandingRef.set({
      ownerId,
      hotspotId,
      ...brandingData,
      lastUpdated: new Date().toISOString()
    }, { merge: true });

    res.json({ success: true, message: 'Branding published successfully' });

  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ success: false, error: 'Publish failed' });
  }
});

// Get branding data
router.get('/:ownerId/:hotspotId', async (req, res) => {
  try {
    const { ownerId, hotspotId } = req.params;
    
    const brandingRef = db.collection('branding').doc(`${ownerId}_${hotspotId}`);
    const doc = await brandingRef.get();
    
    if (doc.exists) {
      res.json({
        success: true,
        branding: doc.data()
      });
    } else {
      // Return default branding
      res.json({
        success: true,
        branding: {
          ownerId,
          hotspotId,
          logo: null,
          favicon: null,
          primaryColor: '#3b82f6',
          secondaryColor: '#f3f4f6',
          textColor: '#1f2937',
          fontFamily: 'Inter',
          welcomeText: 'Welcome to our WiFi',
          footerText: 'Powered by YABA WiFi',
          backgroundType: 'solid',
          backgroundColor: '#ffffff',
          backgroundImage: null
        }
      });
    }

  } catch (error) {
    console.error('Get branding error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch branding data' });
  }
});

// Get live branding data (for WiFi portal)
router.get('/live/:ownerId/:hotspotId', async (req, res) => {
  try {
    const { ownerId, hotspotId } = req.params;
    
    // First try to get hotspot-specific branding
    let brandingRef = db.collection('live_branding').doc(`${ownerId}_${hotspotId}`);
    let doc = await brandingRef.get();
    
    // If not found, try to get owner-wide branding
    if (!doc.exists) {
      brandingRef = db.collection('live_branding').doc(`${ownerId}_all`);
      doc = await brandingRef.get();
    }
    
    if (doc.exists) {
      res.json({
        success: true,
        branding: doc.data()
      });
    } else {
      // Return default branding
      res.json({
        success: true,
        branding: {
          ownerId,
          hotspotId,
          logo: null,
          favicon: null,
          primaryColor: '#3b82f6',
          secondaryColor: '#f3f4f6',
          textColor: '#1f2937',
          fontFamily: 'Inter',
          welcomeText: 'Welcome to our WiFi',
          footerText: 'Powered by YABA WiFi',
          backgroundType: 'solid',
          backgroundColor: '#ffffff',
          backgroundImage: null
        }
      });
    }

  } catch (error) {
    console.error('Get live branding error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch live branding data' });
  }
});

// Delete branding
router.delete('/:ownerId/:hotspotId', async (req, res) => {
  try {
    const { ownerId, hotspotId } = req.params;
    
    const brandingRef = db.collection('branding').doc(`${ownerId}_${hotspotId}`);
    await brandingRef.delete();
    
    const liveBrandingRef = db.collection('live_branding').doc(`${ownerId}_${hotspotId}`);
    await liveBrandingRef.delete();

    res.json({ success: true, message: 'Branding deleted successfully' });

  } catch (error) {
    console.error('Delete branding error:', error);
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

module.exports = router;

