const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Log = require('../models/Log');

// @desc    Get all campaigns
// @route   GET /api/campaigns
router.get('/', async (req, res) => {
  try {
    const campaigns = await Campaign.find().populate('targetGroup', 'name').sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a campaign
// @route   POST /api/campaigns
router.post('/', async (req, res) => {
  const { name, subject, bodyHtml, selectedAccounts, delayPerEmail, pauseAfterCount, pauseDuration, attachments, targetGroup } = req.body;
  try {
    // Calculate initial target count based on group
    let activeContactsCount = 0;
    if (targetGroup) {
      activeContactsCount = await Contact.countDocuments({ status: 'active', groups: targetGroup });
    } else {
      activeContactsCount = await Contact.countDocuments({ status: 'active' });
    }

    const campaign = await Campaign.create({
      name,
      subject,
      bodyHtml,
      selectedAccounts: selectedAccounts || [],
      delayPerEmail: delayPerEmail || 0,
      pauseAfterCount: pauseAfterCount || 0,
      pauseDuration: pauseDuration || 0,
      attachments: attachments || [],
      targetContactsCount: activeContactsCount,
      targetGroup: targetGroup || null
    });
    res.status(201).json(campaign);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a campaign
// @route   PUT /api/campaigns/:id
router.put('/:id', async (req, res) => {
  const { name, subject, bodyHtml, selectedAccounts, delayPerEmail, pauseAfterCount, pauseDuration, attachments, targetGroup } = req.body;
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    
    // Only allow edit if draft or paused
    if (campaign.status === 'sending' || campaign.status === 'completed') {
       return res.status(400).json({ message: 'Cannot edit a campaign that is sending or completed' });
    }

    campaign.name = name;
    campaign.subject = subject;
    campaign.bodyHtml = bodyHtml;
    campaign.selectedAccounts = selectedAccounts || [];
    campaign.delayPerEmail = delayPerEmail || 0;
    campaign.pauseAfterCount = pauseAfterCount || 0;
    campaign.pauseDuration = pauseDuration || 0;
    campaign.attachments = attachments || [];
    campaign.targetGroup = targetGroup || null;

    // Recalculate target count
    if (campaign.targetGroup) {
      campaign.targetContactsCount = await Contact.countDocuments({ status: 'active', groups: campaign.targetGroup });
    } else {
      campaign.targetContactsCount = await Contact.countDocuments({ status: 'active' });
    }

    await campaign.save();
    res.json(campaign);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Get Campaign Report
// @route   GET /api/campaigns/:id/report
router.get('/:id/report', async (req, res) => {
  try {
    const logs = await Log.find({ campaignId: req.params.id })
      .populate('accountId', 'email')
      .sort({ createdAt: -1 });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Start a campaign
// @route   POST /api/campaigns/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    if (campaign.status === 'sending' || campaign.status === 'completed') {
       return res.status(400).json({ message: 'Campaign is already processing or completed' });
    }

    campaign.status = 'sending';
    await campaign.save();

    // Fetch contacts that haven't received an email for this campaign yet
    const sentLogs = await Log.find({ campaignId: campaign._id }).select('contactEmail');
    const processedEmails = sentLogs.map(l => l.contactEmail);
    
    let contactQuery = { 
      status: 'active', 
      email: { $nin: processedEmails } 
    };

    if (campaign.targetGroup) {
      contactQuery.groups = campaign.targetGroup;
    }

    const contacts = await Contact.find(contactQuery);
    
    if (contacts.length === 0) {
      campaign.status = 'completed';
      await campaign.save();
      return res.json({ message: 'Campaign is already completed or no pending contacts left.', queued: 0 });
    }

    const { emailQueue } = require('../workers/emailQueue');
    for (const contact of contacts) {
      await emailQueue.add('sendEmail', {
        campaignId: campaign._id,
        contactEmail: contact.email,
        contactName: contact.name,
        subject: campaign.subject,
        bodyHtml: campaign.bodyHtml,
        attachments: campaign.attachments || [],
        selectedAccounts: campaign.selectedAccounts,
        delayPerEmail: campaign.delayPerEmail,
        pauseAfterCount: campaign.pauseAfterCount,
        pauseDuration: campaign.pauseDuration
      });
    }

    res.json({ message: 'Campaign started successfully', queued: contacts.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete a campaign
// @route   DELETE /api/campaigns/:id
router.delete('/:id', async (req, res) => {
  try {
    await Campaign.findByIdAndDelete(req.params.id);
    await Log.deleteMany({ campaignId: req.params.id }); // Also delete associated logs
    res.json({ message: 'Campaign deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
