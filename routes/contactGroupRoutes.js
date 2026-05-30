const express = require('express');
const router = express.Router();
const ContactGroup = require('../models/ContactGroup');

// @desc    Get all contact groups
// @route   GET /api/contact-groups
router.get('/', async (req, res) => {
  try {
    const groups = await ContactGroup.find().sort({ createdAt: -1 });
    res.json(groups);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a contact group
// @route   POST /api/contact-groups
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  try {
    const group = await ContactGroup.create({ name, description });
    res.status(201).json(group);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Group with this name already exists.' });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a contact group
// @route   PUT /api/contact-groups/:id
router.put('/:id', async (req, res) => {
  const { name, description } = req.body;
  try {
    const group = await ContactGroup.findByIdAndUpdate(
      req.params.id,
      { name, description },
      { new: true, runValidators: true }
    );
    res.json(group);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Group with this name already exists.' });
    }
    res.status(400).json({ message: error.message });
  }
});

// @desc    Delete a contact group
// @route   DELETE /api/contact-groups/:id
router.delete('/:id', async (req, res) => {
  try {
    await ContactGroup.findByIdAndDelete(req.params.id);
    // Optionally remove this group from all contacts
    const Contact = require('../models/Contact');
    await Contact.updateMany({ groups: req.params.id }, { $pull: { groups: req.params.id } });
    res.json({ message: 'Contact group removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
