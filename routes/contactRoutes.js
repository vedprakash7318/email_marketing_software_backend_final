const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const Contact = require('../models/Contact');

const upload = multer({ dest: 'uploads/' });

// @desc    Get all contacts (paginated)
// @route   GET /api/contacts
router.get('/', async (req, res) => {
  try {
    if (req.query.all === 'true') {
      const contacts = await Contact.find().sort({ createdAt: -1 });
      return res.json(contacts);
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';

    const groupId = req.query.groupId;
    let query = {};
    
    if (groupId) {
      query.groups = groupId;
    }

    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await Contact.countDocuments(query);
    const contacts = await Contact.find(query)
      .populate('groups', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      contacts,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Add single contact
// @route   POST /api/contacts
router.post('/', async (req, res) => {
  const { email, name, groups } = req.body;
  try {
    const contact = await Contact.create({ email, name, groups: groups || [] });
    res.status(201).json(contact);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Contact with this email already exists.' });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a contact
// @route   PUT /api/contacts/:id
router.put('/:id', async (req, res) => {
  const { email, name, status, groups } = req.body;
  try {
    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { email, name, status, groups: groups || [] },
      { new: true, runValidators: true }
    );
    res.json(contact);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Contact with this email already exists.' });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Upload Excel/CSV contacts
// @route   POST /api/contacts/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Please upload a file' });
  
  // Extract groupId from body if provided
  const groupId = req.body.groupId;

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    let addedCount = 0;
    for (const row of data) {
      // Assuming columns are 'email' and 'name'
      const email = row.email || row.Email || row.EMAIL;
      const name = row.name || row.Name || row.NAME || '';
      
      if (email) {
        let updateQuery = { $set: { email, name } };
        if (groupId) {
          updateQuery.$addToSet = { groups: groupId };
        }
        
        // Upsert to avoid duplicates crashing the loop
        await Contact.updateOne(
          { email },
          updateQuery,
          { upsert: true }
        );
        addedCount++;
      }
    }
    res.json({ message: `Successfully processed ${addedCount} contacts.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete all contacts
// @route   DELETE /api/contacts/all
router.delete('/all', async (req, res) => {
  try {
    const groupId = req.query.groupId;
    if (groupId) {
      await Contact.deleteMany({ groups: groupId });
      res.json({ message: 'Contacts in group removed' });
    } else {
      await Contact.deleteMany({});
      res.json({ message: 'All contacts removed' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete contact
// @route   DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  try {
    await Contact.findByIdAndDelete(req.params.id);
    res.json({ message: 'Contact removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
