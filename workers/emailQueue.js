const nodemailer = require('nodemailer');
const Account = require('../models/Account');
const Log = require('../models/Log');
const Campaign = require('../models/Campaign');
const fs = require('fs');
const path = require('path');

// Simple in-memory queue
class InMemoryQueue {
  constructor() {
    this.jobs = [];
    this.processing = false;
  }

  add(name, data) {
    this.jobs.push(data);
    this.processJobs();
  }

  async processJobs() {
    if (this.processing || this.jobs.length === 0) return;
    this.processing = true;

    const campaignBatchCount = {};

    while (this.jobs.length > 0) {
      const jobData = this.jobs.shift();
      await this.processJob(jobData);
      
      const { campaignId, delayPerEmail, pauseAfterCount, pauseDuration } = jobData;

      // Check for completion
      const campaign = await Campaign.findById(campaignId);
      if (campaign && (campaign.sentCount + campaign.failedCount >= campaign.targetContactsCount)) {
        if (campaign.status !== 'completed') {
          campaign.status = 'completed';
          await campaign.save();
        }
      }

      // Handle batch pausing
      if (pauseAfterCount > 0 && pauseDuration > 0) {
        campaignBatchCount[campaignId] = (campaignBatchCount[campaignId] || 0) + 1;
        if (campaignBatchCount[campaignId] >= pauseAfterCount) {
          console.log(`Campaign ${campaignId} pausing for ${pauseDuration} mins.`);
          await new Promise(res => setTimeout(res, pauseDuration * 60 * 1000));
          campaignBatchCount[campaignId] = 0;
        }
      }

      // Delay between emails
      const delayMs = delayPerEmail ? delayPerEmail * 1000 : 1000;
      await new Promise(res => setTimeout(res, delayMs));
    }

    this.processing = false;
  }

  async getAvailableAccount(selectedAccounts = []) {
    let query = { status: 'active' };
    if (selectedAccounts && selectedAccounts.length > 0) {
      query._id = { $in: selectedAccounts };
    }
    // Sort by oldest lastUsedDate to achieve Round Robin
    const accounts = await Account.find(query).sort({ lastUsedDate: 1 });
    
    for (const account of accounts) {
      await account.checkAndResetDailyLimit();
      if (account.emailsSentToday < account.dailyLimit && account.status === 'active') {
        return account;
      } else if (account.emailsSentToday >= account.dailyLimit && account.status === 'active') {
          account.status = 'exhausted';
          await account.save();
      }
    }
    return null;
  }

  async processJob(data) {
    const { campaignId, contactEmail, contactName, subject, bodyHtml, attachments, selectedAccounts } = data;

    let account = null;
    try {
      account = await this.getAvailableAccount(selectedAccounts);
      if (!account) {
        throw new Error('ALL_ACCOUNTS_EXHAUSTED');
      }

      let transporter;
      if (account.smtpHost && account.smtpHost.trim() !== '') {
        // Use Custom SMTP
        let cleanHost = account.smtpHost.trim().replace(/\.$/, '');
        transporter = nodemailer.createTransport({
          host: cleanHost,
          port: account.smtpPort || 465,
          secure: (account.smtpPort == 465), // true for 465, false for other ports
          requireTLS: true,
          tls: {
            rejectUnauthorized: false // bypass SSL verification issues
          },
          auth: {
            user: account.smtpUsername || account.email,
            pass: account.password
          }
        });
      } else {
        // Fallback to Gmail
        transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: account.email,
            pass: account.password
          }
        });
      }

      let personalizedBody = bodyHtml.replace(/{{name}}/g, contactName || 'Subscriber');
      
      // Convert newlines to <br> to preserve textarea formatting if no HTML tags are used
      if (!personalizedBody.includes('<br') && !personalizedBody.includes('<p>') && !personalizedBody.includes('<div')) {
        personalizedBody = personalizedBody.replace(/\n/g, '<br />');
      }
      
      // Unsubscribe Link Generation
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
      const unsubscribeUrl = `${backendUrl}/unsubscribe/${encodeURIComponent(contactEmail)}`;
      
      const unsubscribeHtml = `<p style="font-size: 11px; color: #999; margin-top: 30px; font-family: Arial, sans-serif;">
        You are receiving this email because you opted in. <a href="${unsubscribeUrl}" style="color: #666; text-decoration: underline;">Unsubscribe</a>
      </p>`;
      
      // Clean, Inbox-Friendly Wrapper
      personalizedBody = `
        <style>
          p { margin: 0; padding: 0; }
          ul, ol { padding-left: 20px; margin: 0; }
          li { margin-bottom: 0; }
          img { max-width: 100%; height: auto; }
        </style>
        ${personalizedBody}
        ${unsubscribeHtml}
      `;

      let finalAttachments = [];

      if (attachments && attachments.length > 0) {
        finalAttachments = attachments.map(att => ({
          filename: att.filename,
          path: att.path
        }));
      }

      // Convert images with local URLs to embedded CID attachments
      const imgRegex = /<img[^>]+src="([^">]+)"/g;
      let match;
      
      while ((match = imgRegex.exec(personalizedBody)) !== null) {
        const srcUrl = match[1];
        
        // If the URL is our backend URL (e.g., http://localhost:5000/uploads/...)
        if (srcUrl.startsWith(backendUrl + '/uploads/')) {
          const filename = srcUrl.split('/').pop();
          const filePath = path.join(__dirname, '..', 'uploads', filename);
          
          if (fs.existsSync(filePath)) {
            const cid = 'img_' + filename;
            
            // Add to attachments as inline
            finalAttachments.push({
              filename: filename,
              path: filePath,
              cid: cid
            });
            
            // Replace the URL in the HTML with cid:...
            personalizedBody = personalizedBody.replace(srcUrl, `cid:${cid}`);
          }
        }
      }

      // Plain Text Fallback (Regex to strip HTML)
      const plainTextFallback = personalizedBody
        .replace(/<style[^>]*>.*?<\/style>/gi, '') // Remove style tags and content
        .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
        .replace(/<\/div>|<\/p>|<br\s*\/?>/gi, '\n') // Replace block tags with newline
        .replace(/<[^>]+>/g, '') // Remove all remaining tags
        .replace(/&nbsp;/g, ' ') // Replace html spaces
        .trim();

      const mailOptions = {
        from: account.email,
        to: contactEmail,
        subject: subject,
        html: personalizedBody,
        text: plainTextFallback,
        attachments: finalAttachments
      };

      await transporter.sendMail(mailOptions);

      account.emailsSentToday += 1;
      account.lastUsedDate = new Date(); // Update for round-robin
      if (account.emailsSentToday >= account.dailyLimit) {
        account.status = 'exhausted';
      }
      await account.save();

      await Log.create({
        campaignId,
        accountId: account._id,
        contactEmail,
        status: 'sent'
      });

      await Campaign.findByIdAndUpdate(campaignId, { $inc: { sentCount: 1 } });
      console.log(`Email sent to ${contactEmail} using ${account.email}`);

    } catch (error) {
      if (error.message === 'ALL_ACCOUNTS_EXHAUSTED') {
        console.log(`Campaign ${campaignId} paused because all selected sender accounts are exhausted for today.`);
        await Campaign.findByIdAndUpdate(campaignId, { status: 'paused' });
        // Remove all pending jobs for this campaign to stop processing it
        this.jobs = this.jobs.filter(j => j.campaignId.toString() !== campaignId.toString());
        return; // Don't log this contact as failed, it will be picked up when resumed
      }

      console.error(`Failed to send email to ${contactEmail}:`, error.message);
      
      if (account) {
        // Update lastUsedDate so round-robin moves past this account
        account.lastUsedDate = new Date();
        
        // If it's a quota error, mark account as exhausted for today
        if (error.message.includes('quota exceeded') || error.message.includes('limit exceeded') || error.message.includes('sending limits')) {
            account.status = 'exhausted';
            console.log(`Account ${account.email} marked as exhausted due to SMTP quota limits.`);
        }
        // If it's an authentication error, mark the account as error so it stops being used
        else if (error.message.includes('535') || error.message.includes('Invalid login') || error.message.includes('authentication')) {
            account.status = 'error';
            account.errorMessage = error.message;
        }
        await account.save();
      }

      await Log.create({
        campaignId,
        accountId: account ? account._id : null,
        contactEmail,
        status: 'failed',
        errorMessage: error.message
      });

      await Campaign.findByIdAndUpdate(campaignId, { $inc: { failedCount: 1 } });
    }
  }
}

const emailQueue = new InMemoryQueue();

module.exports = { emailQueue };
